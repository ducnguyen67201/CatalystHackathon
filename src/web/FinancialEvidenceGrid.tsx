import { useState } from 'react';
import type { EvidenceCell, EvidenceReview } from '../contracts/EvidenceReview.js';

export function sourceLabel(cell: EvidenceCell): string {
  const source = cell.sourceLocator;
  return `${source.fileName ?? source.sourceTitle} · CSV row ${source.sourceRow} · ${source.columnKey}`;
}

export function FinancialEvidenceGrid({
  grid,
  changes,
  selectedCellId,
  primaryCellIds,
  supportingCellIds,
  flaggedCellIds,
  onSelect,
  registerCell,
}: {
  grid: EvidenceReview['grids'][number];
  changes: EvidenceReview['changes'];
  selectedCellId: string | null;
  primaryCellIds: string[];
  supportingCellIds: string[];
  flaggedCellIds: string[];
  onSelect: (cell: EvidenceCell) => void;
  registerCell: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const [comparison, setComparison] = useState(false);
  const selected = grid.cells.find((c) => c.id === selectedCellId);
  const rows = [
    ...new Map(
      grid.cells.map((c) => [c.row, { row: c.row, label: c.label, metric: c.metric }]),
    ).values(),
  ].sort((a, b) => a.row - b.row);
  return (
    <section className="financial-evidence" aria-label="Embedded financial evidence sheet">
      <div className="financial-workbook-title">
        <span className="financial-workbook-icon" aria-hidden="true">
          X
        </span>
        <strong>{grid.title}</strong>
        <span>Read-only evidence</span>
      </div>
      <div className="financial-workbook-toolbar">
        <span>CSV evidence / review layout</span>
        <label>
          View
          <select
            value={comparison ? 'changes' : 'original'}
            onChange={(e) => setComparison(e.target.value === 'changes')}
          >
            <option value="original">Saved values</option>
            <option value="changes">Month-over-month changes</option>
          </select>
        </label>
      </div>
      <div className="financial-formula" aria-live="polite">
        <b>{selected?.displayAddress ?? 'Select cell'}</b>
        <span>
          {selected
            ? selected.calculation
              ? `June calculation: ${selected.calculation}`
              : `Saved value: ${selected.value} ${selected.unit}`
            : 'Select a figure to inspect its original source.'}
        </span>
      </div>
      {selected && (
        <p className="financial-source-locator">
          {sourceLabel(selected)} · {selected.period} · {selected.unit}
          {selected.origin === 'fictional'
            ? ' · Fictional evidence'
            : ' · Uploaded statement; not independently verified'}
        </p>
      )}
      <div
        className="financial-grid-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable financial evidence"
      >
        <table>
          <caption>Income statement · rendered coordinates belong to this review layout</caption>
          <thead>
            <tr>
              <th scope="col" aria-label="Row number" />
              <th scope="col">A</th>
              {grid.periods.map((period, index) => (
                <th key={period} scope="col">
                  {String.fromCharCode(66 + index)}
                </th>
              ))}
            </tr>
            <tr>
              <th scope="row">3</th>
              <th scope="col">Account</th>
              {grid.periods.map((period) => (
                <th key={period} scope="col">
                  {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.row}>
                <th scope="row">{row.row}</th>
                <th scope="row">{row.label}</th>
                {grid.periods.map((period) => {
                  const cell = grid.cells.find((c) => c.row === row.row && c.period === period);
                  if (!cell) return <td key={period}>Unavailable</td>;
                  const change = changes.find((c) => c.currentFactId === cell.factIds[0]);
                  const primary = primaryCellIds.includes(cell.id);
                  const supporting = supportingCellIds.includes(cell.id);
                  const flagged = flaggedCellIds.includes(cell.id);
                  return (
                    <td key={period}>
                      <button
                        ref={(node) => registerCell(cell.id, node)}
                        className={`financial-cell ${primary ? 'primary-evidence' : supporting ? 'supporting-evidence' : ''} ${flagged ? 'flagged' : ''}`}
                        aria-pressed={selectedCellId === cell.id}
                        aria-label={`${cell.displayAddress}, ${cell.label}, ${cell.value} ${cell.unit}, ${period}${flagged ? ', claim needs explanation' : ''}${cell.origin === 'fictional' ? ', fictional evidence' : ''}`}
                        title={sourceLabel(cell)}
                        onClick={() => onSelect(cell)}
                      >
                        {cell.value}
                        {flagged && (
                          <span className="cell-flag" aria-hidden="true">
                            !
                          </span>
                        )}
                      </button>
                      {comparison && (
                        <small
                          className="financial-delta"
                          title={change?.unavailableReason ?? 'Current month minus previous month'}
                        >
                          {change?.absoluteDelta !== null && change?.absoluteDelta !== undefined
                            ? `Δ ${change.absoluteDelta}${change.percentDelta !== null ? ` (${change.percentDelta}%)` : ''}`
                            : 'Δ unavailable'}
                          {change?.unavailableReason && <span>{change.unavailableReason}</span>}
                        </small>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="financial-sheet-footer">
        <strong>Income Statement</strong>
        <span>
          {grid.cells.some((c) => c.origin === 'fictional') ? 'Fictional evidence · ' : ''}Frozen
          snapshot · {grid.periods.length} periods
        </span>
      </div>
      <p className="financial-legend">
        <span>● Primary evidence</span>
        <span>○ Explanatory evidence</span>
        <span>! Needs explanation</span>
      </p>
    </section>
  );
}
