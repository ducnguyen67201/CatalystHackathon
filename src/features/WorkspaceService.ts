import { synchronizePreparationIntent } from './PreparationIntent.js';
import { GoalJourneyService } from './GoalJourneyService.js';
import { recordGoalProgress, updateGoalScope } from './GoalProgress.js';
import { ensureTargetPreparation } from './ConnectedPreparationService.js';
import { buildPreparationPlan } from './PreparationPlanner.js';
import { assertCurrentPreparedPractice } from './ConnectedPreparation.js';
import { ConnectedPreparationService } from './ConnectedPreparationService.js';
import { PreparationPlanService } from './PreparationPlanService.js';
import { radarStateSchema } from '../contracts/RadarDelivery.js';
import { RadarDeliveryService } from './RadarDeliveryService.js';
import { assembleEvaluationContext } from './EvaluationContextAssembler.js';
import { queueEvaluation, RehearsalEvaluationService } from './RehearsalEvaluationService.js';
import type { EvaluationProvider } from './EvaluationProvider.js';
import type { ClaimedJob } from './WorkspaceStore.js';
import type { ResearchRunStore } from './ResearchRunStore.js';
import { randomUUID } from 'node:crypto';
import { silentWorkflowLog, type WorkflowLog } from './WorkflowLog.js';
import { discoveryStateSchema } from '../contracts/InvestorDiscovery.js';
import { RehearsalMode } from '../contracts/Workspace.js';
import { onboardingSchema, type MeetingInput } from '../contracts/Onboarding.js';
import { saveMeetingContext } from './Onboarding.js';
import { InvestorTrackingService } from './InvestorTrackingService.js';
import { Decimal } from 'decimal.js';
import {
  briefSchema,
  type Brief,
  type Profile,
  type Rehearsal,
  type Schedule,
  type TranscriptTurn,
  type Workspace,
} from '../contracts/Workspace.js';
import type { ResearchProvider } from './ResearchProvider.js';
import { importFinancials, findFinancialQuestion } from './Financials.js';
import { evaluateInvestorFit } from './InvestorFit.js';
import { nextPracticeQuestion, reviewAnswer } from './RehearsalReview.js';
import { nextScheduledCheck } from './Schedules.js';
import { ConflictError, type WorkspaceStore } from './WorkspaceStore.js';
import { practiceContextSchema, type PracticeContext } from '../contracts/PracticeContext.js';
import { ScenarioService, type ScenarioGenerator } from './ScenarioService.js';
import type { ScenarioStore } from './ScenarioStore.js';
import { PracticeTurnService } from './PracticeTurnService.js';
import type { PracticeTurnProvider } from './PracticeTurnProvider.js';
import { InvestorProfileService } from './InvestorProfileService.js';
import type { InvestorProfileProvider } from './InvestorProfileProvider.js';

export class WorkspaceService {
  readonly journey: GoalJourneyService;
  readonly investors: InvestorTrackingService;
  readonly radar: RadarDeliveryService;
  readonly evaluations: RehearsalEvaluationService;
  retrieveAvatarTranscript: ((sessionId: string) => Promise<void>) | null = null;
  readonly scenarios: ScenarioService | null;
  readonly guided: PracticeTurnService;
  readonly preparation: PreparationPlanService;
  readonly connected: ConnectedPreparationService;
  readonly investorProfiles: InvestorProfileService;

