import { useState } from 'react';
import { Decimal } from 'decimal.js';
import { FileSpreadsheet, Flag, LockKeyhole, Upload } from 'lucide-react';
import type { FinancialRow, FinancialSnapshot } from '../contracts/Workspace.js';
import { fictionalFinancialHashes } from '../contracts/FinancialProvenance.js';
import './FinancialSheet.css';

const lines = [
  ['subscription_revenue', 'Subscription revenue'],
  ['onboarding_services_revenue', 'Onboarding & services'],
  ['total_revenue', 'Total revenue'],
  ['cogs_hosting', 'Hosting'],
  ['cogs_sms_telephony', 'SMS & telephony'],
  ['cogs_payment_processing', 'Payment processing'],
  ['total_cogs', 'Total cost of goods sold'],
  ['gross_profit', 'Gross profit'],
  ['rnd_salaries', 'R&D salaries'],
  ['sales_salaries', 'Sales salaries'],
  ['sales_commissions', 'Sales commissions'],
  ['marketing_salaries', 'Marketing salaries'],
  ['marketing_programs', 'Marketing programs'],
  ['customer_success_salaries', 'Customer success salaries'],
  ['ga_salaries', 'G&A salaries'],
  ['ga_rent', 'Rent'],
  ['ga_software', 'Software'],
  ['ga_professional_fees', 'Professional fees'],
  ['ga_bookkeeping', 'Bookkeeping'],
  ['ga_other', 'Other G&A'],
  ['depreciation', 'Depreciation'],
  ['total_operating_expenses', 'Total operating expenses'],
  ['operating_income', 'Operating income'],
  ['other_income_srred_credit', 'Other income · SR&ED credit'],
  ['net_income', 'Net income'],
] as const;
const totals = new Set([
  'total_revenue',
  'total_cogs',
  'gross_profit',
  'total_operating_expenses',
  'operating_income',
  'net_income',
]);

function columnLetter(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

function cellFlag(key: string, row: FinancialRow): string | null {
  if (key === 'operating_income' && new Decimal(row.operatingIncome).lt(0)) {
    return 'Operating loss';
  }
  if (
    key === 'net_income' &&
    new Decimal(row.operatingIncome).lt(0) &&
    new Decimal(row.netIncome).gt(0) &&
    new Decimal(row.credit).gt(0)
  ) {
    return 'Positive net income includes a credit; operations made a loss';
  }
  return null;
}

export function FinancialSheet({
  snapshot,
  snapshotCount,
  onUpload,
}: {
  snapshot: FinancialSnapshot | undefined;
  snapshotCount: number;
  onUpload: () => void;
}) {
  const [showFlags, setShowFlags] = useState(true);
  return (
    <section className="financial-sheet-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your financial evidence</div>
          <h1>Financials</h1>
          <p className="muted">Your income statement, laid out month by month.</p>
        </div>
        <button className="button" onClick={onUpload}>
          <Upload size={14} /> Upload income statement
        </button>
      </div>
      {snapshot ? (
        <div className="financial-workbook">
          <div className="sheet-toolbar">
            <div className="sheet-file">
              <FileSpreadsheet size={20} aria-hidden="true" />
              <div>
                <strong title={snapshot.fileName}>{snapshot.fileName}</strong>
                <span>
                  {snapshot.rows.length} months ·{' '}
                  {snapshot.currency === 'unspecified'
                    ? 'Currency not confirmed'
                    : snapshot.currency}
                  {fictionalFinancialHashes.has(snapshot.hash) && ' · Fictional demo data'}
                </span>
              </div>
            </div>
            <label className="sheet-flags-toggle">
              <input
                type="checkbox"
                checked={showFlags}
                onChange={(event) => setShowFlags(event.target.checked)}
              />
              <Flag size={13} aria-hidden="true" /> Show flags
            </label>
            <span className="sheet-readonly">
              <LockKeyhole size={12} aria-hidden="true" /> Read only
            </span>
          </div>
          <div
            className="sheet-scroll"
            role="region"
            aria-label="Income statement spreadsheet, scroll to see all months"
            tabIndex={0}
          >
            <table className="financial-sheet">
              <caption className="sheet-screen-reader">
                Income statement. Original uploaded values, with months in columns and line items in
                rows. Source CSV row numbers appear under each month.
              </caption>
              <thead>
                <tr className="sheet-letters" aria-hidden="true">
                  <td className="sheet-index" />
                  <td className="sheet-label">A</td>
                  {snapshot.rows.map((row, index) => (
                    <td key={row.month}>{columnLetter(index + 1)}</td>
                  ))}
                </tr>
                <tr className="sheet-months">
                  <td className="sheet-index" aria-hidden="true">
                    1
                  </td>
                  <th scope="col" className="sheet-label">
                    Income statement
                  </th>
                  {snapshot.rows.map((row) => (
                    <th scope="col" key={row.month}>
                      {row.month}
                      <small>CSV row {row.sourceRow}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(([key, label], index) => (
                  <tr key={key} className={totals.has(key) ? 'sheet-total' : undefined}>
                    <td className="sheet-index" aria-hidden="true">
                      {index + 2}
                    </td>
                    <th scope="row" className="sheet-label" title={key}>
                      {label}
                    </th>
                    {snapshot.rows.map((row) => {
                      const value = row.raw[key];
                      const flag = showFlags && value !== undefined ? cellFlag(key, row) : null;
                      return (
                        <td
                          key={row.month}
                          className={flag ? 'sheet-flagged' : undefined}
                          title={`${row.month} · CSV row ${row.sourceRow} · ${key}${flag ? ` · ${flag}` : ''}`}
                        >
                          {flag && (
                            <span aria-label={flag} className="sheet-flag-mark">
                              †{' '}
                            </span>
                          )}
                          {value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sheet-footer">
            <span className="sheet-tab">
              <FileSpreadsheet size={14} aria-hidden="true" /> Income statement
            </span>
            <span>
              {snapshotCount} saved snapshot{snapshotCount === 1 ? '' : 's'} · Original values
            </span>
          </div>
          {showFlags && (
            <p className="sheet-legend">
              <span>† Flag</span> Operating loss, or positive net income supported by a credit while
              operations made a loss. Hover a flagged cell for details.
            </p>
          )}
        </div>
      ) : (
        <div className="panel sheet-empty">
          <FileSpreadsheet size={32} aria-hidden="true" />
          <h2>Your spreadsheet starts here</h2>
          <p>Upload an income statement to view your monthly figures.</p>
        </div>
      )}
      <p className="footnote">
        Values are shown as uploaded. Upload a new file to save changes. Cash balance and cash-flow
        data are needed to assess runway.
      </p>
    </section>
  );
}
