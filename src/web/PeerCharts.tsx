import { useId } from 'react';
import {
  peerMetricLabels,
  type MetricComparison,
  type PeerComparison,
} from '../contracts/PeerComparison.js';

export function percentage(value: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value))}%`;
}
export function ComparisonChart({ comparison }: { comparison: MetricComparison }) {
  const id = useId();
  const { value, low, high } = comparison;
  const numbers = [value, low, high].filter((item): item is string => item !== null).map(Number);
  const min = Math.min(0, ...numbers);
  const max = Math.max(0, ...numbers);
  const padding = Math.max(5, (max - min) * 0.15);
  const floor = min - padding;
  const ceiling = max + padding;
  const x = (amount: string | number) => 30 + ((Number(amount) - floor) / (ceiling - floor)) * 440;
  const available = value !== null && low !== null && high !== null;
  return (
    <article className="peer-chart">
      <h4>{peerMetricLabels[comparison.metric]}</h4>
      <p className="muted">
        {comparison.startMonth === comparison.endMonth
          ? comparison.endMonth
          : `${comparison.startMonth} → ${comparison.endMonth}`}{' '}
        · {comparison.peers.length} selected peers
      </p>
      {available ? (
        <>
          <svg viewBox="0 0 500 130" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
            <title id={`${id}-title`}>{peerMetricLabels[comparison.metric]} comparison</title>
            <desc id={`${id}-desc`}>
              Your value {percentage(value)}. Selected peer range {percentage(low)} to{' '}
              {percentage(high)}. Your value is {comparison.position} the sample range.
            </desc>
            <line x1="30" x2="470" y1="64" y2="64" className="peer-axis" />
            <line x1={x(0)} x2={x(0)} y1="48" y2="82" className="peer-axis" />
            <rect
              x={x(low)}
              y="55"
              width={Math.max(2, x(high) - x(low))}
              height="18"
              rx="5"
              className="peer-range"
            />
            <circle cx={x(value)} cy="64" r="7" className="peer-dot" />
            <text x={Math.max(65, Math.min(435, x(value)))} y="29" textAnchor="middle">
              You {percentage(value)}
            </text>
            <text x="30" y="112">
              {percentage(String(floor))}
            </text>
            <text x="250" y="112" textAnchor="middle">
              Peer range {percentage(low)}–{percentage(high)}
            </text>
            <text x="470" y="112" textAnchor="end">
              {percentage(String(ceiling))}
            </text>
          </svg>
          <p className="peer-position">
            {comparison.position === 'within'
              ? 'Within'
              : comparison.position === 'above'
                ? 'Above'
                : 'Below'}{' '}
            this sample range. A small selected sample is not a market benchmark.
          </p>
        </>
      ) : (
        <p className="peer-empty">
          {value === null
            ? comparison.reason
            : `Your value: ${percentage(value)}. Add peers with matching periods, currency and evidence type to compare.`}
        </p>
      )}
      <details>
        <summary>Values and sources</summary>
        <p>
          Definition:{' '}
          {comparison.metric === 'revenue_growth'
            ? '(Latest total revenue − previous month total revenue) ÷ previous month total revenue × 100.'
            : comparison.metric === 'gross_margin'
              ? 'Monthly gross profit ÷ total revenue × 100.'
              : 'Monthly operating income ÷ total revenue × 100; other income excluded.'}{' '}
          Positive revenue is required.
        </p>
        <div className="peer-source">
          <strong>
            Your statement:{' '}
            {comparison.value === null ? 'Unavailable' : percentage(comparison.value)}
          </strong>
          <p>
            {comparison.companySource.fileName} · {comparison.companySource.currency} · snapshot{' '}
            {comparison.companySource.snapshotId}
          </p>
          <p>
            {comparison.companySource.fictional ? 'Fictional demo' : 'Uploaded financial evidence'}
          </p>
          {comparison.companySource.rows.map((row) => (
            <p key={row.month}>
              {row.month}: revenue {row.revenue}, gross profit {row.grossProfit}, operating income{' '}
              {row.operatingIncome} · CSV row {row.sourceRow}
            </p>
          ))}
        </div>
        {comparison.peers.map(({ peer, value: amount }) => (
          <div className="peer-source" key={peer.id}>
            <strong>
              {peer.name}: {percentage(amount)}
            </strong>
            <p>
              {peer.stage} · {peer.customer} · {peer.businessModel}
            </p>
            <p>Why included: {peer.rationale}</p>
            <p>
              {peer.fictional ? 'Fictional demo' : 'Founder-entered · unverified'} · Published{' '}
              {peer.publishedAt ?? 'date unknown'} · Saved {peer.recordedAt.slice(0, 10)}
            </p>
            <a href={peer.sourceUrl} target="_blank" rel="noopener noreferrer">
              Source ↗
            </a>
            <blockquote>{peer.excerpt}</blockquote>
            <p>
              {peer.periods
                .filter(
                  (row) => row.month === comparison.startMonth || row.month === comparison.endMonth,
                )
                .map(
                  (row) =>
                    `${row.month}: revenue ${row.revenue}, gross profit ${row.grossProfit}, operating income ${row.operatingIncome} ${peer.currency}`,
                )
                .join('; ')}
            </p>
          </div>
        ))}
        {comparison.excluded.map((item, index) => (
          <p key={index}>
            {item.name}: excluded — {item.reason}
          </p>
        ))}
      </details>
    </article>
  );
}
export function RevenueTrend({ comparison }: { comparison: PeerComparison }) {
  const id = useId();
  const points = comparison.trend;
  const max = Math.max(0, ...points.map((point) => Number(point.revenue)));
  const min = Math.min(0, ...points.map((point) => Number(point.revenue)));
  const span = max - min || 1;
  const y = (value: string | number) => 165 - ((Number(value) - min) / span) * 125;
  const x = (index: number) => 70 + (index / Math.max(1, points.length - 1)) * 360;
  const format = (value: number) =>
    new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return (
    <article className="peer-chart">
      <h4>Your revenue over time</h4>
      <p className="muted">
        Monthly total revenue · {comparison.currency} ·{' '}
        {comparison.fictional ? 'Fictional demo' : 'Uploaded statement'}
      </p>
      {points.length ? (
        <svg viewBox="0 0 500 215" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
          <title id={`${id}-title`}>Monthly total revenue</title>
          <desc id={`${id}-desc`}>
            {points
              .map((point) => `${point.month}: ${point.revenue} ${comparison.currency}`)
              .join('; ')}
            . Points are saved observations; no intermediate values are inferred.
          </desc>
          {[min, (min + max) / 2, max]
            .filter((v, i, all) => all.indexOf(v) === i)
            .map((amount) => (
              <g key={amount}>
                <line x1="70" x2="430" y1={y(amount)} y2={y(amount)} className="peer-axis" />
                <text x="60" y={y(amount) + 4} textAnchor="end">
                  {format(amount)}
                </text>
              </g>
            ))}
          {points.map((point, index) => (
            <circle
              key={point.month}
              cx={x(index)}
              cy={y(point.revenue)}
              r="5"
              className="peer-dot"
            >
              <title>
                {point.month}: {point.revenue} {comparison.currency}
              </title>
            </circle>
          ))}
          <text x="70" y="200">
            {points[0]?.month}
          </text>
          <text x="430" y="200" textAnchor="end">
            {points.length > 1 ? points.at(-1)?.month : ''}
          </text>
        </svg>
      ) : (
        <p className="peer-empty">Upload financials to see your revenue trend.</p>
      )}
      <details>
        <summary>Statement values</summary>
        <p>
          {comparison.fileName ?? 'No statement'} · snapshot{' '}
          {comparison.snapshotId ?? 'unavailable'}
        </p>
        <ul>
          {points.map((point) => (
            <li key={point.month}>
              {point.month}: {point.revenue} {comparison.currency} · CSV row {point.sourceRow}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
