import { z } from 'zod';
export const preparationCsvSourceSchema = z.strictObject({
  fileName: z.string(),
  sourceCsv: z.string().max(2000000).nullable(),
  columns: z.array(z.string()),
  rows: z.array(
    z.strictObject({ record: z.int().positive(), cells: z.record(z.string(), z.string()) }),
  ),
  highlightedRecord: z.int().positive(),
  highlightedColumns: z.array(z.string()),
});
export type PreparationCsvSource = z.infer<typeof preparationCsvSourceSchema>;
