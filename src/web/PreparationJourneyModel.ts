import type { PreparationView } from '../contracts/FundraisingPreparation.js';

export type JourneyAction = 'goal' | 'financial' | 'investor' | 'brief' | 'rehearse' | 'refresh';
export type JourneyStatus = PreparationView['milestones'][number]['status'];
export interface JourneyNode {
  id: string;
  title: string;
  status: JourneyStatus;
  detail: string;
  action: JourneyAction;
  actionLabel: string;
}
const definitions = [
  {
    id: 'strategy',
    action: 'goal',
    actionLabel: 'Review goal',
  },
  {
    id: 'financial',
    action: 'financial',
    actionLabel: 'Review prepared explanation',
  },
  {
    id: 'investor',
    action: 'investor',
    actionLabel: 'Choose investor',
  },
  {
    id: 'brief',
    action: 'brief',
    actionLabel: 'Review investor brief',
  },
  {
    id: 'rehearse',
    action: 'rehearse',
    actionLabel: 'Open targeted rehearsal',
  },
] satisfies Array<{
  id: string;
  action: JourneyAction;
  actionLabel: string;
}>;
export const journeyStatusLabels: Record<JourneyStatus, string> = {
  complete: 'Reviewed',
  available: 'Next move',
  needs_review: 'Ready for review',
  blocked: 'Dependency missing',
};
export function buildJourney(view: PreparationView): JourneyNode[] {
  const milestones = definitions.map((definition): JourneyNode => {
    const milestone = view.milestones.find((item) => item.id === definition.id);
    const blocked = milestone?.status === 'blocked';
    const prerequisite =
      blocked && definition.id === 'brief' && !view.goal?.investorId
        ? 'investor'
        : blocked && (definition.id === 'brief' || definition.id === 'rehearse')
          ? 'financial'
          : null;
    return {
      ...definition,
      title: milestone?.title ?? definition.id,
      status: milestone?.status ?? 'blocked',
      detail: milestone?.detail ?? 'Confirm your goal to prepare this step.',
      action: view.outdated ? 'refresh' : (prerequisite ?? definition.action),
      actionLabel: view.outdated
        ? 'Refresh changed evidence'
        : prerequisite === 'investor'
          ? 'Choose an investor first'
          : prerequisite === 'financial'
            ? 'Review financial evidence first'
            : definition.actionLabel,
    };
  });
  const ready = milestones.every((node) => node.status === 'complete') && !view.outdated;
  const next =
    milestones.find((node) => node.status === 'needs_review' || node.status === 'available') ??
    milestones.find((node) => node.status !== 'complete');
  return [
    {
      id: 'current',
      title: 'Your current position',
      status: view.outdated ? 'needs_review' : 'complete',
      detail:
        view.plan?.summary ??
        'Confirm your goal and select financial evidence to establish your current position.',
      action: view.outdated ? 'refresh' : 'financial',
      actionLabel: view.outdated ? 'Refresh changed evidence' : 'Inspect financial evidence',
    },
    ...milestones,
    {
      id: 'target',
      title: 'Prepared for your investor conversation',
      status: ready ? 'complete' : 'blocked',
      detail: ready
        ? 'All five preparation gates have saved completion evidence. Confirm outstanding investor criteria before approaching them.'
        : 'Reach this preparation target by reviewing your financial explanation and investor brief, then completing the targeted assessment. Selecting an investor can happen alongside financial review.',
      action: view.outdated ? 'refresh' : (next?.action ?? 'goal'),
      actionLabel: view.outdated
        ? 'Refresh changed evidence'
        : (next?.actionLabel ?? 'Review goal'),
    },
  ];
}
