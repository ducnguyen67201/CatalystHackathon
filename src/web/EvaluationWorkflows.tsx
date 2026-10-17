import type { EvaluationReport } from '../contracts/RehearsalEvaluation.js';
import { peerMetricLabels } from '../contracts/PeerComparison.js';
import { ComparisonChart } from './PeerCharts.js';

/** Saved workflow output only. Opening the report never starts research or inference. */
export function EvaluationWorkflows({ report }: { report: EvaluationReport }) {
  const workflows = report.workflows;
  if (!workflows) return null;
  const { peer, investor, synthesis } = workflows;
  return (
    <>
      <section className="preparation-report-section" aria-label="Company versus selected peers">
        <h4>Your business versus selected peers</h4>
        <p>Comparison coverage: {peer.status}.</p>
        {peer.limitations.map((limitation) => (
          <p className="muted" key={limitation}>
            {limitation}
          </p>
        ))}
        {peer.comparison && (
          <>
            <p className="muted">
              Evidence captured {peer.comparison.capturedAt.slice(0, 10)}. Business performance is
              separate from answer quality.
            </p>
            {peer.comparison.metrics.map((metric) => (
              <ComparisonChart key={metric.metric} comparison={metric} />
            ))}
          </>
        )}
      </section>
      <section className="preparation-report-section" aria-label="Company versus selected investor">
        <h4>Your business versus {investor.investorName ?? 'the selected investor'}</h4>
        <p>Research coverage: {investor.status}.</p>
        {investor.criteria.map((criterion) => (
          <article key={criterion.criterion}>
            <h5>
              {criterion.criterion}: {criterion.outcome}
            </h5>
            <p>Your company: {criterion.companyValue ?? 'unknown'}</p>
            {criterion.outcome === 'unknown' && (
              <p>
                Confirm your company information and obtain evidence for this investor’s current
                criteria before drawing a conclusion.
              </p>
            )}
            {criterion.outcome === 'gap' && (
              <p>
                Review this difference with the investor; a historical research attribute does not
                establish an exclusion.
              </p>
            )}
            {criterion.outcome === 'conflicting' && (
              <p>
                Research observations disagree. Confirm the investor’s current scope before
                preparing a fit claim.
              </p>
            )}
            {criterion.observations.map((observation) => (
              <details key={observation.sourceId}>
                <summary>
                  Research attribute: {observation.value} ·{' '}
                  {observation.origin === 'fictional'
                    ? 'Fictional demo'
                    : 'Unverified public research'}
                </summary>
                <p>Retrieved {observation.recordedAt ?? 'date unknown'}</p>
                {observation.url && (
                  <a href={observation.url} target="_blank" rel="noopener noreferrer">
                    Research source
                  </a>
                )}
                <blockquote>{observation.quote}</blockquote>
              </details>
            ))}
          </article>
        ))}
        {investor.limitations.map((limitation) => (
          <p className="muted" key={limitation}>
            {limitation}
          </p>
        ))}
      </section>
      <section className="preparation-report-section" aria-label="Combined preparation priorities">
        <h4>Prepare for your next discussion</h4>
        <p>
          Answer findings below are linked to saved business context where evidence supports the
          connection. Topics not reached in the conversation are unassessed.
        </p>
        {synthesis.actions.length ? (
          <ol>
            {synthesis.actions.map((action) => (
              <li key={action.coachingItemId}>
                <p>{action.instruction}</p>
                <blockquote>
                  {report.extraction.claims.find((claim) => claim.id === action.claimId)?.quote}
                </blockquote>
                {action.peerMetrics.length > 0 && (
                  <p>
                    Review the selected-peer context for{' '}
                    {action.peerMetrics.map((metric) => peerMetricLabels[metric]).join(', ')}. The
                    comparison does not establish the cause of a difference.
                  </p>
                )}
                {action.investorSourceIds.length > 0 && (
                  <p>
                    This answer’s coaching cites investor evidence shown above. Prepare the
                    explanation against those sources.
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>
            No answer-linked preparation action was established. Review the business coverage and
            unknown criteria above.
          </p>
        )}
      </section>
    </>
  );
}
