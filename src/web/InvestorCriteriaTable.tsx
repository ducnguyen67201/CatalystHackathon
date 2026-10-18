import type { InvestorMatchAssessment, InvestorMatchInput } from '../contracts/InvestorMatch.js';
import type { InvestorProfileEstimateView } from '../contracts/InvestorProfileEstimate.js';
import { compareInvestorCriteria } from './InvestorCriteriaComparison.js';

export function InvestorCriteriaTable({
  assessment,
  goal,
  profile,
  outdated = false,
}: {
  assessment: InvestorMatchAssessment;
  goal: InvestorMatchInput['goal'] | null;
  profile: InvestorProfileEstimateView | null;
  outdated?: boolean;
}) {
  const rows = compareInvestorCriteria(assessment, goal, profile, outdated);
  return (
    <>
      <div
        className="goal-table-scroll"
        role="region"
        aria-label="Investor criteria comparison. Scroll horizontally on small screens."
        tabIndex={0}
      >
        <table className="investor-criteria-table">
          <caption>Investor priorities and eligibility compared with this goal</caption>
          <thead>
            <tr>
              <th>Criterion</th>
              <th>Your goal</th>
              <th>Investor criteria</th>
              <th>Comparison</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.criterion}>
                <th scope="row">{row.label}</th>
                <td>{row.goal}</td>
                <td>{row.investor}</td>
                <td>
                  <strong>{row.result}</strong>
                  <small className="investor-criteria-basis">{row.basis}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {profile?.estimate && (
        <p className="muted investor-criteria-note">
          AI comparisons are provisional. Verified evidence coverage stays unchanged.
        </p>
      )}
      <details className="journey-details">
        <summary>Saved research assessment & gaps</summary>
        {assessment.criteria.map((criterion) => (
          <div key={criterion.criterion} className="investor-criteria-source-note">
            <strong>
              {criterion.criterion.replaceAll('_', ' ')} · {criterion.state.replaceAll('_', ' ')}
            </strong>
            <p>{criterion.reason}</p>
          </div>
        ))}
        {assessment.unknowns.length > 0 && (
          <ul>
            {assessment.unknowns.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
