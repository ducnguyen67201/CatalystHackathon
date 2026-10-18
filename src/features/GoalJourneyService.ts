import { randomUUID } from 'node:crypto';
import {
  goalJourneyViewSchema,
  journeyCommandSchema,
  savedInvestorMatchSchema,
  type JourneyCommand,
  type SavedInvestorMatch,
  type GoalProgressQuery,
} from '../contracts/GoalJourney.js';
import { trackedInvestorSchema, type TrackedInvestor } from '../contracts/InvestorTracking.js';
import type { Workspace } from '../contracts/Workspace.js';
import { assessInvestorMatch } from './InvestorMatch.js';
import {
  buildInvestorMatchGoal,
  buildInvestorMatchInput,
  savedMatchOutdated,
} from './InvestorMatchInputs.js';
import { connectedHash } from './ConnectedPreparation.js';
import { ensureTargetPreparation } from './ConnectedPreparationService.js';
import {
  ensureGoalJourney,
  projectGoalPosition,
  projectGoalTrack,
  updateGoalScope,
  recordGoalProgress,
} from './GoalProgress.js';
import { ConflictError, UnavailableError } from './WorkspaceStore.js';
import type { WorkspaceService } from './WorkspaceService.js';

function resolveInvestor(state: Workspace, investorId?: string, eventId?: string): TrackedInvestor {
  if (investorId) {
    const investor = state.investors.find((i) => i.id === investorId);
    if (!investor) throw new UnavailableError('Investor unavailable.');
    if (
      eventId &&
      !state.radar.events.some((e) => e.id === eventId && e.investorId === investor.id)
    )
      throw new UnavailableError('Investor update unavailable.');
    return investor;
  }
  const event = state.radar.events.find((e) => e.id === eventId);
  if (!event) throw new UnavailableError('Radar update unavailable.');
  if (event.investorId) return resolveInvestor(state, event.investorId);
  const suggestion = state.discovery.suggestions.find((s) => s.id === event.suggestionId);
  if (
    !suggestion ||
    suggestion.profileVersion !== state.profile.version ||
    suggestion.status === 'dismissed'
  )
    throw new ConflictError('Candidate changed or was dismissed. Review current research.');
  const key = 'candidate:' + suggestion.id;
  let investor = state.investors.find(
    (i) => i.key === key || i.discoveryEvidenceId === suggestion.evidenceId,
  );
  if (!investor) {
    investor = trackedInvestorSchema.parse({
      id: randomUUID(),
      key,
      name: suggestion.name,
      url: null,
      origin: 'discovered',
      discoveryEvidenceId: suggestion.evidenceId,
      createdAt: new Date().toISOString(),
      frequency: 'paused',
      nextAt: null,
      checks: [],
    });
    state.investors.push(investor);
  }
  for (const related of state.radar.events)
    if (related.suggestionId === suggestion.id) related.investorId = investor.id;
  return investor;
}

function saveAssessment(state: Workspace, investor: TrackedInvestor): SavedInvestorMatch {
  const journey = ensureGoalJourney(state);
  if (!journey) throw new ConflictError('Confirm your preparation goal first.');
  const input = buildInvestorMatchInput(state, investor);
  const assessment = assessInvestorMatch(input);
  const prior = journey.assessments.findLast(
    (a) =>
      a.investorId === investor.id &&
      a.assessment.inputHash === assessment.inputHash &&
      !savedMatchOutdated(state, a),
  );
  if (prior) return prior;
  const saved = savedInvestorMatchSchema.parse({
    id: randomUUID(),
    journeyId: journey.id,
    goalVersionId: journey.currentGoalId,
    investorId: investor.id,
    evidenceIds: [...new Set(input.facts.map((f) => f.source.evidenceId))],
    assessment,
  });
  journey.assessments.push(saved);
  return saved;
}

export class GoalJourneyService {
  constructor(private readonly service: WorkspaceService) {}

  async view(journeyId?: string) {
    const [state, jobs] = await Promise.all([this.service.read(), this.service.store.listJobs()]);
    const journey = journeyId
      ? [state.preparation?.journey, ...(state.preparation?.journeyHistory ?? [])].find(
          (item) => item?.id === journeyId,
        )
      : state.preparation?.journey;
    if (journeyId && !journey) throw new UnavailableError('Goal unavailable.');
    const historical = journey?.status === 'archived';
    return goalJourneyViewSchema.parse({
      matchGoal: historical ? null : buildInvestorMatchGoal(state),
      journey: journey
        ? { ...journey, commands: undefined, assessments: undefined, events: undefined }
        : null,
      revision: journey?.revision ?? 0,
      intent: historical
        ? (state.preparation?.goals.find((goal) => goal.id === journey.currentGoalId)?.objective ??
          'Earlier goal; original objective text was not retained.')
        : state.profile.goal,
      position: historical
        ? (journey.events.at(-1)?.position ?? null)
        : projectGoalPosition(state, jobs),
      assessments: journey?.assessments.slice(-100) ?? [],
      targets:
        journey?.targets.map((target) => {
          const assessment = journey.assessments.find((a) => a.id === target.assessmentId) ?? null;
          return {
            ...target,
            name: state.investors.find((i) => i.id === target.investorId)?.name ?? 'Saved investor',
            assessment,
            matchOutdated: !historical && !!assessment && savedMatchOutdated(state, assessment),
            track: historical
              ? (journey.events
                  .at(-1)
                  ?.position.tracks.find((track) => track.targetId === target.id) ?? null)
              : projectGoalTrack(state, target.id, jobs),
          };
        }) ?? [],
      events: journey?.events.slice(-100) ?? [],
      historyAvailable: !!journey?.lastSequence,
    });
  }

