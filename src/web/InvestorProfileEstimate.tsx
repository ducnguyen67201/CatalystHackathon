import { useEffect, useId, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { LoaderCircle, Sparkles } from 'lucide-react';
import {
  investorProfileEstimateViewSchema,
  type InvestorProfileEstimateView,
  type SavedInvestorProfileEstimate,
} from '../contracts/InvestorProfileEstimate.js';
import { jobSchema } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import './InvestorProfileEstimate.css';

const pending = (view: InvestorProfileEstimateView | null) =>
  view?.job?.status === 'queued' || view?.job?.status === 'running';

export function InvestorProfileEstimateCard({
  estimate,
  outdated,
}: {
  estimate: SavedInvestorProfileEstimate;
  outdated: boolean;
}) {
  const output = estimate.output;
  const range = output.checkSize.range;
  const check = range
    ? `${range.currency} ${new Decimal(range.min).toFixed()}–${new Decimal(range.max).toFixed()}`
    : null;
  const rows = [
    { label: 'Stage', ...output.stage },
    { label: 'Sector', ...output.sector },
    { label: 'Geography', ...output.geography },
    { label: 'Typical check', value: check, basis: output.checkSize.basis },
    { label: 'Priorities', ...output.priorities },
  ];
  return (
    <>
      <p className="investor-estimate-notice">
        AI estimates · unverified · excluded from your match score.
        {outdated && ' Investor context changed; generate fresh estimates.'}
      </p>
      <dl className="investor-estimate-values">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value ?? 'Not enough information to estimate'}</dd>
          </div>
        ))}
      </dl>
      <details className="investor-estimate-details">
        <summary>Assumptions & context</summary>
        <p>
          {output.confidence === 'low' ? 'Low' : 'Medium'} confidence ·{' '}
          {new Date(estimate.generatedAt).toLocaleString()} · {estimate.model}
        </p>
        <ul>
          {rows.map((row) => (
            <li key={row.label}>
              <strong>{row.label}:</strong> {row.basis}
            </li>
          ))}
        </ul>
        <p>
          Uses model knowledge and saved public excerpts. No official-source verification was run.
        </p>
        {estimate.input.contextSources.map((source) => (
          <details key={source.id}>
            <summary>{source.title}</summary>
            <blockquote>{source.excerpt}</blockquote>
            <a href={source.url} target="_blank" rel="noreferrer">
              Open context source ↗
            </a>
          </details>
        ))}
      </details>
    </>
  );
}

/** An explicit model command; opening or polling the card never generates values. */
export function InvestorProfileEstimate({
  investorId,
  revision = 0,
  onView,
}: {
  investorId: string;
  revision?: number;
  onView?: (view: InvestorProfileEstimateView | null) => void;
}) {
  const [view, setView] = useState<InvestorProfileEstimateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const commandKey = useRef<string | null>(null);
  const statusId = useId();
  const path = `/investors/${encodeURIComponent(investorId)}/ai-profile`;
  useEffect(() => {
    let active = true;
    let loading = false;
    let timer: number | undefined;
    onView?.(null);
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      window.clearTimeout(timer);
      try {
        const next = await request(path, investorProfileEstimateViewSchema, undefined, 'GET');
        if (active) {
          setView(next);
          onView?.(next);
          setError('');
          if (pending(next)) timer = window.setTimeout(() => void load(), 6000);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Unable to load AI profile.');
          timer = window.setTimeout(() => void load(), 10000);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const visible = () => void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [path, reload, revision, onView]);
  const working = busy || pending(view);
  const status = busy
    ? 'Starting AI profile…'
    : view?.job?.status === 'running'
      ? `Generating AI profile…${view.job.attempts > 1 ? ` Attempt ${view.job.attempts} of 3.` : ''}`
      : view?.job?.status === 'queued'
        ? view.job.error
          ? 'Retry queued. Waiting for the worker…'
          : 'AI profile queued. Waiting for the worker…'
        : view?.job?.status === 'failed'
          ? 'AI profile generation failed. You can try again.'
          : view?.job?.status === 'succeeded' && !view.estimate
            ? (view.job.result ?? 'No estimates saved. Try again.')
            : !view?.ready && view
              ? 'AI profile generation is unavailable.'
              : '';
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commandKey.current ??= crypto.randomUUID();
      const job = await request(path, jobSchema, { key: commandKey.current });
      commandKey.current = null;
      setView((current) =>
        current
          ? {
              ...current,
              job: {
                id: job.id,
                status: job.status,
                attempts: job.attempts,
                error: job.error,
                result: job.result,
              },
            }
          : current,
      );
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to generate AI profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="investor-profile-estimate" aria-label="AI investor profile">
      <h3>
        Investor profile <span>AI estimate</span>
      </h3>
      {view?.estimate ? (
        <InvestorProfileEstimateCard estimate={view.estimate} outdated={view.outdated} />
      ) : (
        <p className="investor-estimate-notice">
          Generate tentative criteria to explore this investor. Values will be labeled unverified.
        </p>
      )}
      {view?.estimate && !working && view.job?.status !== 'failed' ? (
        <details className="investor-estimate-details">
          <summary>Update AI estimates</summary>
          <button
            className="button secondary"
            disabled={!view.ready}
            onClick={() => void generate()}
          >
            Generate again
          </button>
        </details>
      ) : (
        <button
          className="button secondary"
          disabled={working || !view?.ready}
          aria-busy={working}
          aria-describedby={statusId}
          onClick={() => void generate()}
        >
          {working ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {working ? 'Generating AI profile…' : 'Generate AI profile'}
        </button>
      )}
      <p id={statusId} role="status" className="investor-estimate-status">
        {status}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
