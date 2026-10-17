import { Decimal } from 'decimal.js';
import type { FinancialSnapshot, FinancialRow } from '../contracts/Workspace.js';
import {
  financialPerformanceSchema,
  type FinancialPerformance,
  type FinancialPerformanceQuery,
} from '../contracts/FinancialPerformance.js';

const Exact = Decimal.clone({ precision: 80 });
function precedingMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  if (year === undefined || month === undefined)
    throw new Error('Financial comparison: invalid period.');
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
function statementRows(row: FinancialRow) {
  const d = (value: string) => new Exact(value);
  const services = d(row.revenue).minus(row.subscriptionRevenue).toFixed();
  return [
    {
      id: 'subscriptions',
      label: 'Subscription revenue',
      kind: 'contribution',
      value: row.subscriptionRevenue,
      start: '0',
      end: row.subscriptionRevenue,
      favorableDirection: 'higher',
      sourceColumns: ['subscription_revenue'],
      formula: 'Imported subscription revenue.',
    },
    {
      id: 'services',
      label: 'Onboarding & services',
      kind: 'contribution',
      value: services,
      start: row.subscriptionRevenue,
      end: row.revenue,
      favorableDirection: 'higher',
      sourceColumns: ['total_revenue', 'subscription_revenue'],
      formula: 'Total revenue − subscription revenue.',
    },
    {
      id: 'revenue',
      label: 'Total revenue',
      kind: 'subtotal',
      value: row.revenue,
      start: '0',
      end: row.revenue,
      favorableDirection: 'higher',
      sourceColumns: ['total_revenue'],
      formula: 'Subscription revenue + onboarding and services.',
    },
    {
      id: 'cogs',
      label: 'Cost of revenue',
      kind: 'contribution',
      value: row.cogs,
      start: row.revenue,
      end: row.grossProfit,
      favorableDirection: 'lower',
      sourceColumns: ['total_cogs'],
      formula: 'Total revenue − cost of revenue = gross profit.',
    },
    {
      id: 'grossProfit',
      label: 'Gross profit',
      kind: 'subtotal',
      value: row.grossProfit,
      start: '0',
      end: row.grossProfit,
      favorableDirection: 'higher',
      sourceColumns: ['gross_profit'],
      formula: 'Total revenue − cost of revenue.',
    },
    {
      id: 'expenses',
      label: 'Operating expenses',
      kind: 'contribution',
      value: row.expenses,
      start: row.grossProfit,
      end: row.operatingIncome,
      favorableDirection: 'lower',
      sourceColumns: ['total_operating_expenses'],
      formula: 'Gross profit − operating expenses = operating result.',
    },
    {
      id: 'operating',
      label: 'Operating result',
      kind: 'subtotal',
      value: row.operatingIncome,
      start: '0',
      end: row.operatingIncome,
      favorableDirection: 'higher',
      sourceColumns: ['operating_income'],
      formula: 'Gross profit − operating expenses.',
    },
    {
      id: 'credit',
      label: 'Other income / credit',
      kind: 'contribution',
      value: row.credit,
      start: row.operatingIncome,
      end: row.netIncome,
      favorableDirection: 'higher',
      sourceColumns: ['other_income_srred_credit'],
      formula:
        'Operating result + other income / credit = net income. Recurrence and cash timing are not established.',
    },
    {
      id: 'netIncome',
      label: 'Net income',
      kind: 'subtotal',
      value: row.netIncome,
      start: '0',
      end: row.netIncome,
      favorableDirection: 'higher',
      sourceColumns: ['net_income'],
      formula: 'Operating result + other income / credit.',
    },
  ] satisfies Array<{
    id: string;
    label: string;
    kind: 'contribution' | 'subtotal';
    value: string;
    start: string;
    end: string;
    favorableDirection: 'higher' | 'lower';
    sourceColumns: string[];
    formula: string;
  }>;
}
/** Reconciled statement bridges and exact variance arithmetic; no forecasting or model calls. */
export function buildFinancialPerformance(
  snapshot: FinancialSnapshot | undefined,
  query: FinancialPerformanceQuery,
): FinancialPerformance {
  const currentPeriod = query.current ?? snapshot?.rows.at(-1)?.month ?? null;
  const current = snapshot?.rows.find((row) => row.month === currentPeriod);
  if (query.current && !current)
    throw new Error('Financial comparison: choose a saved reporting period.');
  if (query.comparison && currentPeriod && query.comparison >= currentPeriod)
    throw new Error('Financial comparison: comparison must be earlier than the current period.');
  const requestedComparison =
    query.comparison ?? (currentPeriod ? precedingMonth(currentPeriod) : null);
  const previous = snapshot?.rows.find((row) => row.month === requestedComparison);
  if (query.comparison && !previous)
    throw new Error('Financial comparison: comparison period is unavailable.');
  const priorRows = previous ? statementRows(previous) : [];
  const rows = current
    ? statementRows(current).map(({ value, start, end, ...definition }) => {
        const prior = priorRows.find((row) => row.id === definition.id);
        const delta = prior ? new Exact(value).minus(prior.value) : null;
        const percentage =
          prior && delta && !new Exact(prior.value).isZero()
            ? delta.div(new Exact(prior.value).abs()).times(100).toFixed(2)
            : null;
        return {
          ...definition,
          current: { value, start, end },
          comparison: prior ? { value: prior.value, start: prior.start, end: prior.end } : null,
          delta: delta?.toFixed() ?? null,
          deltaPercent: percentage,
          favorable:
            delta === null || delta.isZero()
              ? null
              : definition.favorableDirection === 'higher'
                ? delta.gt(0)
                : delta.lt(0),
        };
      })
    : [];
  return financialPerformanceSchema.parse({
    snapshotId: snapshot?.id ?? null,
    fileName: snapshot?.fileName ?? null,
    fictional: snapshot?.fileName === 'Tidewell.csv',
    currency: snapshot?.currency ?? 'unspecified',
    availablePeriods: snapshot?.rows.map((row) => row.month) ?? [],
    currentPeriod: current?.month ?? null,
    comparisonPeriod: previous?.month ?? null,
    currentSourceRow: current?.sourceRow ?? null,
    comparisonSourceRow: previous?.sourceRow ?? null,
    comparisonNote: previous
      ? 'Variance = current − comparison. Percentage = variance ÷ absolute comparison value; zero bases have no percentage. Green indicates a favorable accounting movement, not verified business improvement.'
      : current
        ? `No statement for ${requestedComparison}. Select another earlier period to compare; variances remain unavailable.`
        : 'Select a financial statement to view operating performance.',
    rows,
  });
}
