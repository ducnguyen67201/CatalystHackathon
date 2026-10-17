import { CheckCircle2, FileCheck2, Target, TriangleAlert } from 'lucide-react';
import type { EvaluationRecord } from '../contracts/RehearsalEvaluation.js';

/** A summary of the saved review, never a new browser-side assessment. */
export function PitchPreparationReport({
  evaluation,
  fictional,
}: {
  evaluation: EvaluationRecord;
  fictional: boolean;
}) {
  const report = evaluation.report;
  if (!report) return null;
  const { coaching } = report;
  return (
    <div className="preparation-report">
      <header className="preparation-report-header">
        <div>
          <h3>Your Pitch Preparation Report</h3>
          <p className="muted">
            {fictional ? 'Fictional demo · ' : ''}
            {evaluation.scope === 'complete' ? 'Session summary' : 'Limited session summary'}
          </p>
        </div>
        <FileCheck2 aria-hidden="true" size={24} />
      </header>
      <p>{coaching.summary}</p>
      <section className="preparation-report-section" aria-label="Strengths">
        <h4>
          <CheckCircle2 className="report-strength-icon" aria-hidden="true" size={19} />
          Strengths
        </h4>
        {coaching.strengths?.length ? (
          <ul>
            {coaching.strengths.map((strength, index) => (
              <li key={index}>
                <p>{strength.statement}</p>
                {strength.significance && <p className="muted">{strength.significance}</p>}
                <details className="report-citations">
                  <summary>Supporting answer</summary>
                  {evaluation.turns
                    .filter((turn) => strength.turnIds.includes(turn.id))
                    .map((turn) => (
                      <blockquote key={turn.id}>{turn.text}</blockquote>
                    ))}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {coaching.strengths === undefined
              ? 'Strengths were not assessed in this earlier review.'
              : 'This review did not establish a specific strength from the available answers.'}
          </p>
        )}
      </section>
      <section className="preparation-report-section" aria-label="Financial blind spots">
        <h4>
          <TriangleAlert className="report-gap-icon" aria-hidden="true" size={19} />
          Financial blind spots
        </h4>
        {coaching.items.length ? (
          <ul>
            {coaching.items.map((item) => (
              <li key={item.id}>
                <p>{item.gap}</p>
                {item.analysis && (
                  <>
                    <p>{item.analysis.financialInterpretation}</p>
                    <p className="report-implication">
                      <strong>Why it matters:</strong> {item.analysis.investorImplication}
                    </p>
                  </>
                )}
                <details className="report-citations">
                  <summary>Supporting answer and evidence</summary>
                  {report.extraction.claims
                    .filter((claim) => claim.id === item.claimId)
                    .map((claim) => (
                      <blockquote key={claim.id}>{claim.quote}</blockquote>
                    ))}
                  {report.checks
                    .filter((check) => check.claimId === item.claimId)
                    .map((check) => (
                      <p key={check.claimId}>{check.explanation}</p>
                    ))}
                  <p className="muted">Inspect the saved sources in the detailed review below.</p>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No financial blind spot was identified within this review's coverage. This does not
            verify every financial claim.
          </p>
        )}
      </section>
      <section className="preparation-report-section" aria-label="Recommended preparation">
        <h4>
          <Target aria-hidden="true" size={19} />
          Recommended preparation
        </h4>
        {coaching.items.length ? (
          <ul>
            {coaching.items.map((item) => (
              <li key={item.id}>
                <p>{item.suggestion}</p>
                {item.analysis && (
                  <ol className="report-preparation-steps">
                    {item.analysis.preparationSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {item.missingInputs.length > 0 && (
                  <p className="muted">Bring evidence: {item.missingInputs.join('; ')}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No additional preparation action was identified from the answers reviewed.
          </p>
        )}
      </section>
    </div>
  );
}