  async command(raw: JourneyCommand) {
    const command = journeyCommandSchema.parse(raw);
    const requestHash = connectedHash(command);
    await this.service.change((state) => {
      const journey = ensureGoalJourney(state);
      if (!journey) throw new ConflictError('Confirm your preparation goal first.');
      const preparation = state.preparation;
      if (!preparation) throw new ConflictError('Confirm your preparation goal first.');
      const replay = [journey, ...(preparation.journeyHistory ?? [])]
        .flatMap((j) => j.commands)
        .find((c) => c.key === command.key);
      if (replay) {
        if (replay.hash !== requestHash)
          throw new ConflictError('Request key reused with different inputs.');
        return;
      }
      if ((command.action !== 'activate' || command.journeyId) && command.journeyId !== journey.id)
        throw new ConflictError('The active goal changed. Open the current goal before saving.');
      if (journey.revision !== command.revision)
        throw new ConflictError('Preparation changed. Refresh before saving.');
      let resultId: string | null = null;
      if (command.action === 'new_goal') {
        journey.status = 'archived';
        (preparation.journeyHistory ??= []).push(structuredClone(journey));
        preparation.journey = undefined;
        ensureGoalJourney(state);
      } else if (command.action === 'assess') {
        const investor = resolveInvestor(state, command.investorId, command.eventId);
        resultId = saveAssessment(state, investor).id;
      } else if (command.action === 'shortlist') {
        const investor = resolveInvestor(state, command.investorId, command.eventId);
        const assessment = command.assessmentId
          ? journey.assessments.find(
              (a) => a.id === command.assessmentId && a.investorId === investor.id,
            )
          : saveAssessment(state, investor);
        if (!assessment || savedMatchOutdated(state, assessment))
          throw new ConflictError(
            'Match inputs changed. Review the current match before selecting.',
          );
        let target = journey.targets.find((t) => t.investorId === investor.id);
        const now = new Date().toISOString();
        if (!target) {
          if (journey.targets.length >= 50)
            throw new ConflictError('This goal has reached its 50-target limit.');
          target = {
            id: randomUUID(),
            investorId: investor.id,
            assessmentId: assessment.id,
            rationale: command.rationale,
            status: 'active',
            included: command.included,
            createdAt: now,
            updatedAt: now,
            eventId: command.eventId ?? null,
          };
          journey.targets.push(target);
        } else {
          target.assessmentId = assessment.id;
          target.rationale = command.rationale;
          target.status = 'active';
          target.included = command.included;
          target.updatedAt = now;
        }
        journey.focusedTargetId = target.id;
        updateGoalScope(journey, 'Target investor added to the preparation scope.');
        ensureTargetPreparation(state, target.id, investor.id);
        resultId = target.id;
      } else if (command.action !== 'activate') {
        const target = journey.targets.find((t) => t.id === command.targetId);
        if (!target) throw new UnavailableError('Target unavailable.');
        if (command.action === 'focus') {
          if (target.status !== 'active')
            throw new ConflictError('Resume this target before preparing.');
          journey.focusedTargetId = target.id;
          ensureTargetPreparation(state, target.id, target.investorId);
        }
        if (command.action === 'archive') {
          target.status = 'archived';
          if (journey.focusedTargetId === target.id)
            journey.focusedTargetId =
              journey.targets.find((t) => t.status === 'active')?.id ?? null;
        }
        if (command.action === 'resume') target.status = 'active';
        if (command.action === 'include') target.included = true;
        if (command.action === 'exclude') target.included = false;
        target.updatedAt = new Date().toISOString();
        updateGoalScope(journey, 'Preparation scope changed; removed work is not an improvement.');
        resultId = target.id;
      }
      const receiptJourney = state.preparation?.journey ?? journey;
      receiptJourney.commands.push({ key: command.key, hash: requestHash, resultId });
      receiptJourney.revision++;
    });
    return this.view();
  }

  async events(journeyId: string, query: GoalProgressQuery) {
    if (this.service.store.listGoalProgress)
      return this.service.store.listGoalProgress(journeyId, query);
    const state = await this.service.read();
    const journey = [state.preparation?.journey, ...(state.preparation?.journeyHistory ?? [])].find(
      (j) => j?.id === journeyId,
    );
    if (!journey) throw new UnavailableError('Goal history unavailable.');
    const boundary = query.beforeSequence ?? journey.lastSequence;
    const all = journey.events
      .filter(
        (e) =>
          e.sequence <= boundary &&
          (!query.cursor || e.sequence < query.cursor) &&
          (!query.targetId || e.position.tracks.some((t) => t.targetId === query.targetId)) &&
          (!query.from || e.recordedAt.slice(0, 10) >= query.from) &&
          (!query.to || e.recordedAt.slice(0, 10) <= query.to),
      )
      .reverse();
    return {
      items: all.slice(0, query.limit),
      nextCursor: all.length > query.limit ? (all[query.limit - 1]?.sequence ?? null) : null,
      beforeSequence: boundary,
    };
  }

  async reconcile() {
    const state = await this.service.read();
    const journey = state.preparation?.journey;
    if (!journey) return;
    const due = journey.assessments.filter(
      (a) =>
        journey.assessments.findLast((item) => item.investorId === a.investorId)?.id === a.id &&
        savedMatchOutdated(state, a),
    );
    const ids = new Set(due.map((a) => a.investorId));
    const jobs = await this.service.store.listJobs();
    if (!ids.size && !recordGoalProgress(structuredClone(state), jobs)) return;
    await this.service.change((current) => {
      for (const id of ids) {
        const investor = current.investors.find((i) => i.id === id);
        const latest = current.preparation?.journey?.assessments.findLast(
          (a) => a.investorId === id,
        );
        if (investor && latest && savedMatchOutdated(current, latest))
          saveAssessment(current, investor);
      }
    });
  }
}
