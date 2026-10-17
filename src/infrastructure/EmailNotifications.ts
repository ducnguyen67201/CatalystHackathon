import { z } from 'zod';
import type { EmailMessage } from '../contracts/RadarDelivery.js';
import { EmailSendError, type EmailSender } from '../features/EmailSender.js';
/** Resend replays an identical request for 24 hours. The service uses a conservative 23-hour window. */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly key: string) {}
  async send(message: EmailMessage, idempotencyKey: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ ...message, to: [message.to] }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new EmailSendError('uncertain');
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const retryMs = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 0;
      if (response.status === 429 || response.status === 409)
        throw new EmailSendError('transient', Number.isFinite(retryMs) ? retryMs : 0);
      if (response.status >= 500 || response.status === 408) throw new EmailSendError('uncertain');
      throw new EmailSendError('permanent');
    }
    try {
      const raw: unknown = await response.json();
      return z.object({ id: z.string().min(1).max(200) }).parse(raw).id;
    } catch {
      throw new EmailSendError('uncertain');
    }
  }
}
