import { useEffect, useRef, useState } from 'react';
import {
  liveGuidanceHistorySchema,
  liveGuidanceResponseSchema,
  type LiveGuidanceResponse,
} from '../contracts/LiveGuidance.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { QuestionExplanation, evaluationWhySources } from './QuestionExplanation.js';
import './LiveGuidance.css';

type Entry = { key: string; turnIndex: number | null; data: LiveGuidanceResponse };
function mergeEntries(current: Entry[], incoming: Entry[]): Entry[] {
  const merged = [...current];
  for (const entry of incoming) {
    if (
      !merged.some(
        (item) => item.turnIndex === entry.turnIndex && item.data.question === entry.data.question,
      )
    ) {
      merged.push(entry);
    }
  }
  return merged.sort((a, b) => (a.turnIndex ?? 200) - (b.turnIndex ?? 200));
}

/** Saved guidance remains separate from the provider's verified transcript. */
export function LiveGuidance({
  sessionId,
  turns,
  running,
  onInspect,
}: {
  sessionId: string;
  turns: TranscriptTurn[];
  running: boolean;
  onInspect?: ((open: boolean) => void) | undefined;
}) {
  const lastAgent = turns.findLastIndex((turn) => turn.role === 'agent');
  const recent: TranscriptTurn[] = [];
  let length = 0;
  for (let index = lastAgent; index >= 0 && recent.length < 8; index -= 1) {
    const turn = turns[index];
    if (!turn || length + turn.text.length > 16000) break;
    recent.unshift(turn);
    length += turn.text.length;
  }
  const payload = JSON.stringify({ turns: recent, turnIndex: lastAgent });
  const question = turns[lastAgent]?.text ?? '';
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [pending, setPending] = useState('');
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const requested = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void request(
      `/rehearsals/${encodeURIComponent(sessionId)}/live-guidance`,
      liveGuidanceHistorySchema,
      undefined,
      'GET',
    )
      .then(({ entries: saved, context }) => {
        if (alive && context)
          setEntries((current) =>
            mergeEntries(
              current,
              saved.map((entry) => ({
                key: entry.id,
                turnIndex: entry.turnIndex,
                data: { question: entry.question, why: entry.why, factIds: entry.factIds, context },
              })),
            ),
          );
      })
      .catch(() => {
        if (alive)
          setHistoryError('Saved guidance could not be loaded. Reopen this session to retry.');
      });
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, [sessionId]);
  useEffect(() => {
    if (!running || !question || requested.current.has(payload)) return;
    const timer = setTimeout(() => {
      requested.current.add(payload);
      setError('');
      setPending(payload);
      const body: unknown = JSON.parse(payload);
      void request(
        `/rehearsals/${encodeURIComponent(sessionId)}/live-guidance`,
        liveGuidanceResponseSchema,
        body,
      )
        .then((data) => {
          // Keep replies even if a newer caption has arrived while inference was running.
          if (mounted.current)
            setEntries((current) =>
              mergeEntries(current, [{ key: payload, turnIndex: lastAgent, data }]),
            );
        })
        .catch(() => {
          requested.current.delete(payload);
          if (mounted.current)
            setError(
              'Guidance could not be saved for a turn. You can keep talking or retry guidance.',
            );
        })
        .finally(() => {
          if (mounted.current) setPending((current) => (current === payload ? '' : current));
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [sessionId, payload, question, lastAgent, running, retry]);

  if (!running && !entries.length && !historyError) return null;
  return (
    <section className="live-guidance" aria-label="Answer guidance history">
      <strong>Answer guidance · saved per turn</strong>
      <small>Caption-based preparation aid · separate from the verified transcript</small>
      {entries.map(({ key, data }) => (
        <article key={key} className="live-guidance-entry">
          <div className="live-guidance-heading">
            <blockquote>{data.question}</blockquote>
            <QuestionExplanation
              question={data.question}
              why={data.why}
              sources={evaluationWhySources(data.context)}
              facts={data.context.facts.filter((fact) => data.factIds.includes(fact.id))}
              onOpenChange={onInspect}
            />
          </div>
          <p>{data.why.answerObjective}</p>
          <small>{data.why.brief}</small>
          {data.context.sources.some((source) => source.origin === 'fictional') && (
            <small>Includes fictional demo evidence</small>
          )}
        </article>
      ))}
      {running && !entries.length && !question && (
        <p>Your interviewer’s question and guidance will appear here as you talk.</p>
      )}
      {running &&
        question &&
        !entries.some(
          (entry) => entry.turnIndex === lastAgent && entry.data.question === question,
        ) && <blockquote>{question}</blockquote>}
      {pending && <p role="status">Preparing and saving guidance…</p>}
      {historyError && <p role="status">{historyError}</p>}
      {error && <p role="status">{error}</p>}
      {error && running && (
        <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
          Retry guidance
        </button>
      )}
    </section>
  );
}
