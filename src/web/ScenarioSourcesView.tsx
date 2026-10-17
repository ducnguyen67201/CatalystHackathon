import type { ScenarioInput } from '../contracts/Scenario.js';

const names: Record<ScenarioInput['coverage'][number]['kind'], string> = {
  founder_initial: 'Company & meeting context',
  investor_research: 'Investor research',
  financials: 'Financial CSVs',
  prior_calls: 'Previous practice',
  rehearsal_feedback: 'Practice feedback',
  pitch: 'Pitch documents',
  forecast: 'Forecasts',
};
export function ScenarioSourcesView({ input }: { input: ScenarioInput }) {
  return (
    <>
      <div className="scenario-data-grid">
        {input.coverage.map((item) => (
          <article className="scenario-data-card" key={item.kind}>
            <div className="scenario-data-card-heading">
              <h3>{names[item.kind]}</h3>
              <span className={'scenario-data-status ' + item.status}>
                {item.status === 'available'
                  ? 'Included'
                  : item.status === 'missing'
                    ? 'Missing'
                    : 'Not connected'}
              </span>
            </div>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
      <h3>Included source details</h3>
      <p className="muted">
        Investor: {input.investor.name}
        {input.investor.url && (
          <>
            {' '}
            ·{' '}
            <a href={input.investor.url} target="_blank" rel="noreferrer">
              Saved profile ↗
            </a>
          </>
        )}
      </p>
      {input.sources.map((source, index) => (
        <details
          className="scenario-source-card"
          key={source.id}
          id={'scenario-source-' + String(index)}
        >
          <summary>
            Source {index + 1} ·{' '}
            {source.kind === 'founder_initial'
              ? source.company.name
              : source.kind === 'investor_research'
                ? source.title
                : source.kind === 'financials'
                  ? source.snapshots.map((item) => item.fileName).join(' + ')
                  : 'Practice · ' + new Date(source.recordedAt).toLocaleDateString()}
          </summary>
          <p className="muted">
            {source.provenance === 'fictional_demo'
              ? 'Fictional demo evidence'
              : source.provenance.replaceAll('_', ' ')}{' '}
            · Captured {new Date(source.capturedAt).toLocaleString()}
          </p>
          {source.kind === 'founder_initial' && (
            <dl className="scenario-facts">
              <dt>Company</dt>
              <dd>{source.company.name}</dd>
              <dt>Stage</dt>
              <dd>{source.company.stage ?? 'Unknown'}</dd>
              <dt>Sector</dt>
              <dd>{source.company.sector ?? 'Unknown'}</dd>
              <dt>Geography</dt>
              <dd>{source.company.geography ?? 'Unknown'}</dd>
              <dt>Raise target</dt>
              <dd>
                {source.company.raiseTarget ?? 'Unknown'} ·{' '}
                {source.company.currency ?? 'Currency unknown'}
              </dd>
              <dt>Goal</dt>
              <dd>{source.company.goal || 'Not supplied'}</dd>
              <dt>Meeting notes</dt>
              <dd>{source.meetingNotes ?? 'Not supplied for this investor'}</dd>
            </dl>
          )}
          {source.kind === 'investor_research' && (
            <>
              <blockquote>{source.excerpt}</blockquote>
              <p>
                Published: {source.publishedAt ?? 'Unknown'} · Retrieved:{' '}
                {new Date(source.retrievedAt).toLocaleString()}
              </p>
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Read source ↗
                </a>
              )}
            </>
          )}
          {source.kind === 'financials' && (
            <>
              {source.snapshots.map((snapshot) => (
                <section key={snapshot.snapshotId}>
                  <h4>
                    {snapshot.fileName} · {snapshot.role}
                  </h4>
                  <p>
                    {snapshot.fictional
                      ? 'Fictional demo financials'
                      : 'Saved figures; not independently verified'}{' '}
                    · {snapshot.currency ?? 'Currency unknown'} · Saved{' '}
                    {new Date(snapshot.createdAt).toLocaleString()}
                  </p>
                  <p>
                    {snapshot.periods.length} of {snapshot.totalRows} months included ·{' '}
                    {snapshot.totalRows - snapshot.periods.length} older months omitted
                  </p>
                  <div className="scenario-table-wrap">
                    <table className="scenario-financial-table">
                      <thead>
                        <tr>
                          <th>Month / CSV row</th>
                          <th>Revenue</th>
                          <th>Operating income</th>
                          <th>Credit</th>
                          <th>Net income</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.periods.map((row) => (
                          <tr key={row.month}>
                            <td>
                              {row.month} / {row.sourceRow}
                            </td>
                            <td>{row.revenue}</td>
                            <td>{row.operatingIncome}</td>
                            <td>{row.credit}</td>
                            <td>{row.netIncome}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              <p>
                {source.omittedSnapshots} other snapshots excluded. Full included fields are in the
                exact input below.
              </p>
            </>
          )}
          {source.kind === 'prior_calls' && (
            <>
              <p>
                {source.turns.length} of {source.totalTurns} turns included (up to 800 characters
                per turn). This is a practice transcript.
              </p>
              {source.turns.map((turn, i) => (
                <p key={i}>
                  <strong>{turn.role === 'agent' ? 'Interviewer' : 'Founder'}:</strong> {turn.text}
                </p>
              ))}
              {source.review && (
                <>
                  <h4>Saved coaching feedback</h4>
                  <p>{source.review.note}</p>
                  <p>Covered: {source.review.covered.join('; ') || 'None recorded'}</p>
                  <p>To improve: {source.review.missing.join('; ') || 'None recorded'}</p>
                </>
              )}
            </>
          )}
        </details>
      ))}
      {!!input.omittedEvidenceIds.length && (
        <p>
          {input.omittedEvidenceIds.length} saved research sources excluded by the source limit or
          empty excerpts.
        </p>
      )}
      {!!input.previousScenarios.length && (
        <details className="scenario-source-card">
          <summary>
            {input.previousScenarios.length} previous scenarios considered to avoid repetition
          </summary>
          <ul>
            {input.previousScenarios.map((item, index) => (
              <li key={index}>
                <strong>{item.title}</strong> — {item.objective}
              </li>
            ))}
          </ul>
          <p>The latest 12 scenarios from the latest 20 generations are considered.</p>
        </details>
      )}
      <details className="scenario-source-card">
        <summary>View exact generation input</summary>
        <pre className="scenario-input-json">{JSON.stringify(input, null, 2)}</pre>
      </details>
    </>
  );
}