  constructor(
    readonly store: WorkspaceStore,
    private readonly research: ResearchProvider,
    evaluator: EvaluationProvider,
    readonly logger: WorkflowLog = silentWorkflowLog,
    readonly researchRuns?: ResearchRunStore,
    scenarioDependencies?: { store: ScenarioStore; generator: ScenarioGenerator },
    turnProvider?: PracticeTurnProvider,
    investorProfileProvider?: InvestorProfileProvider,
  ) {
    this.journey = new GoalJourneyService(this);
    this.investors = new InvestorTrackingService(this, research);
    this.radar = new RadarDeliveryService(this);
    this.evaluations = new RehearsalEvaluationService(this, evaluator);
    this.scenarios = scenarioDependencies
      ? new ScenarioService(
          scenarioDependencies.store,
          () => this.read(),
          scenarioDependencies.generator,
        )
      : null;
    this.guided = new PracticeTurnService(this, turnProvider);
    this.preparation = new PreparationPlanService(this);
    this.connected = new ConnectedPreparationService(this);
    this.investorProfiles = new InvestorProfileService(this, investorProfileProvider);
  }
  async read(): Promise<Workspace> {
    const state = await this.store.load();
    if (!state) {
      throw new Error('Workspace is not initialized. Run pnpm setup.');
    }
    return state;
  }
  async change<T>(
    operation: (state: Workspace) => T,
    completedJob?: ClaimedJob,
    checkpointJob?: ClaimedJob,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await this.read();
      const result = operation(state);
      recordGoalProgress(state, await this.store.listJobs());
      try {
        await this.store.save(state, state.revision, completedJob, checkpointJob);
        return result;
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new ConflictError('Please retry the operation.');
  }
  async initialize(csv: string): Promise<void> {
    if (await this.store.load()) {
      return;
    }
    const snapshot = importFinancials(csv, 'Tidewell.csv', 'unspecified');
    await this.store.initialize({
      id: 'tidewell',
      revision: 0,
      onboarding: onboardingSchema.parse({}),
      profile: {
        name: 'Tidewell',
        stage: 'Seed',
        sector: 'B2B software',
        geography: 'Canada',
        raiseTarget: '1000000',
        currency: 'unspecified',
        goal: 'Prepare for a seed raise and explain our financial position.',
        version: 1,
        watchlist: [],
      },
      schedule: { frequency: 'paused', timezone: 'America/Toronto', nextAt: null, lastAt: null },
      snapshots: [snapshot],
      evidence: [],
      briefs: [],
      rehearsals: [],
      milestones: [],
      notices: [],
      investors: [],
      discovery: discoveryStateSchema.parse({}),
      radar: radarStateSchema.parse({}),
    });
  }
  /** Reopens setup without deleting financials, company context, or research history. */
  async restartOnboarding(): Promise<void> {
    await this.change((state) => {
      state.onboarding.step = 1;
      state.onboarding.completedAt = null;
    });
  }

  async selectOnboardingFinancials(snapshotId: string): Promise<void> {
    await this.change((state) => {
      if (!state.snapshots.some((item) => item.id === snapshotId)) {
        throw new Error('Onboarding: choose a saved financial snapshot.');
      }
      state.onboarding.snapshotId = snapshotId;
      state.onboarding.step = 2;
    });
  }

  async saveOnboardingCompany(profile: Omit<Profile, 'version'>): Promise<void> {
    await this.change((state) => {
      if (!state.onboarding.snapshotId) {
        throw new Error('Onboarding: choose financial data first.');
      }
      state.profile = { ...profile, version: state.profile.version + 1 };
      synchronizePreparationIntent(state);
      state.onboarding.step = 3;
    });
  }

  async completeOnboarding(meeting: MeetingInput | null): Promise<void> {
    await this.change((state) => {
      if (!state.onboarding.snapshotId || state.onboarding.step !== 3) {
        throw new Error('Onboarding: finish financial and company setup first.');
      }
      saveMeetingContext(state, meeting);
      synchronizePreparationIntent(
        state,
        new Date().toISOString(),
        state.onboarding.meeting?.investorId ?? null,
      );
      state.onboarding.completedAt ??= new Date().toISOString();
      state.briefs.push(
        this.buildBrief(state, this.chooseEvidenceId(state), state.briefs.at(-1) ?? null),
      );
    });
  }

  async updateInvestorMeeting(meeting: MeetingInput | null): Promise<void> {
    await this.change((state) => {
      saveMeetingContext(state, meeting);
      if (state.preparation?.journey) {
        const journey = state.preparation.journey;
        let target = journey.targets.find(
          (t) => t.investorId === state.onboarding.meeting?.investorId,
        );
        const investorId = state.onboarding.meeting?.investorId;
        if (!target && investorId) {
          if (journey.targets.length >= 50)
            throw new ConflictError('This goal has reached its 50-target limit.');
          const now = new Date().toISOString();
          target = {
            id: randomUUID(),
            investorId,
            assessmentId: null,
            rationale:
              'Founder-selected investor conversation; current mandate needs verification.',
            status: 'active',
            included: true,
            createdAt: now,
            updatedAt: now,
            eventId: null,
          };
          journey.targets.push(target);
          updateGoalScope(journey, 'Investor conversation added to the preparation scope.');
        }
        if (target) {
          if (target.status === 'archived') {
            target.status = 'active';
            target.updatedAt = new Date().toISOString();
            updateGoalScope(journey, 'Investor conversation resumed in the preparation scope.');
          }
          journey.focusedTargetId = target.id;
          ensureTargetPreparation(state, target.id, target.investorId);
        }
        const goal = state.preparation.goals.at(-1);
        if (goal)
          state.preparation.plans.push(buildPreparationPlan(state, goal, new Date().toISOString()));
        state.preparation.version++;
        return;
      }
      synchronizePreparationIntent(
        state,
        new Date().toISOString(),
        state.onboarding.meeting?.investorId ?? null,
      );
    });
  }

  /** A named meeting may use only evidence attached to that investor's checks. */
  private chooseEvidenceId(state: Workspace): string | null {
    const meeting = state.onboarding.meeting;
    if (meeting) {
      const investor = state.investors.find((item) => item.id === meeting.investorId);
      return investor?.checks.at(-1)?.evidenceIds.at(-1) ?? investor?.discoveryEvidenceId ?? null;
    }
    return (
      (
        state.evidence.filter((item) => evaluateInvestorFit(state.profile, item).suitable).at(-1) ??
        state.evidence.at(-1)
      )?.id ?? null
    );
  }

  async updateProfile(profile: Omit<Profile, 'version'>): Promise<void> {
    await this.change((state) => {
      state.profile = { ...profile, version: state.profile.version + 1 };
      synchronizePreparationIntent(state);
    });
    await this.store.enqueue(`profile:${(await this.read()).profile.version}`, 'rebuild');
  }
  async upload(csv: string, fileName: string, currency: Profile['currency']): Promise<string> {
    const snapshot = importFinancials(csv, fileName, currency);
    return this.change((state) => {
      const existing = state.snapshots.find((item) => item.hash === snapshot.hash);
      if (existing) {
        return existing.id;
      }
      state.snapshots.push(snapshot);
      if (state.onboarding.snapshotId) {
        state.onboarding.snapshotId = snapshot.id;
      }
      for (const milestone of state.milestones) {
        if (milestone.status === 'open') {
          milestone.observation =
            'New financial data is available. Review progress against your baseline.';
        }
      }
      return snapshot.id;
    });
  }
  async setSchedule(settings: Pick<Schedule, 'frequency' | 'timezone'>): Promise<void> {
    await this.change((state) => {
      state.schedule = {
        ...state.schedule,
        ...settings,
        nextAt: nextScheduledCheck(settings, new Date()),
      };
    });
  }
  private buildBrief(
    state: Workspace,
    evidenceId: string | null,
    previous: Brief | null = null,
  ): Brief {
    const snapshot =
      state.snapshots.find((item) => item.id === state.onboarding.snapshotId) ??
      state.snapshots.at(-1);
    if (!snapshot) {
      throw new Error('Upload financial data first.');
    }
    const evidence = state.evidence.find((item) => item.id === evidenceId);
    return briefSchema.parse({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      snapshotId: snapshot.id,
      profileVersion: state.profile.version,
      evidenceId: evidence?.id ?? null,
      investor:
        state.onboarding.meeting?.name ||
        state.onboarding.meeting?.firm ||
        evidence?.investor ||
        'Financial preparation',
      meeting: state.onboarding.meeting,
      fit: evidence
        ? evaluateInvestorFit(state.profile, evidence)
        : {
            stage: 'unknown',
            sector: 'unknown',
            geography: 'unknown',
            checkRange: 'unknown',
            suitable: true,
          },
      finding: findFinancialQuestion(snapshot),
      openQuestions: [
        'What cash balance and cash-flow forecast support the plan?',
        'Which milestone will this raise fund, and what will it cost?',
        'What explains the change in operating performance?',
      ],
      previousBriefId: previous?.id ?? null,
      review: null,
    });
  }
  async rebuild(): Promise<string> {
    return this.change((state) => {
      const evidenceId = this.chooseEvidenceId(state);
      const latest = state.briefs.at(-1);
      const snapshot =
        state.snapshots.find((item) => item.id === state.onboarding.snapshotId) ??
        state.snapshots.at(-1);
      if (
        latest &&
        latest.profileVersion === state.profile.version &&
        latest.snapshotId === snapshot?.id &&
        latest.evidenceId === evidenceId &&
        JSON.stringify(latest.meeting) === JSON.stringify(state.onboarding.meeting)
      ) {
        return 'The existing brief already uses the latest inputs.';
      }
      state.briefs.push(this.buildBrief(state, evidenceId, latest ?? null));
      return 'Meeting brief updated from the current evidence and financials.';
    });
  }
  async runRadar(jobId?: string, attempt = 1): Promise<string> {
    const input = await this.read();
    const candidates = await this.research.discover(input.profile, undefined, undefined, {
      ...(jobId ? { jobId } : {}),
      attempt,
    });
    const result = await this.change((state) => {
      if (state.profile.version !== input.profile.version) {
        throw new ConflictError(
          'Profile changed during research. The worker will retry with current inputs.',
        );
      }
      const fresh = candidates.filter(
        (item) => !state.evidence.some((existing) => existing.eventKey === item.eventKey),
      );
      state.evidence.push(...fresh);
      const suitable = fresh.filter((item) => evaluateInvestorFit(state.profile, item).suitable);
      if (suitable.length) {
        const evidence = suitable.at(-1);
        if (evidence) {
          state.briefs.push(
            this.buildBrief(
              state,
              state.onboarding.meeting ? this.chooseEvidenceId(state) : evidence.id,
              state.briefs.at(-1) ?? null,
            ),
          );
        }
        state.notices.push({
          id: randomUUID(),
          title: 'New investor evidence',
          message: `${suitable.length} research lead${suitable.length === 1 ? '' : 's'} added. Inspect the source and missing information before approaching.`,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
      state.schedule.lastAt = new Date().toISOString();
      return fresh.length
        ? `${fresh.length} new source${fresh.length === 1 ? '' : 's'}; ${suitable.length} possible fit${suitable.length === 1 ? '' : 's'}.`
        : 'No new source changes. No notification created.';
    });
    return result;
  }
  async tickSchedule(now: Date): Promise<void> {
    const state = await this.read();
    if (
      state.schedule.frequency === 'paused' ||
      !state.schedule.nextAt ||
      new Date(state.schedule.nextAt) > now
    ) {
      return;
    }
    const due = state.schedule.nextAt;
    await this.store.enqueue(`scheduled:${due}`, 'radar');
    await this.change((current) => {
      if (current.schedule.nextAt === due) {
        current.schedule.nextAt = nextScheduledCheck(current.schedule, now);
      }
    });
  }
  async createRehearsal(
    briefId: string | null,
    mode: Rehearsal['mode'],
    conversationId: string | null = null,
    context: PracticeContext | null = null,
    avatarCorrelationHash: string | null = null,
  ): Promise<Rehearsal> {
    const frozenContext = context === null ? null : practiceContextSchema.parse(context);
    return this.change((state) => {
      assertCurrentPreparedPractice(state, frozenContext);
      const brief = state.briefs.find((item) => item.id === briefId);
      if (
        !brief &&
        !(
          briefId === null &&
          (mode === 'elevenlabs' || mode === RehearsalMode.LIVEAVATAR) &&
          frozenContext !== null
        )
      ) {
        throw new Error('Choose an existing brief.');
      }
      if (
        (mode === 'elevenlabs' || mode === RehearsalMode.LIVEAVATAR) &&
        state.rehearsals.some(
          (item) =>
            (item.mode === 'elevenlabs' || item.mode === RehearsalMode.LIVEAVATAR) &&
            item.status === 'active',
        )
      ) {
        throw new Error('End an active rehearsal before starting another.');
      }
      const active = state.rehearsals.filter((item) => item.status === 'active').length;
      if (active >= 3) {
        throw new Error('End an active rehearsal before starting another.');
      }
      const session: Rehearsal = {
        id: randomUUID(),
        briefId,
        mode,
        status: 'active',
        createdAt: new Date().toISOString(),
        conversationId,
        turns: [],
        review: null,
        context: frozenContext,
        transcriptReceivedAt: null,
        avatarSessionId: null,
        avatarCorrelationHash,
        evaluationContext: assembleEvaluationContext(state, frozenContext, brief ?? null),
        evaluations: [],
        evaluationResponses: [],
      };
      if (mode !== 'elevenlabs' && mode !== RehearsalMode.LIVEAVATAR && brief) {
        session.turns.push({ role: 'agent', text: brief.finding.question });
      }
      state.rehearsals.push(session);
      return session;
    });
  }
  async attachAvatarSession(sessionId: string, avatarSessionId: string): Promise<void> {
    await this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (
        !session ||
        (!session.avatarCorrelationHash && session.mode !== RehearsalMode.LIVEAVATAR) ||
        session.avatarSessionId
      ) {
        throw new Error('Session unavailable.');
      }
      session.avatarSessionId = avatarSessionId;
    });
  }

  /** Called only after a signed provider webhook. Never bind a browser-reported conversation ID. */
  async bindAvatarConversation(
    sessionId: string,
    correlationHash: string,
    conversationId: string,
  ): Promise<string | null> {
    return this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (
        !session ||
        session.mode !== 'elevenlabs' ||
        session.avatarCorrelationHash !== correlationHash ||
        !session.avatarSessionId ||
        (session.conversationId !== null && session.conversationId !== conversationId) ||
        state.rehearsals.some(
          (item) => item.id !== sessionId && item.conversationId === conversationId,
        )
      ) {
        return null;
      }
      session.conversationId = conversationId;
      return session.id;
    });
  }

