import { z } from 'zod';

const sourceRowSchema = z.record(z.string(), z.string()).refine((value) => {
  const count = Object.keys(value).length;
  return count > 0 && count <= 100;
});

/** Present saved CSV rows as fields and exact values; other source passages stay verbatim. */
export function StorySourceExcerpt({ excerpt }: { excerpt: string }) {
  let raw: unknown;
  try {
    raw = JSON.parse(excerpt);
  } catch {
    return <pre>{excerpt}</pre>;
  }
  const row = sourceRowSchema.safeParse(raw);
  if (!row.success) return <pre>{excerpt}</pre>;
  return (
    <>
      <div
        className="story-source-values"
        tabIndex={0}
        role="region"
        aria-label="Saved source values. Scroll for more fields."
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Saved value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(row.data).map(([field, value]) => (
              <tr key={field}>
                <th scope="row">{field.replaceAll('_', ' ')}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="story-original-excerpt">
        <summary>Original excerpt</summary>
        <pre>{excerpt}</pre>
      </details>
    </>
  );
}
