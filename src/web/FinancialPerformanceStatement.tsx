import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  financialPerformanceSchema,
  type FinancialPerformance,
} from '../contracts/FinancialPerformance.js';
import { request } from './ApiClient.js';
import './FinancialPerformanceStatement.css';

type PerformanceRow = FinancialPerformance['rows'][number];
function display(value: string | null, signed = false): string {
  if (value === null) return '—';
  const [integer = '0', fractional] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signed && !value.startsWith('-') && /[1-9]/.test(value) ? '+' : ''}${grouped}${fractional ? `.${fractional}` : ''}`;
}
export function StatementBridge({
  value,
  min,
  max,
  prior = false,
}: {
  value: PerformanceRow['current'];
  min: number;
  max: number;
  prior?: boolean;
}) {
  if (!value) return <span className="statement-missing">—</span>;
  const scale = (amount: number) => 6 + ((amount - min) / Math.max(max - min, 1)) * 188;
  const start = scale(Number(value.start));
  const end = scale(Number(value.end));
  return (
    <span className="statement-measure">
      <svg
        viewBox="0 0 200 30"
        role="img"
        aria-label={`Bridge from ${value.start} to ${value.end}; amount ${value.value}`}
      >
        <line x1={scale(0)} x2={scale(0)} y1="0" y2="30" stroke="#d8dce0" />
        <rect
          x={Math.min(start, end)}
          y="7"
          width={Math.abs(end - start)}
          height="16"
          fill={prior ? '#b9bdc2' : '#252b32'}
        />
        <title>
          {value.value}; cumulative position {value.start} → {value.end}
        </title>
      </svg>
      <span>{display(value.value)}</span>
    </span>
  );
}
function Variance({
  value,
  domain,
  favorable,
  percent = false,
}: {
  value: string | null;
  domain: number;
  favorable: boolean | null;
  percent?: boolean;
}) {
  if (value === null) return <span className="statement-missing">—</span>;
  const number = Number(value);
  const width = Math.min(Math.abs(number) / Math.max(domain, 1), 1) * 47;
  const tone = favorable === null ? '#889098' : favorable ? '#709438' : '#c54c43';
  const clipped = Math.abs(number) > domain;
  const end = number < 0 ? 50 - width : 50 + width;
  return (
    <span className="statement-variance">
      <svg
        viewBox="0 0 100 30"
        role="img"
        aria-label={`${display(value, true)}${percent ? ' percent' : ''}${clipped ? '; bar clipped to scale' : ''}`}
      >
        <line x1="50" x2="50" y1="0" y2="30" stroke="#b8bfc5" />
        <rect x={number < 0 ? end : 50} y="9" width={width} height="12" fill={tone} />
        {clipped && (
          <path
            d={
              number < 0
                ? `M${end + 4} 5L${end - 2} 15L${end + 4} 25Z`
                : `M${end - 4} 5L${end + 2} 15L${end - 4} 25Z`
            }
            fill={tone}
          />
        )}
      </svg>
      <span>
        {display(value, true)}
        {percent ? '%' : ''}
      </span>
    </span>
  );
}
/** Presentation-only numbers are used for SVG geometry. Exact variance arithmetic lives on the server. */
export function FinancialStatementTable({
  data,
  onInspect,
}: {
  data: FinancialPerformance;
  onInspect?: (id: string) => void;
}) {
  const positions = data.rows.flatMap((row) =>
    [row.current, row.comparison].flatMap((value) =>
      value ? [Number(value.start), Number(value.end)] : [],
    ),
  );
  const min = Math.min(0, ...positions);
  const max = Math.max(1, ...positions);
  const deltaDomain = Math.max(1, ...data.rows.map((row) => Math.abs(Number(row.delta ?? 0))));
  const percentDomain = Math.min(
    100,
    Math.max(10, ...data.rows.map((row) => Math.abs(Number(row.deltaPercent ?? 0)))),
  );
  return (
    <div className="statement-scroll">
      <table className="financial-statement">
        <caption>
          Profit and loss comparison ·{' '}
          {data.currency === 'unspecified' ? 'currency not confirmed' : data.currency} · exact
          statement amounts
        </caption>
        <colgroup>
          <col className="statement-label-column" />
          <col />
          <col />
          <col className="statement-variance-column" />
          <col className="statement-variance-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Profit & loss</th>
            <th scope="col">
              <strong>{data.currentPeriod ?? 'Current period'}</strong>
              <span>Current</span>
            </th>
            <th scope="col">
              <strong>{data.comparisonPeriod ?? 'Unavailable'}</strong>
              <span>Comparison</span>
            </th>
            <th scope="col">
              Δ Amount<span>Current − comparison</span>
            </th>
            <th scope="col">
              Δ %<span>Vs. absolute base</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className={row.kind === 'subtotal' ? 'statement-subtotal' : ''}>
              <th scope="row">
                {onInspect ? (
                  <button onClick={() => onInspect(row.id)}>
                    {row.label}
                    <ArrowUpRight size={11} aria-hidden="true" />
                  </button>
                ) : (
                  row.label
                )}
              </th>
              <td>
                <StatementBridge value={row.current} min={min} max={max} />
              </td>
              <td>
                <StatementBridge value={row.comparison} min={min} max={max} prior />
              </td>
              <td>
                <Variance value={row.delta} domain={deltaDomain} favorable={row.favorable} />
              </td>
              <td>
                <Variance
                  value={row.deltaPercent}
                  domain={percentDomain}
                  favorable={row.favorable}
                  percent
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FinancialPerformanceStatement({
  revision,
  onEvidence,
}: {
  revision: number;
  onEvidence: () => void;
}) {
  const [data, setData] = useState<FinancialPerformance | null>(null);
  const [current, setCurrent] = useState('');
  const [comparison, setComparison] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (current) query.set('current', current);
    if (comparison) query.set('comparison', comparison);
    setLoading(true);
    void request(`/financial-performance?${query}`, financialPerformanceSchema, undefined, 'GET')
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError('');
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : 'Could not load financial performance.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, current, comparison, retry]);
  const selectedRow = data?.rows.find((row) => row.id === selected);
  return (
    <section
      className="performance-statement"
      aria-labelledby="performance-statement-title"
      aria-busy={loading}
    >
      <header className="statement-heading">
        <div>
          <span className="eyebrow">Financial position</span>
          <h3 id="performance-statement-title">Operating performance</h3>
          <p>From revenue to the operating result, with credits shown separately.</p>
        </div>
        <div className="statement-selectors">
          <label>
            Current period
            <select
              value={current || data?.currentPeriod || ''}
              disabled={!data?.availablePeriods.length || loading}
              onChange={(event) => {
                setCurrent(event.target.value);
                setComparison('');
              }}
            >
              {data?.availablePeriods
                .slice()
                .reverse()
                .map((period) => (
                  <option key={period}>{period}</option>
                ))}
            </select>
          </label>
          <label>
            Compare with
            <select
              value={comparison}
              disabled={!data?.availablePeriods.length || loading}
              onChange={(event) => setComparison(event.target.value)}
            >
              <option value="">Previous calendar month</option>
              {data?.availablePeriods
                .filter((period) => period < (current || data.currentPeriod || ''))
                .slice()
                .reverse()
                .map((period) => (
                  <option key={period}>{period}</option>
                ))}
            </select>
          </label>
        </div>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            className="text-button"
            onClick={() => {
              setCurrent('');
              setComparison('');
              setRetry((value) => value + 1);
            }}
          >
            Reset & retry
          </button>
        </p>
      )}
      {!data && loading && <p role="status">Loading financial statement…</p>}
      {data && !error && (
        <>
          {data.fictional && <span className="statement-fictional">Fictional demo financials</span>}
          {!data.rows.length ? (
            <div className="statement-empty">
              <p>{data.comparisonNote}</p>
              <button className="button secondary" onClick={onEvidence}>
                Select financial evidence
              </button>
            </div>
          ) : (
            <>
              <FinancialStatementTable data={data} onInspect={setSelected} />
              <div className="statement-key">
                <span>
                  <i className="key-current" /> Current
                </span>
                <span>
                  <i className="key-prior" /> Comparison
                </span>
                <span>
                  <i className="key-favorable" /> Favorable movement
                </span>
                <span>
                  <i className="key-unfavorable" /> Unfavorable movement
                </span>
              </div>
              <div className="statement-source">
                <span>
                  {data.fileName} · CSV row {data.currentSourceRow}
                  {data.comparisonSourceRow ? ` / comparison row ${data.comparisonSourceRow}` : ''}
                </span>
                <button className="text-button" onClick={onEvidence}>
                  Review financial explanation <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              </div>
              {selectedRow && (
                <div className="statement-inspector" role="status">
                  <strong>{selectedRow.label}</strong>
                  <p>{selectedRow.formula}</p>
                  <p>
                    Source columns: {selectedRow.sourceColumns.join(', ')}. Current:{' '}
                    {display(selectedRow.current?.value ?? null)}; comparison:{' '}
                    {display(selectedRow.comparison?.value ?? null)}.
                  </p>
                  <button className="text-button" onClick={() => setSelected(null)}>
                    Close source detail
                  </button>
                </div>
              )}
              <details className="statement-method">
                <summary>Comparison methodology & limitations</summary>
                <p>{data.comparisonNote}</p>
                <p>
                  Current and comparison bridges share one scale. Each contribution spans its
                  cumulative start/end; subtotals start at zero. Variance bars use separate
                  zero-centered scales. Percentage bars are clipped at ±100% when necessary;
                  arrowheads identify clipping and labels retain actual values. Missing comparisons
                  and zero percentage bases remain unavailable.
                </p>
                <p>
                  This is reported financial history. It does not estimate runway, a funding date,
                  or the outcome of proposed business changes.
                </p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
