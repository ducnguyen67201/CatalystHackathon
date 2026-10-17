import { useEffect, useState } from 'react';
import {
  liveGuidanceResponseSchema,
  type LiveGuidanceResponse,
} from '../contracts/LiveGuidance.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { QuestionExplanation, evaluationWhySources } from './QuestionExplanation.js';
import './LiveGuidance.css';

/** Both transports use the actual caption stream; no independent text session is started. */
export function LiveGuidance({
  sessionId,
  turns,
  running,
}: {
  sessionId: string;
  turns: TranscriptTurn[];
  running: boolean;
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
  const payload = JSON.stringify({ turns: recent });
  const question = turns[lastAgent]?.text ?? '';
  const [result, setResult] = useState<{ payload: string; data: LiveGuidanceResponse } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    setPending(false);
    if (!running || !question || result?.payload === payload) return;
    setPending(true);
    // Coalesce caption bursts; superseded replies can never replace the current prompt.
    const timer = setTimeout(() => {
      const body: unknown = JSON.parse(payload);
      void request(
        `/rehearsals/${encodeURIComponent(sessionId)}/live-guidance`,
        liveGuidanceResponseSchema,
        body,
      )
        .then((data) => {
          if (alive) setResult({ payload, data });
        })
        .catch(() => {
          if (alive) setError('Guidance is unavailable for this turn. You can keep talking.');
        })
        .finally(() => {
          if (alive) setPending(false);
        });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionId, payload, question, running, retry]);

  const data = result?.payload === payload ? result.data : null;
  if (!running && !data) return null;
  return (
    <section className="live-guidance" aria-label="Live answer guidance">
      <div className="live-guidance-heading">
        <strong>Answer guidance</strong>
        {data && (
          <QuestionExplanation
            key={payload}
            question={question}
            why={data.why}
            sources={evaluationWhySources(data.context)}
            facts={data.context.facts.filter((fact) => data.factIds.includes(fact.id))}
          />
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {question ? (
          <blockquote>{question}</blockquote>
        ) : (
          <p>Your interviewer’s question and guidance will appear here as you talk.</p>
        )}
        {data && (
          <>
            <p>{data.why.answerObjective}</p>
            <small>{data.why.brief}</small>
            {data.context.sources.some((source) => source.origin === 'fictional') && (
              <small>Includes fictional demo evidence</small>
            )}
          </>
        )}
        {pending && <p role="status">Preparing guidance for this turn…</p>}
        {error && <p role="status">{error}</p>}
      </div>
      {error && running && (
        <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
          Retry guidance
        </button>
      )}
    </section>
  );
}
