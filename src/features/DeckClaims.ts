import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { FinancialSnapshot, Workspace } from '../contracts/Workspace.js';
import { fictionalFinancialHashes } from '../contracts/FinancialProvenance.js';
import { preparationStateSchema } from '../contracts/FundraisingPreparation.js';
import {
  deckClaimsCommandSchema,
  deckClaimsStateSchema,
  deckClaimsViewSchema,
  type DeckClaim,
  type DeckClaimResult,
} from '../contracts/DeckClaims.js';
import type { WorkspaceService } from './WorkspaceService.js';
import { ConflictError } from './WorkspaceStore.js';

const fictional = (snapshot: FinancialSnapshot | undefined) =>
  !!snapshot && fictionalFinancialHashes.has(snapshot.hash);
const missing: Partial<Record<DeckClaim['metric'], string>> = {
  arr: 'A month-end MRR bridge is required. Subscription revenue alone does not establish month-end MRR.',
  logo_churn:
    'Customer starts, cancellations and opening customer counts for the stated window are required.',
  nrr: 'Customer-level recurring revenue for the same cohort at the start and end of the retention window is required.',
  cac: 'New customers acquired and the defined sales and marketing cost window are required.',
  cac_payback:
    'Fully loaded CAC, recurring revenue per acquired customer and a defined gross margin are required.',
  runway:
    'Cash balance, cash-flow history and an explicit spending/financing scenario are required. Operating loss is not cash burn.',
};
function quotedValue(quote: string, value: string) {
  const tokens = quote.match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*[kmb]\b)?/gi) ?? [];
  return tokens.some((token) => {
    const suffix = token.trim().slice(-1).toLowerCase();
    const multiplier =
      suffix === 'k' ? '1000' : suffix === 'm' ? '1000000' : suffix === 'b' ? '1000000000' : '1';
    const number = token
      .replaceAll(',', '')
      .replace(/[kmb]\s*$/i, '')
      .trim();
    return new Decimal(number).mul(multiplier).eq(value);
  });
}
export function checkDeckClaim(state: Workspace, claim: DeckClaim): DeckClaimResult {
  const snapshot = state.snapshots.find((item) => item.id === claim.snapshotId);
  const row = snapshot?.rows.find((item) => item.month === claim.period);
  const result: DeckClaimResult = {
    claim,
    status: 'insufficient_evidence',
    value: null,
    formula: 'Not calculated without the required evidence.',
    explanation: missing[claim.metric] ?? 'The saved statement has no row for the stated period.',
    suggestion: null,
    stale: claim.snapshotId !== state.onboarding.snapshotId,
    fictional: fictional(snapshot),
    fileName: snapshot?.fileName ?? null,
    sourceRows: [],
  };
  if (claim.kind === 'forecast')
    return {
      ...result,
      status: 'not_checked',
      explanation:
        'Forecast assumptions are not verified by historical equality. A forecast model and driver review are required.',
    };
  if (missing[claim.metric] || !snapshot || !row) return result;
  let value: Decimal;
  let formula: string;
  let cells: Record<string, string>;
  if (claim.metric === 'gross_margin' || claim.metric === 'support_adjusted_margin') {
    if (claim.unit !== 'percent')
      return { ...result, status: 'ambiguous', explanation: 'Use percent for this margin claim.' };
    if (new Decimal(row.revenue).isZero())
      return { ...result, explanation: 'Margin is undefined when revenue is zero.' };
    let support = new Decimal(0);
    cells = { month: row.month, total_revenue: row.revenue, gross_profit: row.grossProfit };
    if (claim.metric === 'support_adjusted_margin') {
      const raw = row.raw.customer_success_salaries;
      if (raw === undefined || !/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?$/.test(raw))
        return {
          ...result,
          explanation:
            'The original customer_success_salaries source column is required for this adjustment.',
        };
      support = new Decimal(raw.replaceAll('$', '').replaceAll(',', ''));
      cells.customer_success_salaries = raw;
    }
    value = new Decimal(row.grossProfit).minus(support).div(row.revenue).times(100);
    formula =
      claim.metric === 'gross_margin'
        ? `${row.grossProfit} / ${row.revenue} × 100 (booked margin)`
        : `(${row.grossProfit} − ${support.toFixed()}) / ${row.revenue} × 100 (analytical reclassification of all customer-success salaries; original books unchanged)`;
  } else {
    if (snapshot.currency === 'unspecified' || claim.unit !== snapshot.currency)
      return {
        ...result,
        status: 'ambiguous',
        explanation:
          'Confirm the source currency and use the same currency in the claim. Source currency is not inferred from the company profile.',
      };
    const fields = {
      revenue: ['revenue', 'total_revenue'],
      operating_income: ['operatingIncome', 'operating_income'],
      net_income: ['netIncome', 'net_income'],
      other_income_credit: ['credit', 'other_income_srred_credit'],
    } as const;
    const key = claim.metric;
    if (
      key !== 'revenue' &&
      key !== 'operating_income' &&
      key !== 'net_income' &&
      key !== 'other_income_credit'
    )
      return result;
    const [owned, original] = fields[key];
    value = new Decimal(row[owned]);
    cells = { month: row.month, [original]: row[owned] };
    formula = `Imported ${original}, ${claim.period}; no inference or currency conversion.`;
  }
  const rounded = value.toDecimalPlaces(claim.precision, Decimal.ROUND_HALF_UP);
  const matches = rounded.eq(
    new Decimal(claim.value).toDecimalPlaces(claim.precision, Decimal.ROUND_HALF_UP),
  );
  const shown = value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed();
  return {
    ...result,
    status: matches ? 'supported' : 'contradicted',
    value: shown,
    formula: `${formula} Comparison rounds both values to ${claim.precision} decimal place(s), half up; displayed result rounds to at most eight decimal places.`,
    explanation: matches
      ? 'The stated amount matches this saved metric, period and unit at the declared precision. This does not verify other claims or investor readiness.'
      : 'The stated amount differs from the saved evidence at the declared precision. Check the metric definition and period before revising.',
    suggestion: `For ${claim.period}, ${claim.metric.replaceAll('_', ' ')} was ${shown} ${claim.unit}. ${claim.metric === 'operating_income' ? 'Operating performance is separate from other income and net income. ' : ''}This statement does not establish cash runway.`,
    sourceRows: [{ row: row.sourceRow, period: row.month, cells }],
  };
}
export function projectDeckClaims(state: Workspace) {
  const saved = state.preparation?.deckClaims;
  return deckClaimsViewSchema.parse({
    version: saved?.version ?? 0,
    demoAvailable: fictional(
      state.snapshots.find((item) => item.id === state.onboarding.snapshotId),
    ),
    results: saved?.claims.map((claim) => checkDeckClaim(state, claim)) ?? [],
  });
}
export async function saveDeckClaims(service: WorkspaceService, raw: unknown) {
  const command = deckClaimsCommandSchema.parse(raw);
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  await service.change((state) => {
    state.preparation ??= preparationStateSchema.parse({});
    const saved = (state.preparation.deckClaims ??= deckClaimsStateSchema.parse({
      version: 0,
      claims: [],
      commands: [],
    }));
    const receipt = saved.commands.find((item) => item.key === command.key);
    if (receipt) {
      if (receipt.hash !== hash)
        throw new ConflictError('Request key reused with changed content.');
      return;
    }
    if (saved.version !== command.version)
      throw new ConflictError('Claims changed. Refresh before saving.');
    if (saved.commands.length >= 2000)
      throw new ConflictError('Claim command history is full. Existing records remain available.');
    const now = new Date().toISOString();
    const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
    if (command.action === 'save_draft') {
      const claim = saved.claims.find((item) => item.id === command.claimId);
      if (!claim) throw new ConflictError('Claim unavailable.');
      if (claim.drafts.length >= 100) throw new ConflictError('Draft history is full.');
      claim.drafts.push({ id: randomUUID(), text: command.text, createdAt: now });
    } else if (command.action === 'add') {
      if (saved.claims.length >= 100)
        throw new ConflictError('This board supports up to 100 claims.');
      if (!quotedValue(command.claim.quote, command.claim.value))
        throw new ConflictError(
          'The claimed number must appear in the exact quotation. K, M and B suffixes are supported; do not infer an unstated number.',
        );
      saved.claims.push({
        ...command.claim,
        id: randomUUID(),
        snapshotId: snapshot?.id ?? null,
        createdAt: now,
        drafts: [],
      });
    } else {
      if (!fictional(snapshot) || !snapshot)
        throw new ConflictError(
          'Fictional examples require the original fictional Tidewell dataset.',
        );
      if (saved.claims.length)
        throw new ConflictError('Examples can only initialize an empty claim board.');
      const row = snapshot.rows.at(-1);
      if (!row) throw new ConflictError('No financial rows available.');
      const examples = [
        {
          metric: 'support_adjusted_margin',
          quote: 'Our gross margin including support is 92%.',
          value: '92',
          unit: 'percent',
        },
        { metric: 'arr', quote: 'Our ARR is 1370000 CAD.', value: '1370000', unit: 'CAD' },
        { metric: 'logo_churn', quote: 'Monthly logo churn is 1%.', value: '1', unit: 'percent' },
        {
          metric: 'runway',
          quote: 'The planned raise gives us 24 months of runway.',
          value: '24',
          unit: 'months',
        },
      ] as const;
      for (const example of examples)
        saved.claims.push({
          ...example,
          id: randomUUID(),
          snapshotId: snapshot.id,
          createdAt: now,
          drafts: [],
          location: 'Fictional demonstration claim · not an uploaded deck',
          period: row.month,
          kind: example.metric === 'runway' ? 'forecast' : 'actual',
          precision: 0,
        });
    }
    saved.version++;
    saved.commands.push({ key: command.key, hash });
  });
}
