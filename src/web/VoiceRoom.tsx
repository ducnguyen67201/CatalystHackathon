import { useEffect, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import { Mic, MicOff, Square, ArrowRight } from 'lucide-react';
import { z } from 'zod';
import type { Brief, Rehearsal, StateResponse, TranscriptTurn } from '../contracts/Workspace.js';
import { command, startRehearsal } from './ApiClient.js';
interface Props {
  state: StateResponse;
  brief: Brief;
  onRefresh: () => Promise<void>;
  onBrief: () => void;
  onError: (message: string) => void;
}
const messageSchema = z.object({ message: z.string(), source: z.enum(['user', 'ai']) });
export function VoiceRoom({ state, brief, onRefresh, onBrief, onError }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveTurns, setLiveTurns] = useState<TranscriptTurn[]>([]);
  const [mode, setMode] = useState<'text' | 'demo' | 'elevenlabs'>('text');
  const activeRef = useRef<string | null>(null);
  const ending = useRef(false);
  const conversation = useConversation({
    onMessage: (raw: unknown) => {
      const parsed = messageSchema.safeParse(raw);
      if (parsed.success) {
        setLiveTurns((turns) => [
          ...turns,
          { role: parsed.data.source === 'ai' ? 'agent' : 'user', text: parsed.data.message },
        ]);
      }
    },
    onError: () => {
      onError('Voice connection failed. Check microphone permission and ElevenLabs configuration.');
    },
    onDisconnect: () => {
      const id = activeRef.current;
      if (id && !ending.current) {
        void command(`/rehearsals/${id}/end`, { turns: [], completed: false })
          .then(onRefresh)
          .catch(() => {
            onError('The interrupted session could not be saved.');
          });
      }
    },
  });
  const session: Rehearsal | undefined = state.workspace.rehearsals.find(
    (item) => item.id === sessionId,
  );
  async function run(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Practice failed.');
    } finally {
      setBusy(false);
    }
  }
  async function start(selected: 'text' | 'demo' | 'elevenlabs'): Promise<void> {
    await run(async () => {
      const response = await startRehearsal(brief.id, selected);
      setMode(selected);
      setSessionId(response.session.id);
      activeRef.current = response.session.id;
      ending.current = false;
      setLiveTurns([]);
      if (selected === 'elevenlabs' && response.token) {
        conversation.startSession({
          conversationToken: response.token,
          connectionType: 'webrtc',
          webRtc: { singlePeerConnection: false },
          dynamicVariables: {
            company_name: state.workspace.profile.name,
            brief_context: response.context,
            previous_session_summary: response.previousSummary,
          },
        });
      }
      await onRefresh();
    });
  }
  async function finish(completed = true): Promise<void> {
    await run(async () => {
      const id = activeRef.current;
      if (!id) {
        return;
      }
      ending.current = true;
      if (mode === 'elevenlabs') {
        conversation.endSession();
      }
      await command(`/rehearsals/${id}/end`, { turns: [], completed });
      activeRef.current = null;
      await onRefresh();
    });
  }
  useEffect(() => {
    if (conversation.status !== 'connected') {
      return;
    }
    const timer = setTimeout(
      () => {
        void finish();
      },
      10 * 60 * 1000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [conversation.status]);
  useEffect(
    () => () => {
      if (activeRef.current) {
        conversation.endSession();
        void command(`/rehearsals/${activeRef.current}/end`, { turns: [], completed: false }).catch(
          () => undefined,
        );
      }
    },
    [],
  );
  const turns = mode === 'elevenlabs' ? liveTurns : (session?.turns ?? []);
  const active = session?.status === 'active';
  return (
    <>
      <div className="voice-room">
        <div className="voice-stage">
          <div className="eyebrow">
            {mode === 'elevenlabs'
              ? 'ElevenLabs · browser voice'
              : 'Practice partner · evidence first'}
          </div>
          <div
            className={`voice-orb ${conversation.isSpeaking ? 'speaking' : ''}`}
            aria-hidden="true"
          >
            {Array.from({ length: 7 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <h2>
            {active
              ? 'Let’s talk through the numbers.'
              : session?.review
                ? 'Your next conversation is clearer.'
                : 'Make the explanation yours.'}
          </h2>
          <p>
            {active
              ? brief.finding.question
              : 'Use your sourced brief to practise, then carry the open questions into your next review.'}
          </p>
          <div className="voice-actions">
            {!sessionId ? (
              <>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void start('text');
                  }}
                >
                  Start written practice <ArrowRight size={14} />
                </button>
                <button
                  className="voice-secondary"
                  disabled={busy || !state.capabilities.voiceReady}
                  onClick={() => {
                    void start('elevenlabs');
                  }}
                >
                  <Mic size={14} /> Talk with ElevenLabs
                </button>
                <small>
                  {state.capabilities.voiceReady
                    ? 'Microphone starts when you choose voice.'
                    : 'Live voice needs your ElevenLabs key and agent ID.'}
                </small>
                <button
                  className="text-button"
                  onClick={() => {
                    void start('demo');
                  }}
                  disabled={busy}
                >
                  Try the scripted example
                </button>
              </>
            ) : active ? (
              <>
                <div className="live-controls">
                  {mode === 'elevenlabs' && (
                    <button
                      className="voice-secondary"
                      onClick={() => {
                        conversation.setMuted(!conversation.isMuted);
                      }}
                    >
                      {conversation.isMuted ? <MicOff size={16} /> : <Mic size={16} />}{' '}
                      {conversation.isMuted ? 'Unmute' : 'Mute'}
                    </button>
                  )}
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      void finish();
                    }}
                  >
                    <Square size={12} /> Finish & update brief
                  </button>
                </div>
                <small>
                  {mode === 'elevenlabs'
                    ? `${conversation.status} · up to 10 minutes`
                    : 'Written coaching uses deterministic topic checks.'}
                </small>
              </>
            ) : (
              <>
                <button className="button" onClick={onBrief}>
                  See updated meeting brief <ArrowRight size={14} />
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setSessionId(null);
                    setLiveTurns([]);
                  }}
                >
                  Start another rehearsal
                </button>
              </>
            )}
          </div>
        </div>
        <article className="panel transcript">
          <div className="transcript-heading">
            <h3>Conversation & evidence</h3>
            <span className="count">{session?.status ?? 'Ready'}</span>
          </div>
          {turns.length ? (
            turns.map((turn, index) => (
              <div className="turn" key={index}>
                <small>
                  {turn.role === 'agent'
                    ? 'Practice partner'
                    : mode === 'demo'
                      ? 'Founder · scripted example'
                      : 'Your answer'}
                </small>
                <p>{turn.text}</p>
              </div>
            ))
          ) : (
            <>
              <div className="turn">
                <small>From your brief · {brief.finding.month}</small>
                <p>
                  Operating result: {brief.finding.operatingIncome}
                  <br />
                  Other income credit: {brief.finding.credit}
                  <br />
                  Net income: {brief.finding.netIncome}
                </p>
              </div>
              <div className="turn">
                <small>Your evidence stays pinned</small>
                <p>
                  This session uses the selected brief and financial snapshot. New research updates
                  appear in the next brief.
                </p>
              </div>
            </>
          )}
          {session?.review && (
            <div className="answer">
              <h3>Rehearsal review</h3>
              <p>{session.review.note}</p>
              <p>
                {session.review.missing.length
                  ? `Still to address: ${session.review.missing.join(', ')}.`
                  : 'All expected themes appeared. Verify the actual figures against the evidence.'}
              </p>
            </div>
          )}
          {session?.status === 'awaiting_transcript' && (
            <p className="notice">
              Waiting for ElevenLabs’ verified transcript webhook. Your brief updates when it
              arrives.
            </p>
          )}
        </article>
      </div>
      {active && mode !== 'elevenlabs' && (
        <form
          className="panel answer-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (!sessionId) {
                return;
              }
              await command(`/rehearsals/${sessionId}/answers`, { text });
              setText('');
              await onRefresh();
            });
          }}
        >
          <label htmlFor="answer">Your answer</label>
          <textarea
            id="answer"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            required
            placeholder="Explain what drove the result and what you would check next…"
          />
          <div className="practice-actions">
            {mode === 'demo' ? (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setText(
                    session.turns.filter((turn) => turn.role === 'user').length
                      ? 'The net profit includes a credit, while operations still lost money. We need cash-flow data to explain runway.'
                      : 'July’s net income was positive, so we’re profitable.',
                  );
                }}
              >
                Insert scripted example
              </button>
            ) : (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setText(brief.finding.answer);
                }}
              >
                Use the sourced explanation
              </button>
            )}
            <button className="button" disabled={busy || !text.trim()}>
              Answer & follow up →
            </button>
          </div>
        </form>
      )}
    </>
  );
}