  async answer(sessionId: string, text: string): Promise<void> {
    await this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (
        !session ||
        session.guided ||
        session.status !== 'active' ||
        session.mode === 'elevenlabs' ||
        session.mode === RehearsalMode.LIVEAVATAR
      ) {
        throw new Error('This practice session is not available for text answers.');
      }
      const brief = state.briefs.find((item) => item.id === session.briefId);
      if (!brief) {
        throw new Error('Brief unavailable.');
      }
      if (session.turns.length >= 20) {
        throw new Error('Finish this rehearsal before starting another.');
      }
      session.turns.push(
        { role: 'user', text },
        {
          role: 'agent',
          text: nextPracticeQuestion(brief, [...session.turns, { role: 'user', text }]),
        },
      );
    });
  }
  async finishRehearsal(
    sessionId: string,
    turns: TranscriptTurn[],
    completed: boolean,
    fromProvider = false,
  ): Promise<void> {
    await this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (!session) {
        throw new Error('Session unavailable.');
      }
      if (session.guided) throw new Error('This practice must be finished in guided practice.');
      if (session.status === 'completed' || session.transcriptReceivedAt !== null) {
        return;
      }
      if (
        (session.mode === 'elevenlabs' || session.mode === RehearsalMode.LIVEAVATAR) &&
        !fromProvider
      ) {
        session.status = completed ? 'awaiting_transcript' : 'partial';
        return;
      }
      if (fromProvider) {
        session.turns = turns;
        session.transcriptReceivedAt = new Date().toISOString();
      }
      session.status = completed ? 'completed' : 'partial';
      queueEvaluation(session, this.evaluations.provider);
      /* Legacy topic review remains separate from the evidence-backed evaluator. */
      if (session.briefId === null) {
        return;
      }
      const brief = state.briefs.find((item) => item.id === session.briefId);
      if (!brief) {
        throw new Error('Brief unavailable.');
      }
      session.review = reviewAnswer(brief, session.turns);
      if (completed) {
        state.briefs.push({
          ...brief,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          previousBriefId: brief.id,
          review: session.review,
        });
      }
    });
  }
  async trackFollowup(briefId: string): Promise<void> {
    await this.change((state) => {
      const brief = state.briefs.find((item) => item.id === briefId);
      if (!brief) {
        throw new Error('Brief unavailable.');
      }
      if (state.milestones.some((item) => item.briefId === brief.id)) {
        return;
      }
      state.milestones.push({
        id: randomUUID(),
        briefId,
        snapshotId: brief.snapshotId,
        title: 'Explain what changed in operating performance and add cash-flow evidence.',
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        status: 'open',
        createdAt: new Date().toISOString(),
        observation: null,
      });
    });
  }
  async reviewDueMilestones(now: Date): Promise<void> {
    const state = await this.read();
    for (const milestone of state.milestones) {
      if (milestone.status === 'open' && new Date(milestone.dueAt) <= now) {
        await this.reviewMilestone(milestone.id, true);
      }
    }
  }
  async reviewMilestone(id: string, notify = false): Promise<void> {
    await this.change((state) => {
      const milestone = state.milestones.find((item) => item.id === id);
      if (!milestone) {
        throw new Error('Follow-up unavailable.');
      }
      const baseline = state.snapshots.find((item) => item.id === milestone.snapshotId);
      const latest = state.snapshots.at(-1);
      if (!baseline || !latest) {
        throw new Error('Financial evidence unavailable.');
      }
      if (baseline.currency !== latest.currency) {
        throw new Error('Snapshots use different currencies and cannot be compared.');
      }
      const finding = findFinancialQuestion(baseline);
      const row = latest.rows.at(-1);
      if (!row) {
        throw new Error('Latest month unavailable.');
      }
      const change = new Decimal(row.operatingIncome).minus(finding.operatingIncome);
      if (notify && !state.notices.some((item) => item.id === 'review-' + id)) {
        state.notices.push({
          id: 'review-' + id,
          title: 'A follow-up is ready for review',
          message: milestone.title,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
      milestone.status = 'reviewed';
      milestone.observation = `${finding.month} operating result ${finding.operatingIncome} → ${row.month} ${row.operatingIncome}; change ${change.toFixed()}. Sources: ${baseline.fileName} row ${finding.sourceRow} and ${latest.fileName} row ${row.sourceRow}. ${baseline.id === latest.id ? 'This compares existing months in the same snapshot, not new data. ' : ''}The causes and cash runway still need investigation.`;
    });
  }
}
