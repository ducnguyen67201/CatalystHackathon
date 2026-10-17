import { useState } from 'react';
import type { PreparationArtifact } from '../contracts/FundraisingPreparation.js';
import {
  preparationCsvSourceSchema,
  type PreparationCsvSource,
} from '../contracts/PreparationSource.js';
import { researchRunSchema, type ResearchRun } from '../contracts/ResearchRun.js';
import { request } from './ApiClient.js';
import './PreparationSourceEvidence.css';

export function ExactCsvTable({ data }: { data: PreparationCsvSource }) {
  return (
    <div
      className="prep-csv-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Saved CSV cells. Scroll to view every column."
    >
      <table className="prep-csv-table">
        <caption>
          {data.fileName} · highlighted record {data.highlightedRecord}. Record numbers include the
          header; they are not physical line numbers.
        </caption>
        <thead>
          <tr>
            <th scope="col">CSV record</th>
            {data.columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.record} data-selected={row.record === data.highlightedRecord}>
              <th scope="row">{row.record}</th>
              {data.columns.map((column) => (
                <td key={column}>
                  {row.record === data.highlightedRecord &&
                  data.highlightedColumns.includes(column) ? (
                    <mark aria-label={`${column}: supporting cell`}>{row.cells[column] ?? ''}</mark>
                  ) : (
                    (row.cells[column] ?? '')
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FinancialSourceEvidence({
  planId,
  artifact,
}: {
  planId: string;
  artifact: PreparationArtifact;
}) {
  const [data, setData] = useState<PreparationCsvSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="prep-source-evidence">
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void request(
            `/preparation-plan/${encodeURIComponent(planId)}/sources/${encodeURIComponent(artifact.id)}`,
            preparationCsvSourceSchema,
            undefined,
            'GET',
          )
            .then(setData)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'Cannot read saved CSV.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy
          ? 'Opening source…'
          : data
            ? 'Reload saved CSV'
            : 'Show exact CSV & highlighted cells'}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.sourceCsv === null
              ? 'Original CSV text was not retained for this older upload. The table contains saved parsed cells; it is not the original file.'
              : 'Original uploaded CSV text is retained. The table shows parsed cells with the evidence record and supporting columns highlighted.'}
          </p>
          <h4>Exact cells used in this explanation</h4>
          <ExactCsvTable
            data={{
              ...data,
              columns: data.columns.filter((column) => data.highlightedColumns.includes(column)),
              rows: data.rows.filter((row) => row.record === data.highlightedRecord),
            }}
          />
          <details>
            <summary>Full CSV grid · all records and columns</summary>
            <ExactCsvTable data={data} />
          </details>
          {data.sourceCsv !== null && (
            <details>
              <summary>Original uploaded CSV text · unchanged</summary>
              <pre className="prep-original-csv">{data.sourceCsv}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

type Source = PreparationArtifact['sources'][number];
export function HighlightedPassage({ text, quote }: { text: string; quote: string }) {
  const index = quote ? text.indexOf(quote) : -1;
  if (index < 0)
    return (
      <>
        <p>
          The exact passage could not be located in this saved page text. The separately saved quote
          is shown above.
        </p>
        <pre>{text}</pre>
      </>
    );
  return (
    <pre>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + quote.length)}</mark>
      {text.slice(index + quote.length)}
    </pre>
  );
}
export function InvestorSourceEvidence({ source }: { source: Source }) {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const context = run?.searches
    .flatMap((search) => search.sources)
    .find((item) => item.url === source.url);
  const text = context?.text ?? context?.highlights?.join('\n') ?? null;
  return (
    <article className="prep-investor-source">
      <strong>{source.title}</strong>
      <p className="muted">
        Tracked investor: {source.investorName ?? 'Not recorded'} · Author/speaker: not captured.
        Published: {source.publishedAt ?? 'Unknown'} · Retrieved: {source.recordedAt ?? 'Unknown'}.{' '}
        {source.fictional ? 'Fictional demo evidence.' : 'Public source · unverified attribution.'}
      </p>
      <div className="prep-quoted-passage">
        <span>Saved supporting passage</span>
        <blockquote>
          <mark>{source.excerpt}</mark>
        </blockquote>
      </div>
      {source.interpretation && (
        <p>
          <strong>June’s interpretation · not a source quote:</strong> {source.interpretation}
        </p>
      )}
      <p>
        This passage supports preparation context; it does not by itself establish this investor’s
        personal opinion or current mandate.
      </p>
      {source.url && (
        <a href={source.url} target="_blank" rel="noreferrer">
          Open original article / paper ↗
        </a>
      )}
      {source.researchRunId && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void request(
              `/research-runs/${encodeURIComponent(source.researchRunId ?? '')}`,
              researchRunSchema,
              undefined,
              'GET',
            )
              .then(setRun)
              .catch((caught: unknown) =>
                setError(
                  caught instanceof Error ? caught.message : 'Cannot load saved page context.',
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Opening context…' : 'Show passage in saved source context'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {run && (
        <div className="prep-saved-page">
          {text ? (
            <HighlightedPassage text={text} quote={source.excerpt} />
          ) : (
            <p>
              No surrounding page text was retained for this source. Open the original link to
              inspect it.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
