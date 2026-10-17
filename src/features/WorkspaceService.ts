import type { ResearchRunStore } from './ResearchRunStore.js';
import { randomUUID } from 'node:crypto';
import { silentWorkflowLog, type WorkflowLog } from './WorkflowLog.js';
import { discoveryStateSchema } from '../contracts/InvestorDiscovery.js';
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

export class WorkspaceService {
  readonly investors: InvestorTrackingService;

  constructor(
    readonly store: WorkspaceStore,
    private readonly research: ResearchProvider,
    readonly logger: WorkflowLog = silentWorkflowLog,
    readonly researchRuns?: ResearchRunStore,
  ) {
    this.investors = new InvestorTrackingService(this, research);
  }
  async read(): Promise<Workspace> {
    const state = await this.store.load();
    if (!state) {
      throw new Error('Workspace is not initialized. Run pnpm setup.');
    }
    return state;
  }
  async change<T>(operation: (state: Workspace) => T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await this.read();
      const result = operation(state);
      try {
        await this.store.save(state, state.revision);
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
    });
  }
  async updateProfile(profile: Omit<Profile, 'version'>): Promise<void> {
    await this.change((state) => {
      state.profile = { ...profile, version: state.profile.version + 1 };
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
    const snapshot = state.snapshots.at(-1);
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
      investor: evidence?.investor ?? 'Financial preparation',
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
      const evidence =
        state.evidence.filter((item) => evaluateInvestorFit(state.profile, item).suitable).at(-1) ??
        state.evidence.at(-1);
      const latest = state.briefs.at(-1);
      const snapshot = state.snapshots.at(-1);
      if (
        latest &&
        latest.profileVersion === state.profile.version &&
        latest.snapshotId === snapshot?.id &&
        latest.evidenceId === (evidence?.id ?? null)
      ) {
        return 'The existing brief already uses the latest inputs.';
      }
      state.briefs.push(this.buildBrief(state, evidence?.id ?? null, latest ?? null));
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
          state.briefs.push(this.buildBrief(state, evidence.id, state.briefs.at(-1) ?? null));
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
    briefId: string,
    mode: Rehearsal['mode'],
    conversationId: string | null = null,
  ): Promise<Rehearsal> {
    return this.change((state) => {
      const brief = state.briefs.find((item) => item.id === briefId);
      if (!brief) {
        throw new Error('Choose an existing brief.');
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
      };
      if (mode !== 'elevenlabs') {
        session.turns.push({ role: 'agent', text: brief.finding.question });
      }
      state.rehearsals.push(session);
      return session;
    });
  }
  async answer(sessionId: string, text: string): Promise<void> {
    await this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (!session || session.status !== 'active' || session.mode === 'elevenlabs') {
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
    fromWebhook = false,
  ): Promise<void> {
    await this.change((state) => {
      const session = state.rehearsals.find((item) => item.id === sessionId);
      if (!session) {
        throw new Error('Session unavailable.');
      }
      if (session.status === 'completed') {
        return;
      }
      if (session.mode === 'elevenlabs' && !fromWebhook) {
        session.status = completed ? 'awaiting_transcript' : 'partial';
        return;
      }
      if (fromWebhook) {
        session.turns = turns;
      }
      session.status = completed ? 'completed' : 'partial';
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
