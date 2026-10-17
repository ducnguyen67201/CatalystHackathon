import { z } from 'zod';
import type { ScenarioInput } from '../contracts/Scenario.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';

const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(100);
const financialRowSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  sourceRow: z.int().positive(),
  revenue: decimal,
  cogs: decimal,
  grossProfit: decimal,
  expenses: decimal,
  operatingIncome: decimal,
  credit: decimal,
  netIncome: decimal,
});
export interface QuestionFinancialRow {
  key: string;
  sourceId: string;
  snapshotId: string;
  fileName: string | null;
  role: string;
  currency: string;
  values: z.infer<typeof financialRowSchema>;
}
export interface WhySource {
  id: string;
  title: string;
  text: string;
  url: string | null;
  label: string;
  date: string | null;
  kind: 'financial' | 'investor' | 'context';
  financialRows: QuestionFinancialRow[];
}

/** Display saved context as readable fields without inventing metadata or exposing JSON. */
function readableContext(text: string): string {
  try {
    const raw: unknown = JSON.parse(text);
    const record = z.record(z.string(), z.unknown()).safeParse(raw);
    if (!record.success) return text;
    return (
      Object.entries(record.data)
        .flatMap(([key, value]) => {
          if (value === null || value === '' || value === undefined) return [];
          const label = key.replaceAll(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            return [`${label}: ${String(value)}`];
          return [];
        })
        .join('\n') || 'Saved structured context; no displayable fields.'
    );
  } catch {
    return text;
  }
}

export function scenarioWhySources(input: ScenarioInput): WhySource[] {
  return input.sources.map((source) => ({
    id: source.id,
    title:
      source.kind === 'investor_research'
        ? source.title
        : source.kind === 'founder_initial'
          ? source.company.name
          : source.kind === 'financials'
            ? source.snapshots.map((snapshot) => snapshot.fileName).join(', ')
            : 'Saved practice',
    text:
      source.kind === 'investor_research'
        ? source.excerpt
        : source.kind === 'founder_initial'
          ? source.company.goal
          : source.kind === 'financials'
            ? 'Saved financial statement. Select a period to inspect its source values.'
            : 'Prior practice is coaching context, not verified business evidence.',
    url: source.kind === 'investor_research' ? source.url : null,
    label:
      source.provenance === 'fictional_demo'
        ? 'Fictional demo'
        : source.provenance.replaceAll('_', ' '),
    date:
      source.kind === 'investor_research'
        ? `Published ${source.publishedAt ?? 'unknown'} · Retrieved ${source.retrievedAt}`
        : source.capturedAt,
    kind:
      source.kind === 'financials'
        ? 'financial'
        : source.kind === 'investor_research'
          ? 'investor'
          : 'context',
    financialRows:
      source.kind === 'financials'
        ? source.snapshots.flatMap((snapshot) =>
            snapshot.periods.map((period) => ({
              key: `${source.id}:${snapshot.snapshotId}:${period.sourceRow}`,
              sourceId: source.id,
              snapshotId: snapshot.snapshotId,
              fileName: snapshot.fileName,
              role: snapshot.role,
              currency: snapshot.currency ?? 'unspecified',
              values: financialRowSchema.parse(period),
            })),
          )
        : [],
  }));
}

/** Parse only the saved financial payload; missing legacy locators stay missing. */
export function evaluationWhySources(context: EvaluationContext): WhySource[] {
  return context.sources.map((source) => {
    const financialRows: QuestionFinancialRow[] = [];
    if (source.kind === 'financial') {
      try {
        const raw: unknown = JSON.parse(source.text);
        const parsed = financialRowSchema.safeParse(raw);
        if (
          parsed.success &&
          (!source.financialLocation ||
            source.financialLocation.sourceRow === parsed.data.sourceRow)
        ) {
          const units = [
            ...new Set(
              context.facts
                .filter((fact) => fact.sourceIds.includes(source.id) && fact.unit !== 'percent')
                .map((fact) => fact.unit),
            ),
          ];
          financialRows.push({
            key: source.id,
            sourceId: source.id,
            snapshotId: source.financialLocation?.snapshotId ?? source.id,
            fileName: source.financialLocation?.fileName ?? null,
            role: 'saved',
            currency: units.length === 1 ? (units[0] ?? 'unspecified') : 'unspecified',
            values: parsed.data,
          });
        }
      } catch {
        /* Retain the citation; do not render malformed data as a worksheet. */
      }
    }
    return {
      id: source.id,
      title: source.title,
      text:
        source.kind === 'financial'
          ? financialRows.length
            ? 'Saved financial statement.'
            : 'This older source has no readable financial rows. The original citation is retained.'
          : source.kind === 'company'
            ? readableContext(source.text)
            : source.text,
      url: source.url,
      label: source.origin === 'fictional' ? 'Fictional demo' : source.origin.replaceAll('_', ' '),
      date: source.recordedAt,
      kind:
        source.kind === 'financial'
          ? 'financial'
          : source.kind === 'investor'
            ? 'investor'
            : 'context',
      financialRows,
    };
  });
}
