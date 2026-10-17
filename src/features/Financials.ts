import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  rowSchema,
  snapshotSchema,
  type FinancialSnapshot,
  type Finding,
} from '../contracts/Workspace.js';

const columns = [
  'subscription_revenue',
  'onboarding_services_revenue',
  'total_revenue',
  'cogs_hosting',
  'cogs_sms_telephony',
  'cogs_payment_processing',
  'total_cogs',
  'gross_profit',
  'rnd_salaries',
  'sales_salaries',
  'sales_commissions',
  'marketing_salaries',
  'marketing_programs',
  'customer_success_salaries',
  'ga_salaries',
  'ga_rent',
  'ga_software',
  'ga_professional_fees',
  'ga_bookkeeping',
  'ga_other',
  'depreciation',
  'total_operating_expenses',
  'operating_income',
  'other_income_srred_credit',
  'net_income',
];
const rawRowsSchema = z.array(z.record(z.string(), z.string())).min(1).max(1200);
export function importFinancials(
  csv: string,
  fileName: string,
  currency: FinancialSnapshot['currency'],
): FinancialSnapshot {
  let parsed: unknown;
  try {
    parsed = parse(csv, {
      columns: (input: unknown) => {
        const headers = z.array(z.string()).parse(input);
        if (
          headers.length !== columns.length + 1 ||
          new Set(headers).size !== headers.length ||
          headers[0] !== 'month' ||
          columns.some((column) => !headers.includes(column))
        ) {
          throw new Error('CSV format: headers must match the supplied income statement.');
        }
        return headers;
      },
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 20000,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CSV format:')) {
      throw error;
    }
    throw new Error('CSV format: check quoting and the supplied income statement columns.', {
      cause: error,
    });
  }
  const records = rawRowsSchema.parse(parsed);
  const months = new Set<string>();
  const rows = records
    .map((raw, index) => {
      const read = (name: string): Decimal => {
        const value = raw[name];
        if (
          value === undefined ||
          !/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?$/.test(value) ||
          value.length > 32
        ) {
          throw new Error(`Row ${index + 2}: invalid or missing ${name}.`);
        }
        return new Decimal(value.replaceAll('$', '').replaceAll(',', ''));
      };
      const same = (name: string, value: Decimal): void => {
        if (!read(name).eq(value)) {
          throw new Error(`Row ${index + 2}: ${name} does not reconcile.`);
        }
      };
      for (const column of columns) {
        read(column);
      }
      same('total_revenue', read('subscription_revenue').plus(read('onboarding_services_revenue')));
      same(
        'total_cogs',
        read('cogs_hosting').plus(read('cogs_sms_telephony')).plus(read('cogs_payment_processing')),
      );
      same('gross_profit', read('total_revenue').minus(read('total_cogs')));
      const expenseNames = columns.slice(8, 21);
      same(
        'total_operating_expenses',
        expenseNames.reduce((sum, column) => sum.plus(read(column)), new Decimal(0)),
      );
      same('operating_income', read('gross_profit').minus(read('total_operating_expenses')));
      same('net_income', read('operating_income').plus(read('other_income_srred_credit')));
      const row = rowSchema.parse({
        month: raw.month,
        revenue: read('total_revenue').toFixed(),
        subscriptionRevenue: read('subscription_revenue').toFixed(),
        cogs: read('total_cogs').toFixed(),
        grossProfit: read('gross_profit').toFixed(),
        expenses: read('total_operating_expenses').toFixed(),
        operatingIncome: read('operating_income').toFixed(),
        credit: read('other_income_srred_credit').toFixed(),
        netIncome: read('net_income').toFixed(),
        sourceRow: index + 2,
        raw,
      });
      if (months.has(row.month)) {
        throw new Error(`Duplicate month: ${row.month}.`);
      }
      months.add(row.month);
      return row;
    })
    .sort((left, right) => left.month.localeCompare(right.month));
  return snapshotSchema.parse({
    id: randomUUID(),
    hash: createHash('sha256').update(csv).update(currency).digest('hex'),
    fileName,
    createdAt: new Date().toISOString(),
    currency,
    sourceCsv: csv,
    rows,
  });
}
export function findFinancialQuestion(snapshot: FinancialSnapshot): Finding {
  const credited = snapshot.rows
    .filter(
      (row) =>
        new Decimal(row.credit).gt(0) &&
        new Decimal(row.operatingIncome).lt(0) &&
        new Decimal(row.netIncome).gt(0),
    )
    .at(-1);
  const row = credited ?? snapshot.rows.at(-1);
  if (!row) {
    throw new Error('A financial snapshot needs at least one month.');
  }
  const amount = (value: string): string =>
    new Decimal(value).toNumber().toLocaleString('en-US', { maximumFractionDigits: 2 });
  return {
    month: row.month,
    sourceRow: row.sourceRow,
    operatingIncome: row.operatingIncome,
    credit: row.credit,
    netIncome: row.netIncome,
    question: credited
      ? `${row.month} shows $${amount(row.netIncome)} in net income. Is the business profitable from operations?`
      : `What explains the operating result of $${amount(row.operatingIncome)} in ${row.month}?`,
    answer: credited
      ? `Reported net income of $${amount(row.netIncome)} includes a $${amount(row.credit)} SR&ED credit. Operations still lost $${amount(new Decimal(row.operatingIncome).abs().toFixed())}. Cash balance and cash-flow data are needed to assess runway.`
      : `The income statement shows operating income of $${amount(row.operatingIncome)} and net income of $${amount(row.netIncome)}. We should explain the revenue and costs behind this result. Cash runway remains unknown without cash-flow data.`,
  };
}
