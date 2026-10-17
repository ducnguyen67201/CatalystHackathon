import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Mic, MicOff, Square } from 'lucide-react';
import { z } from 'zod';
import type { StateResponse, TranscriptTurn } from '../contracts/Workspace.js';
import { endVoicePractice, startVoicePractice } from './VoicePracticeClient.js';
import { describeVoiceFailure } from './VoiceFailure.js';
import './AvatarPractice.css';
import type { ScenarioSelection } from '../contracts/Scenario.js';

const AvatarPractice = lazy(async () => {
  const module = await import('./AvatarPractice.js');
  return { default: module.AvatarPractice };
});

interface Props {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  selection?: ScenarioSelection | undefined;
  onSelection?: ((selection: ScenarioSelection | undefined) => void) | undefined;
  onLockChange?: (locked: boolean) => void;
  startDisabled?: boolean;
}

const messageSchema = z.object({
  message: z.string().min(1).max(10000),
  source: z.enum(['user', 'ai']),
});

/** Standalone voice surface: no brief, onboarding or research dependency. */
export function VoicePractice({
  state,
  onRefresh,
  onError,
  selection,
  onSelection,
  startDisabled = false,
}: Props) {
  const [videoMode, setVideoMode] = useState(true);
  const [sessionBusy, setSessionBusy] = useState(false);
  return (
    <>
      <div className="interview-mode" aria-label="Interview format">
        <button
          className="button secondary"
          aria-pressed={videoMode}
          disabled={sessionBusy}
          onClick={() => {
            onError('');
            setVideoMode(true);
          }}
        >
          Live AI interviewer
        </button>
        <button
          className="button secondary"
          aria-pressed={!videoMode}
          disabled={sessionBusy}
          onClick={() => {
            onError('');
            setVideoMode(false);
          }}
        >
          Voice only
        </button>
      </div>
      {videoMode ? (
        <Suspense fallback={<p role="status">Loading interview room…</p>}>
          <AvatarPractice
            state={state}
            onRefresh={onRefresh}
            onError={onError}
            selection={selection}
            onSelection={onSelection}
            startDisabled={startDisabled}
            onLockChange={setSessionBusy}
          />
        </Suspense>
      ) : (
        <ConversationProvider>
          <VoicePracticeSession
            state={state}
            onRefresh={onRefresh}
            onError={onError}
            selection={selection}
            onSelection={onSelection}
            startDisabled={startDisabled}
            onLockChange={setSessionBusy}
          />
        </ConversationProvider>
      )}
    </>
  );
}

