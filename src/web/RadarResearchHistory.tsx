import { useEffect, useState } from 'react';
import type { z } from 'zod';
import {
  ResearchRunKind,
  researchRunListSchema,
  researchRunSchema,
  type ResearchRun,
} from '../contracts/ResearchRun.js';
import { request } from './ApiClient.js';

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Not available');

/** Lazy saved-history reads only. Parent keys the view by investor to isolate selection and responses. */
export function RadarResearchHistory({
  investorId,
  revision = 0,
}: {
  investorId?: string;
  revision?: number;
}) {
  const [runs, setRuns] = useState<z.infer<typeof researchRunListSchema> | null>(null);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState('discovery');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRuns(null);
    const query = new URLSearchParams({
      limit: '10',
      offset: String(offset),
      ...(investorId ? { investorId } : { kind }),
    });
    void request(`/research-runs?${query.toString()}`, researchRunListSchema, undefined, 'GET')
      .then((value) => {
        if (active) {
          setRuns(value);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Unable to load research history. Refresh the feed to retry.');
      });
    return () => {
      active = false;
    };
  }, [investorId, kind, offset, revision]);
  useEffect(() => {
    let active = true;
    setRun(null);
    if (selectedId)
      void request(
        `/research-runs/${encodeURIComponent(selectedId)}`,
        researchRunSchema,
        undefined,
        'GET',
      )
        .then((value) => {
          if (active) {
            setRun(value);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Unable to load the selected research run.');
        });
    return () => {
      active = false;
    };
  }, [selectedId, revision]);
  return (
    <section
      className="radar-history"
      aria-label={investorId ? 'Investor research history' : 'Company research archive'}
    >
      <h3>Saved research runs</h3>
      {!investorId && (
        <label>
          Research type{' '}
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setOffset(0);
              setSelectedId(null);
            }}
          >
            {Object.values(ResearchRunKind).map((value) => (
              <option key={value} value={value}>
                {value === 'discovery'
                  ? 'Investor discovery'
                  : value === 'investor'
                    ? 'Investor checks'
                    : 'Company radar'}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted">
        Extraction success does not establish investor identity or imply a new news event.
      </p>
      {error && <p role="alert">{error}</p>}
      {!runs && !error && <p role="status">Loading research history…</p>}
      {runs?.items.length === 0 && <p>No research runs saved yet.</p>}
      {runs?.items.map((item) => (
        <button key={item.id} className="radar-run" onClick={() => setSelectedId(item.id)}>
          <strong>
            {item.kind} · {item.status.replaceAll('_', ' ')}
          </strong>
          <span>
            {when(item.finishedAt)} · {item.sourceCount} sources · {item.evidenceCount} extracted
            claims
          </span>
        </button>
      ))}
      <div className="radar-actions">
        {offset > 0 && (
          <button className="button secondary" onClick={() => setOffset(0)}>
            Latest runs
          </button>
        )}
        {runs?.nextOffset !== null && runs?.nextOffset !== undefined && (
          <button className="button secondary" onClick={() => setOffset(runs.nextOffset ?? 0)}>
            Older runs
          </button>
        )}
      </div>
      {selectedId && !run && !error && <p role="status">Loading selected run…</p>}
      {run && (
        <section aria-label="Research run details">
          <h3>{run.status.replaceAll('_', ' ')}</h3>
          {run.failure && <p className="error">{run.failure.reason}</p>}
          {run.searches.flatMap((search) =>
            search.sources.map((source, index) => (
              <details key={`${search.query}-${index}`}>
                <summary>{source.title}</summary>
                <p>
                  Retrieved {when(search.retrievedAt)} · Published{' '}
                  {source.publishedDate ?? 'Unknown'}
                </p>
                <blockquote className="radar-source-text">
                  {source.text ?? source.highlights?.join('\n') ?? 'No source text'}
                </blockquote>
                <p>
                  Decision:{' '}
                  {run.decisions.find((d) => d.url === source.url)?.reason ??
                    run.decisions.find((d) => d.url === source.url)?.status ??
                    'Not extracted'}
                </p>
                {source.url.startsWith('https://') && (
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    Open source
                  </a>
                )}
              </details>
            )),
          )}
        </section>
      )}
    </section>
  );
}
