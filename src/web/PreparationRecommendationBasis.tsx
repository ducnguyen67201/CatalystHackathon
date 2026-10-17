import { FinancialSourceEvidence, InvestorSourceEvidence } from './PreparationSourceEvidence.js';
import { Decimal } from 'decimal.js';
import type { PreparationView } from '../contracts/FundraisingPreparation.js';
import { projectSchedule } from './PreparationScheduleModel.js';

/** Explanations cite frozen evidence and disclose templates instead of inventing a rationale. */
export function PreparationRecommendationBasis({
  data,
  onEvidence,
}: {
  data: PreparationView;
  onEvidence: (artifactId: string) => void;
}) {
  const financial = data.plan?.artifacts.find((item) => item.kind === 'financial');
  const investor = data.plan?.artifacts.find((item) => item.kind === 'investor');
  const reviewed = (id: string) =>
    data.milestones.find((item) => item.id === id)?.status === 'complete';
  const focus = !reviewed('financial')
    ? financial
    : data.goal?.investorId && !reviewed('brief')
      ? investor
      : financial;
  const reason = data.connectedActive
    ? (data.milestones.find((item) => item.status !== 'complete')?.detail ??
      'All preparation gates have completion evidence. This does not establish an investor decision.')
    : data.outdated
      ? 'Saved inputs changed. The earlier recommendation needs a fresh plan before another review.'
      : !reviewed('financial')
        ? (financial?.why ?? 'No selected financial evidence is available yet.')
        : !data.goal?.investorId
          ? 'Your financial explanation is reviewed, but no investor is selected. Selecting one lets June tailor the brief to saved investor research.'
          : !reviewed('brief')
            ? (investor?.why ?? 'The selected investor has no prepared brief yet.')
            : !reviewed('rehearse')
              ? 'The explanation has been reviewed. A completed rehearsal assessment is still needed to check how you explain it and identify remaining gaps.'
              : data.feedback.length
                ? 'Saved assessment feedback still has unresolved preparation tasks.'
                : 'All preparation gates have completion evidence. This does not establish an investor decision.';
  const projection = projectSchedule(data);
  const hours = projection.rows
    .filter((item) => item.status !== 'complete')
    .reduce((sum, item) => sum.plus(item.hours ?? 0), new Decimal(0))
    .toString();
  const chart = financial?.chart;
  return (
    <details className="prep-recommendation-basis">
      <summary>Why this recommendation? · evidence & assumptions</summary>
      <dl>
        <div>
          <dt>Your goal</dt>
          <dd>{data.intent || 'Goal not provided'}</dd>
        </div>
        <div>
          <dt>Why this next action</dt>
          <dd>{reason}</dd>
        </div>
        <div>
          <dt>Evidence behind it</dt>
          <dd>
            {chart ? (
              <p>
                {chart.fileName} · {chart.period} · CSV row {chart.sourceRow}: operating income{' '}
                {chart.operatingIncome}, reported credit {chart.credit}, net income{' '}
                {chart.netIncome} ({chart.currency}).{' '}
                {financial.fictional ? 'Fictional demo evidence.' : 'Uploaded financial statement.'}
              </p>
            ) : (
              <p>No sourced financial figures are available for this recommendation.</p>
            )}
            {financial && data.plan && (
              <FinancialSourceEvidence planId={data.plan.id} artifact={financial} />
            )}
            {focus?.kind === 'investor' &&
              focus.sources.map((source) => (
                <InvestorSourceEvidence key={source.id} source={source} />
              ))}
            {focus && (
              <button
                className="button secondary"
                onClick={() => onEvidence(focus.id)}
                disabled={data.outdated}
              >
                Inspect prepared work & source figures
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>Baseline timing calculation</dt>
          <dd>
            <p>
              This explains the saved or suggested baseline. The timeline’s slower/faster controls
              multiply daily capacity by 0.75 or 1.25 for a temporary comparison.
            </p>
            {projection.finish ? (
              <>
                {hours} estimated hours remain at {projection.capacity} hours per calendar day.
                Founder work is modeled in sequence; fractional completion days round up.
                {data.schedule?.planId === data.plan?.id && data.schedule?.cashExpectedDate
                  ? ` The brief also waits for assumed evidence delivery on ${data.schedule.cashExpectedDate}.`
                  : ''}
                <p>
                  {projection.automatic
                    ? 'These effort and availability values are June’s planning template. They are not derived from your financials or measured work speed.'
                    : 'These are your saved planning assumptions, not observed productivity.'}{' '}
                  Accepting a plan does not verify cash receipt.
                </p>
              </>
            ) : (
              projection.reason
            )}
          </dd>
        </div>
        <div>
          <dt>What is still unknown</dt>
          <dd>
            Cash balance, cash-flow forecast, credit recurrence and receipt timing are not
            established by an income statement. Public investor observations do not confirm current
            mandate, check size or willingness to invest.
          </dd>
        </div>
        <div>
          <dt>Could a different raise amount be justified?</dt>
          <dd>
            {data.goal?.amount
              ? `Your target is ${data.goal.amount} ${data.goal.currency === 'unspecified' ? '(currency unconfirmed)' : data.goal.currency}, entered by you. `
              : 'You have not confirmed a raise amount. '}
            June has not calculated an alternative amount. A defensible recommendation needs a dated
            cash balance, a reviewed cash-flow forecast, the milestone to fund and explicit buffer
            assumptions. Until those inputs are available, a lower or higher raise is not supported
            by this plan.
          </dd>
        </div>
      </dl>
      <p className="muted">
        Plan prepared {data.plan?.createdAt ?? 'not yet'}. Source facts, founder targets, planning
        estimates and recommendations remain separate.
      </p>
    </details>
  );
}