function VoicePracticeSession({
  state,
  onRefresh,
  onError,
  selection,
  onSelection,
  onLockChange,
  startDisabled = false,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TranscriptTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  const starting = useRef(false);
  const closing = useRef(false);
  const activeId = useRef<string | null>(null);
  const browserSupportsVoice =
    typeof RTCPeerConnection !== 'undefined' && typeof AudioContext !== 'undefined';

  const conversation = useConversation({
    onMessage: (raw: unknown) => {
      const parsed = messageSchema.safeParse(raw);
      if (mounted.current && activeId.current && parsed.success) {
        const turn: TranscriptTurn = {
          role: parsed.data.source === 'ai' ? 'agent' : 'user',
          text: parsed.data.message,
        };
        setPreview((turns) => [...turns, turn].slice(-200));
      }
    },
    onError: (message: unknown) => {
      const failure = describeVoiceFailure(message);
      console.warn(
        JSON.stringify({
          event: 'voice_connection_failed',
          stage: 'sdk_connect',
          sessionId: activeId.current,
          signals: failure.signals,
        }),
      );
      if (mounted.current) {
        onError(failure.message);
      }
      void finish(false);
    },
    onDisconnect: () => {
      if (activeId.current && !closing.current) {
        void finish(false);
      }
    },
  });

  const sessions = state.workspace.rehearsals.filter(
    (item) =>
      item.context !== null && item.mode === 'elevenlabs' && item.avatarCorrelationHash === null,
  );
  const session = sessions.find((item) => item.id === sessionId);
  const verified =
    session?.transcriptReceivedAt !== null && session?.transcriptReceivedAt !== undefined;
  const turns = verified ? session.turns : preview;
  const abandoned = sessions.filter(
    (item) => item.status === 'active' && item.id !== activeId.current,
  );

  function isMounted(): boolean {
    return mounted.current;
  }

  async function start(): Promise<void> {
    if (startDisabled) return;
    if (starting.current || activeId.current) {
      return;
    }
    if (!browserSupportsVoice) {
      onError(
        'This browser does not expose WebRTC audio. Open this page in Chrome to use voice practice.',
      );
      return;
    }
    starting.current = true;
    onLockChange?.(true);
    onError('');
    setBusy(true);
    try {
      /* Ask before minting a token, so denied permission leaves no active server session. */
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      if (!isMounted()) {
        return;
      }
      const response = await startVoicePractice(selection);
      if (!isMounted()) {
        await endVoicePractice(response.session.id, false);
        return;
      }
      activeId.current = response.session.id;
      setSessionId(response.session.id);
      setPreview([]);
      setRunning(true);
      conversation.startSession({
        conversationToken: response.token,
        connectionType: 'webrtc',
        dynamicVariables: response.dynamicVariables,
      });
      await onRefresh();
    } catch (error) {
      if (activeId.current) {
        await finish(false);
      }
      if (mounted.current) {
        onError(
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'Allow microphone access in your browser, then try again.'
            : 'Could not start voice. Check the API connection and ElevenLabs configuration, then retry.',
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

  async function finish(completed: boolean): Promise<void> {
    const id = activeId.current;
    if (!id || closing.current) {
      return;
    }
    closing.current = true;
    setBusy(true);
    conversation.endSession();
    try {
      await endVoicePractice(id, completed);
      activeId.current = null;
      onLockChange?.(false);
      if (mounted.current) {
        setRunning(false);
        await onRefresh();
      }
    } catch {
      if (mounted.current) {
        onError(
          'Audio stopped, but the session could not be closed. Retry Finish when the API is available.',
        );
      }
    } finally {
      closing.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    if (!running) {
      return;
    }
    const connected = conversation.status === 'connected';
    const timer = setTimeout(
      () => {
        if (!connected) {
          onError('Voice connection timed out. Check your network and agent configuration.');
        }
        void finish(connected);
      },
      connected ? 10 * 60 * 1000 : 45000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [running, conversation.status]);

  useEffect(() => {
    mounted.current = true;
    closing.current = false;
    return () => {
      mounted.current = false;
      closing.current = true;
      conversation.endSession();
      const id = activeId.current;
      activeId.current = null;
      if (id) {
        void endVoicePractice(id, false).catch(() => undefined);
      }
    };
  }, []);

  return (
    <>
      <div className="voice-room">
        <section className="voice-stage">
          <div className="eyebrow">
            Browser voice · {selection ? 'selected scenario' : 'open conversation'}
          </div>
          <div
            className={`voice-orb ${conversation.isSpeaking ? 'speaking' : ''}`}
            aria-hidden="true"
          >
            {Array.from({ length: 7 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <h2>{running ? 'Talk it through with June.' : 'Start with a conversation.'}</h2>
          <p>
            {selection
              ? 'June will use the selected scenario and its saved company and investor context. Start when you are ready.'
              : 'Introduce your business and practise explaining it. Choose a saved scenario from Practice scenario for investor-specific preparation.'}{' '}
            This session saves a transcript without scoring financial answers.
          </p>
          <div className="voice-actions">
            {running ? (
              <>
                <div className="live-controls">
                  <button
                    className="voice-secondary"
                    disabled={conversation.status !== 'connected'}
                    onClick={() => {
                      conversation.setMuted(!conversation.isMuted);
                    }}
                  >
                    {conversation.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    {conversation.isMuted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      void finish(true);
                    }}
                  >
                    <Square size={12} /> Finish & save transcript
                  </button>
                </div>
                <p role="status">
                  {conversation.status} ·{' '}
                  {conversation.isSpeaking ? 'June is speaking' : 'Your turn'} · up to 10 minutes
                </p>
              </>
            ) : (
              <button
                className="button"
                disabled={
                  startDisabled ||
                  busy ||
                  !browserSupportsVoice ||
                  !state.capabilities.voiceReady ||
                  abandoned.length > 0
                }
                onClick={() => {
                  void start();
                }}
              >
                <Mic size={16} /> {busy ? 'Starting…' : 'Start voice practice'}
              </button>
            )}
            <small>
              {state.capabilities.voiceReady
                ? 'Microphone audio goes to ElevenLabs after you start. Final transcripts are saved in this workspace.'
                : 'Configure the ElevenLabs key, private agent and transcript webhook to enable voice.'}
            </small>
            {!browserSupportsVoice && (
              <p role="status">
                This browser does not expose WebRTC audio. Open http://127.0.0.1:4317/voice in
                Chrome.
              </p>
            )}
          </div>
        </section>
        <article className="panel transcript">
          <div className="transcript-heading">
            <h3>{verified ? 'Saved transcript' : 'Live transcript preview'}</h3>
            <span className="count">{session?.status ?? 'Ready'}</span>
          </div>
          <p className="muted">
            {verified
              ? 'Received from ElevenLabs through the verified webhook.'
              : 'Live captions are temporary. The verified transcript appears here after the session ends.'}
          </p>
          {turns.map((turn, index) => (
            <div className="turn" key={index}>
              <small>{turn.role === 'agent' ? 'June' : 'You'}</small>
              <p>{turn.text}</p>
            </div>
          ))}
          {!turns.length && (
            <p className="notice">
              {session
                ? 'No transcript received yet.'
                : 'Start a session to see the conversation here.'}
            </p>
          )}
          {session && !verified && session.status !== 'active' && (
            <p className="notice">
              Waiting for the provider transcript. If it does not arrive, check that the local
              webhook tunnel is running. Reopen this session below to check again.
            </p>
          )}
          {verified && turns.length === 0 && (
            <p className="notice">The provider returned no spoken turns for this session.</p>
          )}
        </article>
      </div>
      {sessions.length > 0 && (
        <section className="panel" style={{ padding: '24px', marginTop: '24px' }}>
          <h3>Saved sessions</h3>
          <p className="muted">Select a session to reopen its transcript after a refresh.</p>
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
              {abandoned.some((entry) => entry.id === item.id) && (
                <button
                  className="voice-secondary"
                  disabled={busy || running}
                  onClick={() => {
                    setBusy(true);
                    void endVoicePractice(item.id, false)
                      .then(onRefresh)
                      .catch(() => {
                        onError('Could not close the interrupted session. Try again.');
                      })
                      .finally(() => {
                        setBusy(false);
                      });
                  }}
                >
                  Close interrupted session
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
