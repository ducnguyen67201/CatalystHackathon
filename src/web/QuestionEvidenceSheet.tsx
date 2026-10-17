import { useEffect, useRef, useState } from 'react';
import type { QuestionFinancialRow } from '../features/QuestionEvidence.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';

const metrics = [
  { key: 'revenue', label: 'Revenue', column: 'total_revenue', metric: 'revenue' },
  { key: 'cogs', label: 'Cost of goods sold', column: 'total_cogs', metric: 'cogs' },
  { key: 'grossProfit', label: 'Gross profit', column: 'gross_profit', metric: 'gross_profit' },
  {
    key: 'expenses',
    label: 'Operating expenses',
    column: 'total_operating_expenses',
    metric: 'operating_expenses',
  },
  {
    key: 'operatingIncome',
    label: 'Operating income',
    column: 'operating_income',
    metric: 'operating_income',
  },
  {
    key: 'credit',
    label: 'Other income / credit',
    column: 'other_income_srred_credit',
    metric: 'other_income_credit',
  },
  { key: 'netIncome', label: 'Net income', column: 'net_income', metric: 'net_income' },
] as const;

/** String formatting retains the saved sign and decimal precision without numerical conversion. */
export function formatEvidenceAmount(value: string): string {
  const [integer = '', fraction] = value.split('.');
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction)
  );
}

export function QuestionEvidenceSheet({
  rows,
  selectedKey,
  facts,
  onSelectPeriod,
  open = true,
}: {
  rows: QuestionFinancialRow[];
  selectedKey: string;
  facts: EvaluationContext['facts'];
  onSelectPeriod: (key: string) => void;
  open?: boolean;
}) {
  const selected = rows.find((row) => row.key === selectedKey) ?? rows[0];
  const cited = facts.find((fact) => fact.sourceIds.includes(selected?.sourceId ?? ''));
  const [metricKey, setMetricKey] = useState<string>(cited?.metric ?? 'operating_income');
  const activeColumn = useRef<HTMLTableCellElement>(null);
  const activePeriod = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      activeColumn.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      activePeriod.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKey, open]);
  if (!selected) return <p>No readable financial rows are available.</p>;
  const visible = rows
    .filter((row) => row.snapshotId === selected.snapshotId)
    .sort((a, b) => a.values.month.localeCompare(b.values.month));
  const metric = metrics.find((item) => item.metric === metricKey) ?? metrics[4];
  const calculations = facts.filter(
    (fact) =>
      fact.sourceIds.includes(selected.sourceId) &&
      !metrics.some((item) => item.metric === fact.metric),
  );
  return (
    <div className="question-evidence-sheet">
      <div className="question-sheet-toolbar">
        <div>
          <strong>{selected.fileName ?? 'Saved financial source'}</strong>
          <small>
            {selected.role === 'previous' ? 'Previous snapshot · ' : ''}Read-only income statement ·{' '}
            {selected.currency === 'unspecified' ? 'Currency unconfirmed' : selected.currency}
          </small>
        </div>
        <span className="question-sheet-badge">Saved values</span>
      </div>
      <div className="question-period-strip" aria-label="Financial source period">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            ref={row.key === selected.key ? activePeriod : undefined}
            aria-pressed={row.key === selected.key}
            onClick={() => onSelectPeriod(row.key)}
          >
            {row.values.month}
            {row.role === 'previous' ? ' · Previous' : ''}
          </button>
        ))}
      </div>
      <div className="question-sheet-scroll">
        <table aria-label="Saved financial source values">
          <thead>
            <tr>
              <th scope="col">Account</th>
              {visible.map((row) => (
                <th
                  key={row.key}
                  ref={row.key === selected.key ? activeColumn : undefined}
                  scope="col"
                  className={row.key === selected.key ? 'selected-period' : ''}
                >
                  <button type="button" onClick={() => onSelectPeriod(row.key)}>
                    {row.values.month}
                  </button>
                  <small>CSV row {row.values.sourceRow}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((item) => (
              <tr
                key={item.key}
                className={
                  item.key === 'operatingIncome' || item.key === 'netIncome'
                    ? 'question-sheet-total'
                    : ''
                }
              >
                <th scope="row">{item.label}</th>
                {visible.map((row) => {
                  const referenced = facts.some(
                    (fact) =>
                      fact.metric === item.metric &&
                      fact.period === row.values.month &&
                      fact.sourceIds.includes(row.sourceId),
                  );
                  const active = row.key === selected.key && item.metric === metricKey;
                  return (
                    <td
                      key={row.key}
                      className={
                        (row.key === selected.key ? 'selected-period ' : '') +
                        (referenced ? 'cited-value ' : '') +
                        (active ? 'selected-value' : '')
                      }
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={`${item.label}, ${row.values.month}, ${row.values[item.key]}, CSV row ${row.values.sourceRow}`}
                        onClick={() => {
                          onSelectPeriod(row.key);
                          setMetricKey(item.metric);
                        }}
                      >
                        {formatEvidenceAmount(row.values[item.key])}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="question-cell-inspector" role="status">
        <div>
          <strong>{metric.label}</strong>
          <span>{formatEvidenceAmount(selected.values[metric.key])}</span>
        </div>
        <p>
          {selected.fileName ?? 'Saved source'} · CSV row {selected.values.sourceRow} ·{' '}
          {metric.column} · {selected.values.month}
        </p>
        <small>
          Highlighted period is the selected source. Marked values are cited by this question.
        </small>
      </div>
      {calculations.length > 0 && (
        <section className="question-cited-calculations">
          <h4>Cited calculations</h4>
          {calculations.map((fact) => (
            <p key={fact.id}>
              <strong>
                {fact.metric.replaceAll('_', ' ')}: {formatEvidenceAmount(fact.value)} {fact.unit}
              </strong>
              <small>
                {fact.period} · {fact.calculation}
              </small>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
