import type { Workspace } from '../contracts/Workspace.js';
import { preparationCsvSourceSchema } from '../contracts/PreparationSource.js';
export function preparationCsvSource(state: Workspace, planId: string, artifactId: string) {
  const artifact = state.preparation?.plans
    .find((plan) => plan.id === planId)
    ?.artifacts.find((item) => item.id === artifactId && item.kind === 'financial');
  const snapshot = artifact && state.snapshots.find((item) => item.id === artifact.snapshotId);
  if (
    !artifact?.chart ||
    !snapshot ||
    !snapshot.rows.some((row) => row.sourceRow === artifact.chart?.sourceRow)
  )
    throw new Error('Preparation: saved CSV source unavailable.');
  return preparationCsvSourceSchema.parse({
    fileName: snapshot.fileName,
    sourceCsv: snapshot.sourceCsv ?? null,
    columns: Object.keys(snapshot.rows[0]?.raw ?? {}),
    rows: snapshot.rows
      .map((row) => ({ record: row.sourceRow, cells: row.raw }))
      .sort((a, b) => a.record - b.record),
    highlightedRecord: artifact.chart.sourceRow,
    highlightedColumns: ['month', 'operating_income', 'other_income_srred_credit', 'net_income'],
  });
}
