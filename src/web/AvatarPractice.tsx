import { useEffect, useRef, useState } from 'react';
import {
  AgentEventsEnum,
  LiveAvatarSession,
  SessionEvent,
  SessionState,
} from '@heygen/liveavatar-web-sdk';
import { Mic, MicOff, Square, Video } from 'lucide-react';
import { z } from 'zod';
import {
  AVATAR_SESSION_DURATION_SECONDS,
  avatarSessionResponseSchema,
} from '../contracts/AvatarPractice.js';
import { RehearsalMode, type StateResponse, type TranscriptTurn } from '../contracts/Workspace.js';
import { command, request } from './ApiClient.js';
import './AvatarPractice.css';
import type { ScenarioSelection } from '../contracts/Scenario.js';

interface Props {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  selection?: ScenarioSelection | undefined;
  onSelection?: ((selection: ScenarioSelection | undefined) => void) | undefined;
  onLockChange?: (locked: boolean) => void;
  startDisabled?: boolean;
}

const captionSchema = z.object({ text: z.string().min(1).max(10000) });

async function endAvatarSession(id: string, completed: boolean): Promise<void> {
  await command(`/avatar/sessions/${encodeURIComponent(id)}/end`, { completed });
}

/** Live provider video and audio share one stream; no second ElevenLabs microphone connection. */
export function AvatarPractice({
  state,
  onRefresh,
  onError,
  selection,
  onSelection,
  onLockChange,
  startDisabled = false,
}: Props) {
  const video = useRef<HTMLVideoElement | null>(null);
  const client = useRef<LiveAvatarSession | null>(null);
  const activeId = useRef<string | null>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const starting = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionState>(SessionState.INACTIVE);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [preview, setPreview] = useState<TranscriptTurn[]>([]);
  const sessions = state.workspace.rehearsals.filter(
    (item) => item.mode === RehearsalMode.LIVEAVATAR || item.avatarCorrelationHash !== null,
  );
  const session = sessions.find((item) => item.id === sessionId);
  const turns = session?.transcriptReceivedAt ? session.turns : preview;

  function isMounted(): boolean {
    return mounted.current;
  }

  function addCaption(role: TranscriptTurn['role'], raw: unknown): void {
    const parsed = captionSchema.safeParse(raw);
    if (mounted.current && parsed.success) {
      setPreview((current) => [...current, { role, text: parsed.data.text }].slice(-200));
    }
  }

  async function finish(completed: boolean): Promise<void> {
    const id = activeId.current;
    if (!id || closing.current) {
      return;
    }
    closing.current = true;
    if (mounted.current) {
      setBusy(true);
    }
    try {
      client.current?.voiceChat.stop();
      await client.current?.stop().catch(() => undefined);
      await endAvatarSession(id, completed);
      activeId.current = null;
      onLockChange?.(false);
      client.current = null;
      if (mounted.current) {
        setRunning(false);
        setSpeaking(false);
        setStreamReady(false);
        setStatus(SessionState.DISCONNECTED);
        await onRefresh();
      }
    } catch {
      if (mounted.current) {
        onError('Could not confirm the video session stopped. Retry Finish.');
      }
    } finally {
      closing.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function start(): Promise<void> {
    if (startDisabled) return;
    if (starting.current || activeId.current) {
      return;
    }
    starting.current = true;
    onLockChange?.(true);
    setBusy(true);
    onError('');
    setPreview([]);
    setStreamReady(false);
    setMuted(false);
    let stage = 'microphone';
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone.getTracks().forEach((track) => {
        track.stop();
      });
      if (!isMounted()) {
        return;
      }
      stage = 'create_session';
      const response = await request(
        '/avatar/sessions',
        avatarSessionResponseSchema,
        selection ? { selection } : {},
      );
      if (!isMounted()) {
        await endAvatarSession(response.session.id, false);
        return;
      }
      activeId.current = response.session.id;
      setSessionId(response.session.id);
      setRunning(true);
      const avatar = new LiveAvatarSession(response.token, { autoKeepAlive: true });
      client.current = avatar;
      avatar.on(SessionEvent.SESSION_STATE_CHANGED, (next) => {
        if (mounted.current) {
          setStatus(next);
        }
      });
      avatar.on(SessionEvent.SESSION_STREAM_READY, () => {
        if (mounted.current && video.current) {
          avatar.attach(video.current);
          setStreamReady(true);
        }
      });
      avatar.on(AgentEventsEnum.USER_TRANSCRIPTION, (raw: unknown) => {
        addCaption('user', raw);
      });
      avatar.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (raw: unknown) => {
        addCaption('agent', raw);
      });
      avatar.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        if (mounted.current) {
          setSpeaking(true);
        }
      });
      avatar.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        if (mounted.current) {
          setSpeaking(false);
        }
      });
      avatar.on(SessionEvent.SESSION_DISCONNECTED, () => {
        if (mounted.current && !closing.current) {
          void finish(false);
        }
      });
      stage = 'connect_stream';
      await avatar.start();
      if (!isMounted() || activeId.current !== response.session.id) {
        avatar.voiceChat.stop();
        await avatar.stop();
        return;
      }
      // A state refresh is independent of the connected media session.
      await onRefresh().catch(() => {
        console.warn(
          JSON.stringify({ event: 'avatar_state_refresh_failed', stage: 'after_connect' }),
        );
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'avatar_connection_failed',
          stage,
          category: error instanceof DOMException ? error.name : 'Error',
        }),
      );
      await finish(false);
      if (mounted.current) {
        onError(
          'Could not start the live interviewer. Check microphone permission, LiveAvatar credits and voice settings. Try Chrome if this browser cannot connect.',
        );
      }
    } finally {
      starting.current = false;
      if (!activeId.current) onLockChange?.(false);
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    if (!running) {
      return;
    }
    const connected = status === SessionState.CONNECTED;
    const timer = setTimeout(
      () => {
        void finish(connected);
      },
      connected ? AVATAR_SESSION_DURATION_SECONDS * 1000 : 45000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [running, status]);

  useEffect(() => {
    if (
      !session ||
      session.mode !== RehearsalMode.LIVEAVATAR ||
      !session.avatarSessionId ||
      session.status === 'active' ||
      session.transcriptReceivedAt
    ) {
      return;
    }
    const id = session.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function retryTranscript(): Promise<void> {
      attempts += 1;
      try {
        await command(`/avatar/sessions/${encodeURIComponent(id)}/transcript`, {});
        if (!cancelled) {
          await onRefresh();
        }
      } catch {
        // The manual save action remains available after transient provider failures.
      }
      if (!cancelled && attempts < 5) {
        timer = setTimeout(() => {
          void retryTranscript();
        }, 4000);
      }
    }
    timer = setTimeout(() => {
      void retryTranscript();
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session?.id, session?.status, session?.transcriptReceivedAt]);

  useEffect(() => {
    mounted.current = true;
    closing.current = false;
    return () => {
      mounted.current = false;
      closing.current = true;
      const id = activeId.current;
      activeId.current = null;
      client.current?.voiceChat.stop();
      void client.current?.stop().catch(() => undefined);
      if (id) {
        void endAvatarSession(id, false).catch(() => undefined);
      }
    };
  }, []);

  return (
    <>
      <div className="voice-room avatar-room">
        <section className="avatar-stage" aria-label="AI interviewer video">
          <div className="avatar-video-frame">
            <video
              ref={video}
              autoPlay
              playsInline
              controls={streamReady}
              aria-label="Live AI interviewer video and audio"
            />
            {!streamReady && (
              <div className="avatar-placeholder">
                <Video size={42} />
                <h2>{running ? 'Connecting your interviewer…' : 'Meet your AI interviewer'}</h2>
                <p>
                  {selection
                    ? 'Practise the selected scenario with its saved company and investor context.'
                    : 'A live face, an open conversation, and a transcript to revisit.'}
                </p>
              </div>
            )}
            <div className="avatar-badge">AI SIMULATION</div>
            <div className="avatar-caption">
              <strong>June · Investor rehearsal</strong>
              <span role="status">
                {running
                  ? speaking
                    ? 'Interviewer speaking'
                    : status === SessionState.CONNECTED
                      ? 'Listening to you'
                      : 'Connecting'
                  : 'Ready when you are'}
              </span>
            </div>
          </div>
          <div className="avatar-controls">
            {running ? (
              <>
                <button
                  className="button secondary"
                  disabled={busy || status !== SessionState.CONNECTED}
                  onClick={() => {
                    const avatar = client.current;
                    if (!avatar) {
                      return;
                    }
                    void (muted ? avatar.voiceChat.unmute() : avatar.voiceChat.mute())
                      .then(() => {
                        setMuted(avatar.voiceChat.isMuted);
                      })
                      .catch(() => {
                        onError('Could not change microphone state.');
                      });
                  }}
                >
                  {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void finish(true);
                  }}
                >
                  <Square size={14} /> Finish interview
                </button>
              </>
            ) : (
              <button
                className="button"
                disabled={startDisabled || busy || !state.capabilities.avatarReady}
                onClick={() => {
                  void start();
                }}
              >
                <Video size={16} />
                {busy ? 'Starting…' : 'Start live interview'}
              </button>
            )}
          </div>
          <p className="avatar-disclosure">
            AI interviewer · synthetic voice and video. Your camera stays off.{' '}
            {selection
              ? 'Uses your selected saved scenario.'
              : 'Open conversation with no supplied company context.'}
            Demo interviews last up to two minutes and use your LiveAvatar credits.
          </p>
          {!state.capabilities.avatarReady && (
            <p className="notice">
              Live video needs LiveAvatar setup. Voice-only practice is available in the other tab.
            </p>
          )}
        </section>
        <article className="panel transcript">
          <div className="transcript-heading">
            <h3>{session?.transcriptReceivedAt ? 'Saved transcript' : 'Live conversation'}</h3>
            <span className="count">{session?.status ?? 'Ready'}</span>
          </div>
          <p className="muted">
            {session?.transcriptReceivedAt
              ? session.mode === RehearsalMode.LIVEAVATAR
                ? 'Saved directly from LiveAvatar.'
                : 'Saved from the verified ElevenLabs webhook.'
              : 'Captions appear as you talk. The provider transcript is retrieved after the interview.'}
          </p>
          {turns.map((turn, index) => (
            <div className="turn" key={index}>
              <small>{turn.role === 'agent' ? 'AI interviewer' : 'You'}</small>
              <p>{turn.text}</p>
            </div>
          ))}
          {!turns.length && <p className="notice">Your conversation will appear here.</p>}
          {session && session.status !== 'active' && !session.transcriptReceivedAt && (
            <p className="notice">
              {session.mode === RehearsalMode.LIVEAVATAR
                ? 'Waiting for LiveAvatar to finish the transcript.'
                : 'Waiting for the ElevenLabs webhook.'}
              {session.mode === RehearsalMode.LIVEAVATAR && session.avatarSessionId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void command(
                      `/avatar/sessions/${encodeURIComponent(session.id)}/transcript`,
                      {},
                    )
                      .then(onRefresh)
                      .catch(() => {
                        onError('Transcript is not available yet. Retry shortly.');
                      })
                      .finally(() => {
                        if (mounted.current) {
                          setBusy(false);
                        }
                      });
                  }}
                >
                  Retry saving transcript
                </button>
              )}
            </p>
          )}
        </article>
      </div>
      {sessions.length > 0 && (
        <section className="panel avatar-history">
          <h3>Video interview history</h3>
          {[...sessions].reverse().map((item) => (
            <div className="practice-actions" key={item.id}>
              <button
                className="text-button"
                disabled={running || busy}
                onClick={() => {
                  setSessionId(item.id);
                  onSelection?.(item.context?.version === 2 ? item.context.selection : undefined);
                  setPreview([]);
                }}
              >
                {new Date(item.createdAt).toLocaleString()} · {item.status}
              </button>
              {item.status === 'active' && item.id !== activeId.current && (
                <button
                  className="button secondary"
                  disabled={busy || running}
                  onClick={() => {
                    setBusy(true);
                    void endAvatarSession(item.id, false)
                      .then(onRefresh)
                      .catch(() => {
                        onError('Could not stop the interrupted interview. Retry.');
                      })
                      .finally(() => {
                        setBusy(false);
                      });
                  }}
                >
                  Stop interrupted interview
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
