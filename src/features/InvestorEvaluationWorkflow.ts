import {
  investorEvaluationSchema,
  type InvestorEvaluation,
} from '../contracts/CombinedEvaluation.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';

const known = (value: string | null | undefined) =>
  value?.trim() && value.trim().toLowerCase() !== 'not confirmed' ? value.trim() : null;

/** Compare only structured observations frozen for the selected investor. No invented mandate. */
export function runInvestorEvaluation(context: EvaluationContext): InvestorEvaluation {
  const criteria = (['stage', 'sector', 'geography'] as const).map((criterion) => {
    const companyValue = known(context.investorAssessment?.company[criterion]);
    const observations = context.investorId
      ? (context.investorAssessment?.observations ?? []).flatMap((item) => {
          const source = context.sources.find(
            (candidate) => candidate.id === item.sourceId && candidate.kind === 'investor',
          );
          const value = known(item[criterion]);
          if (
            !source ||
            !source.text.trim() ||
            !value ||
            (source.origin !== 'public_unverified' && source.origin !== 'fictional')
          )
            return [];
          return [
            {
              sourceId: source.id,
              value,
              quote: source.text,
              url: source.url,
              recordedAt: source.recordedAt,
              origin: source.origin,
            },
          ];
        })
      : [];
    const aligned = observations.filter(
      (item) => item.value.toLowerCase() === companyValue?.toLowerCase(),
    );
    return {
      criterion,
      companyValue,
      observations,
      outcome:
        !companyValue || !observations.length
          ? 'unknown'
          : aligned.length === observations.length
            ? 'aligned'
            : aligned.length
              ? 'conflicting'
              : 'gap',
    };
  });
  return investorEvaluationSchema.parse({
    version: 1,
    investorId: context.investorId,
    investorName: context.investorName,
    status: criteria.every((item) => item.outcome === 'unknown') ? 'unavailable' : 'limited',
    criteria,
    limitations: [
      'These compare extracted research attributes, not a confirmed current investment mandate or funding probability.',
      'Exact labels are compared without inferring aliases, geographic coverage or stage ranges. A gap needs review.',
      'Public research remains unverified; observations may describe historical deals. Dates are retrieval dates, not mandate effective dates.',
      'Check size, personal priorities and qualitative thesis require additional sourced criteria and are not assessed here.',
      ...(!context.investorId ? ['No investor was selected for this session.'] : []),
      ...(!context.investorAssessment
        ? ['This older session has no frozen structured investor criteria.']
        : []),
    ],
  });
}
