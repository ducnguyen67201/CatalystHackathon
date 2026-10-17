import { z } from 'zod';
import type { PracticeContext } from '../contracts/PracticeContext.js';
import type { AvatarProvider, AvatarSettings } from '../features/AvatarProvider.js';

/* Match the live API and SessionAPIClient in the provider's SDK. */
const successCodeSchema = z.literal(1000);

const tokenSchema = z.object({
  code: successCodeSchema,
  data: z.object({ session_id: z.uuid(), session_token: z.string().min(1) }),
});

const stoppedSessionSchema = z.object({
  code: successCodeSchema,
  data: z.object({ id: z.uuid(), end_at: z.iso.datetime({ offset: true }) }),
});

/** Only this adapter sends LiveAvatar credentials; browsers receive a session token. */
export class LiveAvatarProvider implements AvatarProvider {
  async createToken(
    settings: AvatarSettings,
    context: PracticeContext,
    sessionId: string,
    nonce: string,
  ) {
    const response = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: { 'X-API-KEY': settings.apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        mode: 'LITE',
        avatar_id: settings.avatarId,
        max_session_duration: 600,
        elevenlabs_agent_config: {
          agent_id: settings.agentId,
          secret_id: settings.elevenLabsSecretId,
          dynamic_variables: {
            company_name: context.company?.name ?? 'the founder',
            brief_context: JSON.stringify(context),
            previous_session_summary: 'No previous rehearsal supplied.',
            june_session_id: sessionId,
            june_session_nonce: nonce,
          },
        },
      }),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'avatar_token_failed', status: response.status }));
      throw new Error('LiveAvatar could not authorize the session. Check provider settings.');
    }
    const raw: unknown = await response.json();
    const result = tokenSchema.parse(raw);
    return { token: result.data.session_token, avatarSessionId: result.data.session_id };
  }

  async stopSession(apiKey: string, avatarSessionId: string): Promise<void> {
    const response = await fetch('https://api.liveavatar.com/v1/sessions/stop', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ session_id: avatarSessionId, reason: 'USER_CLOSED' }),
    });
    if (response.status === 404) {
      return;
    }
    if (response.ok) {
      const raw: unknown = await response.json();
      if (z.object({ code: successCodeSchema }).safeParse(raw).success) {
        return;
      }
    }
    /* The browser SDK also stops sessions. Verify an already-ended result instead
       of treating every provider error as a successful stop. */
    const status = await fetch(
      `https://api.liveavatar.com/v1/sessions/${encodeURIComponent(avatarSessionId)}`,
      {
        headers: { 'X-API-KEY': apiKey },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (status.ok) {
      const raw: unknown = await status.json();
      const ended = stoppedSessionSchema.safeParse(raw);
      if (ended.success && ended.data.data.id === avatarSessionId) {
        return;
      }
    }
    console.warn(JSON.stringify({ event: 'avatar_stop_failed', status: response.status }));
    throw new Error('The avatar could not be stopped. Retry Finish.');
  }
}
