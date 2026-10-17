import './PeerComparison.css';
import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  peerDashboardSchema,
  peerInputSchema,
  type PeerRecord,
} from '../contracts/PeerComparison.js';
import { request, command } from './ApiClient.js';
import { ComparisonChart, RevenueTrend } from './PeerCharts.js';

type Data = ReturnType<typeof peerDashboardSchema.parse>;
function PeerEditor({
  peer,
  startMonth,
  endMonth,
  onSaved,
  onCancel,
}: {
  peer: PeerRecord | null;
  startMonth: string;
  endMonth: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [peerId] = useState(() => peer?.peerId ?? crypto.randomUUID());
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => {
      const value = form.get(key);
      return typeof value === 'string' ? value : '';
    };
    const periods = [0, 1].map((index) => ({
      month: read(`month${index}`),
      revenue: read(`revenue${index}`),
      grossProfit: read(`grossProfit${index}`),
      operatingIncome: read(`operatingIncome${index}`),
    }));
    const body = peerInputSchema.safeParse({
      peerId,
      expectedVersion: peer?.version ?? 0,
      name: read('name'),
      stage: read('stage'),
      customer: read('customer'),
      businessModel: read('businessModel'),
      rationale: read('rationale'),
      currency: read('currency'),
      sourceUrl: read('sourceUrl'),
      excerpt: read('excerpt'),
      publishedAt: read('publishedAt') || null,
      fictional: form.has('fictional'),
      periods,
    });
    if (!body.success) {
      setError(
        body.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await command('/peers', body.data);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save peer evidence.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="peer-editor" onSubmit={(event) => void save(event)}>
      <h4>{peer ? 'Update peer evidence' : 'Add a comparable peer'}</h4>
      <p className="muted">
        Use total revenue, gross profit and operating income from monthly statements with the same
        accounting definitions. Source entries are unverified. Saving a revision preserves earlier
        evidence.
      </p>
      <div className="peer-form-grid">
        <label>
          Company
          <input name="name" required maxLength={100} defaultValue={peer?.name} />
        </label>
        <label>
          Stage
          <input name="stage" required maxLength={100} defaultValue={peer?.stage} />
        </label>
        <label>
          Customer segment
          <input name="customer" required maxLength={300} defaultValue={peer?.customer} />
        </label>
        <label>
          Business model
          <input name="businessModel" required maxLength={300} defaultValue={peer?.businessModel} />
        </label>
        <label>
          Statement currency
          <select name="currency" defaultValue={peer?.currency ?? 'USD'}>
            {['USD', 'CAD', 'EUR', 'GBP'].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <label>
          Source publication date (optional)
          <input type="date" name="publishedAt" defaultValue={peer?.publishedAt ?? ''} />
        </label>
      </div>
      <label>
        Why is this company comparable?
        <textarea name="rationale" required maxLength={1000} defaultValue={peer?.rationale} />
      </label>
      <label>
        Source URL (HTTPS)
        <input
          name="sourceUrl"
          type="url"
          required
          maxLength={1000}
          defaultValue={peer?.sourceUrl}
        />
      </label>
      <label>
        Supporting source passage
        <textarea name="excerpt" required maxLength={2000} defaultValue={peer?.excerpt} />
      </label>
      <p className="muted">
        Amounts below use the selected statement currency. Gross profit and operating income may be
        negative. Revenue must be nonnegative.
      </p>
      {[startMonth, endMonth].map((month, index) => {
        const row = peer?.periods.find((period) => period.month === month);
        return (
          <fieldset key={index}>
            <legend>{index === 0 ? 'Previous month' : 'Latest month'}</legend>
            <div className="peer-form-grid">
              <label>
                Period
                <input
                  type="month"
                  name={`month${index}`}
                  required
                  defaultValue={row?.month ?? month}
                />
              </label>
              <label>
                Total revenue
                <input
                  name={`revenue${index}`}
                  required
                  inputMode="decimal"
                  defaultValue={row?.revenue}
                />
              </label>
              <label>
                Gross profit
                <input
                  name={`grossProfit${index}`}
                  required
                  inputMode="decimal"
                  defaultValue={row?.grossProfit}
                />
              </label>
              <label>
                Operating income
                <input
                  name={`operatingIncome${index}`}
                  required
                  inputMode="decimal"
                  defaultValue={row?.operatingIncome}
                />
              </label>
            </div>
          </fieldset>
        );
      })}
      <label className="peer-check">
        <input type="checkbox" name="fictional" defaultChecked={peer?.fictional} /> These figures
        and sources are fictional demo evidence.
      </label>
      <p className="muted">
        Peer evidence is saved with new practice contexts. Comparisons are calculated locally; no
        extra research or model call is started. Fictional and real figures are never combined in a
        comparison.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="peer-actions">
        <button className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Save peer evidence'}
        </button>
        <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function PeerDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ peer: PeerRecord | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void request('/peers', peerDashboardSchema, undefined, 'GET')
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load peer comparisons.');
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  async function archive(peer: PeerRecord) {
    setBusy(true);
    try {
      await command(`/peers/${peer.peerId}/archive`, { expectedVersion: peer.version });
      setRevision((value) => value + 1);
    } catch {
      setError('Could not archive this peer. Reload and try again.');
    } finally {
      setBusy(false);
    }
  }
  const start =
    data?.comparison.metrics.find((metric) => metric.metric === 'revenue_growth')?.startMonth ?? '';
  const end = data?.comparison.metrics[0]?.endMonth ?? '';
  return (
    <section className="peer-dashboard" aria-label="Peer performance comparisons">
      <div className="dashboard-section-heading">
        <div>
          <h3>Your performance in context</h3>
          <p className="muted">Monthly revenue growth and margins against your selected peers.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => setEditing({ peer: null })}
          disabled={!end || !!editing || busy || (data?.peers.length ?? 0) >= 20}
        >
          Add peer
        </button>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setRevision((value) => value + 1)}>
            Reload
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading peer comparisons…</p>}
      {data && (
        <>
          <p className="peer-context">
            {data.comparison.fictional ? 'Fictional demo financials. ' : ''}Founder-selected peers;
            comparability is a judgment, not a verified match. Only matching currencies and
            reporting periods are included. Public data may be unavailable or outdated.
          </p>
          <div className="peer-chart-grid">
            <RevenueTrend comparison={data.comparison} />
            {data.comparison.metrics.map((metric) => (
              <ComparisonChart key={metric.metric} comparison={metric} />
            ))}
          </div>
          <p className="muted">
            Company figures: {data.comparison.fileName ?? 'no selected statement'} ·{' '}
            {data.comparison.currency}. Revenue growth uses the two latest consecutive calendar
            months; margins use the latest month.
          </p>
          {!end && <p>Upload financials to add peers and compare performance.</p>}
          <details>
            <summary>Manage peer group ({data.peers.length}/20)</summary>
            {!data.peers.length && (
              <p>
                No peers yet. Add a source-backed peer to begin; graphs will show only your own
                figures until then.
              </p>
            )}
            {data.peers.map((peer) => (
              <div key={peer.id} className="peer-source">
                <strong>{peer.name}</strong>
                <p>
                  {peer.stage} · {peer.customer} · {peer.businessModel}
                </p>
                <p>{peer.rationale}</p>
                <p>
                  {peer.fictional ? 'Fictional demo' : 'Unverified source'} · evidence version{' '}
                  {peer.version}
                </p>
                <div className="peer-actions">
                  <button
                    className="text-button"
                    disabled={busy || !!editing}
                    onClick={() => setEditing({ peer })}
                  >
                    Edit evidence
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || !!editing}
                    onClick={() => void archive(peer)}
                  >
                    Archive peer
                  </button>
                </div>
              </div>
            ))}
          </details>
          {editing && (
            <PeerEditor
              key={editing.peer?.id ?? 'new'}
              peer={editing.peer}
              startMonth={start}
              endMonth={end}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                setRevision((value) => value + 1);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
