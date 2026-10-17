import type { Workspace, Job } from '../contracts/Workspace.js';
import type { PreparationGoal, PreparationPlan } from '../contracts/FundraisingPreparation.js';
import type { PreparationManifest } from '../contracts/PreparationPosition.js';
import { preparationPositionSchema } from '../contracts/PreparationPosition.js';

export function preparationChangeLabels(
  previous: PreparationManifest | undefined,
  next: PreparationManifest,
): string[] {
  if (!previous) return ['Preparation initialized from saved evidence.'];
  const labels: Record<keyof PreparationManifest, string> = {
    goal: 'Company goal or context changed.',
    financial: 'Selected financial baseline changed.',
    investor: 'Selected investor or supporting research changed.',
    practice: 'Completed assessment feedback changed.',
  };
  return (Object.keys(labels) as Array<keyof PreparationManifest>)
    .filter((key) => previous[key] !== next[key])
    .map((key) => labels[key]);
}
export function projectPreparationPosition(
  state: Workspace,
  jobs: Job[],
  goal: PreparationGoal | null,
  plan: PreparationPlan | null,
  currentManifest: PreparationManifest | null,
  outdated: boolean,
  now = new Date(),
) {
  const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
  const row = snapshot?.rows.at(-1);
  const investor = state.investors.find((item) => item.id === goal?.investorId);
  const check = investor?.checks.at(-1);
  const job = investor
    ? jobs
        .filter((item) => item.kind === `investor:${investor.id}`)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const status =
    job?.status === 'queued' || job?.status === 'running'
      ? job.status
      : job?.status === 'failed' && (!check || job.createdAt >= check.checkedAt)
        ? 'failed'
        : check
          ? 'checked'
          : 'never_checked';
  return preparationPositionSchema.parse({
    observedAt: now.toISOString(),
    revision: state.revision,
    financial: snapshot
      ? {
          snapshotId: snapshot.id,
          fileName: snapshot.fileName,
          period: row?.month ?? null,
          uploadedAt: snapshot.createdAt,
          operatingIncome: row?.operatingIncome ?? null,
          currency: snapshot.currency,
          fictional: snapshot.fileName === 'Tidewell.csv',
        }
      : null,
    investor: investor
      ? {
          id: investor.id,
          name: investor.name,
          lastCheckedAt: check?.checkedAt ?? null,
          currentProfile: check?.profileVersion === state.profile.version,
          nextAt: investor.nextAt,
          frequency: investor.frequency,
          status,
        }
      : null,
    pendingChanges:
      outdated && currentManifest
        ? plan?.manifest
          ? preparationChangeLabels(plan.manifest, currentManifest)
          : ['Saved inputs changed; the earlier plan has no comparable change record.']
        : [],
  });
}
