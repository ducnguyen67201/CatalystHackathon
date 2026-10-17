import {
  researchRunSchema,
  researchRunListSchema,
  type ResearchRun,
  type ResearchRunQuery,
  type ResearchRunList,
} from '../contracts/ResearchRun.js';
import type { ResearchRunStore } from '../features/ResearchRunStore.js';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import {
  generationSchema,
  scenarioOutputSchema,
  type ScenarioOutput,
} from '../contracts/Scenario.js';
import type { ScenarioStore, NewScenarioGeneration } from '../features/ScenarioStore.js';
import {
  JobStatus,
  jobSchema,
  workspaceSchema,
  type Job,
  type Workspace,
} from '../contracts/Workspace.js';
import { ConflictError, type ClaimedJob, type WorkspaceStore } from '../features/WorkspaceStore.js';
const workspaceId = 'tidewell';
const json = (value: unknown): Prisma.InputJsonObject =>
  z.record(z.string(), z.json()).parse(value);
export class PrismaStore implements WorkspaceStore, ResearchRunStore, ScenarioStore {
  private readonly client: PrismaClient;
  constructor(databaseUrl: string) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
  async load(): Promise<Workspace | null> {
    const record = await this.client.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        snapshots: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
        briefs: { orderBy: { createdAt: 'asc' } },
        rehearsals: { orderBy: { createdAt: 'asc' } },
        milestones: { orderBy: { createdAt: 'asc' } },
        notices: { orderBy: { createdAt: 'asc' } },
        investors: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!record) {
      return null;
    }
    return workspaceSchema.parse({
      id: record.id,
      revision: record.revision,
      profile: record.profile,
      onboarding: record.onboarding,
      schedule: record.schedule,
      discovery: record.discovery,
      snapshots: record.snapshots.map((item) => item.payload),
      evidence: record.evidence.map((item) => item.payload),
      briefs: record.briefs.map((item) => item.payload),
      rehearsals: record.rehearsals.map((item) => item.payload),
      milestones: record.milestones.map((item) => item.payload),
      notices: record.notices.map((item) => item.payload),
      investors: record.investors.map((item) => item.payload),
    });
  }
  async initialize(workspace: Workspace): Promise<void> {
    await this.client.workspace.upsert({
      where: { id: workspaceId },
      update: {},
      create: {
        id: workspaceId,
        profile: json(workspace.profile),
        onboarding: json(workspace.onboarding),
        schedule: json(workspace.schedule),
        discovery: json(workspace.discovery),
      },
    });
    const existing = await this.load();
    if (existing && existing.snapshots.length === 0) {
      await this.save({ ...workspace, revision: existing.revision }, existing.revision);
    }
  }
  async save(
    workspace: Workspace,
    expectedRevision: number,
    completedJob?: ClaimedJob,
  ): Promise<void> {
    await this.client.$transaction(
      async (tx) => {
        const lock = await tx.workspace.updateMany({
          where: { id: workspaceId, revision: expectedRevision },
          data: {
            revision: { increment: 1 },
            profile: json(workspace.profile),
            onboarding: json(workspace.onboarding),
            schedule: json(workspace.schedule),
            discovery: json(workspace.discovery),
            updatedAt: new Date(),
          },
        });
        if (lock.count !== 1) {
          throw new ConflictError('The workspace changed. Retry this operation.');
        }
        // Always lock workspace before jobs, matching ordinary receipt writes.
        if (completedJob) {
          const completed = await tx.workflowJob.updateMany({
            where: {
              id: completedJob.id,
              workspaceId,
              status: JobStatus.RUNNING,
              leaseToken: completedJob.leaseToken,
              leaseUntil: { gt: new Date() },
            },
            data: {
              status: JobStatus.SUCCEEDED,
              result: 'Evaluation saved.',
              leaseToken: null,
              leaseUntil: null,
            },
          });
          if (completed.count !== 1) throw new Error('Workflow lease expired.');
        }
        for (const payload of workspace.snapshots) {
          await tx.financialSnapshot.upsert({
            where: { id: payload.id },
            update: {},
            create: { id: payload.id, workspaceId, hash: payload.hash, payload: json(payload) },
          });
        }
        for (const payload of workspace.evidence) {
          await tx.evidence.upsert({
            where: { id: payload.id },
            update: {},
            create: {
              id: payload.id,
              workspaceId,
              eventKey: payload.eventKey,
              payload: json(payload),
            },
          });
        }
        for (const payload of workspace.briefs) {
          await tx.brief.upsert({
            where: { id: payload.id },
            update: {},
            create: { id: payload.id, workspaceId, payload: json(payload) },
          });
        }
        for (const payload of workspace.rehearsals) {
          await tx.rehearsal.upsert({
            where: { id: payload.id },
            update: { payload: json(payload), conversationId: payload.conversationId },
            create: {
              id: payload.id,
              workspaceId,
              conversationId: payload.conversationId,
              payload: json(payload),
            },
          });
        }
        // Receipt and queue intent commit together. Unique keys make replay idempotent.
        for (const session of workspace.rehearsals) {
          for (const evaluation of session.evaluations) {
            if (evaluation.status !== 'queued') continue;
            const kind = `evaluate:${session.id}:${evaluation.id}`;
            await tx.workflowJob.upsert({
              where: { key: `${kind}:${evaluation.generation}` },
              update: {},
              create: {
                id: randomUUID(),
                workspaceId,
                key: `${kind}:${evaluation.generation}`,
                kind,
              },
            });
          }
          if (
            session.evaluationContext !== null &&
            session.mode === 'liveavatar' &&
            session.status !== 'active' &&
            session.avatarSessionId &&
            !session.transcriptReceivedAt
          ) {
            const kind = `avatar-transcript:${session.id}`;
            await tx.workflowJob.upsert({
              where: { key: kind },
              update: {},
              create: { id: randomUUID(), workspaceId, key: kind, kind },
            });
          }
        }
        for (const payload of workspace.milestones) {
          await tx.milestone.upsert({
            where: { id: payload.id },
            update: { payload: json(payload) },
            create: { id: payload.id, workspaceId, payload: json(payload) },
          });
        }
        for (const payload of workspace.investors) {
          await tx.trackedInvestor.upsert({
            where: { id: payload.id },
            update: { payload: json(payload) },
            create: { id: payload.id, workspaceId, key: payload.key, payload: json(payload) },
          });
        }
        for (const payload of workspace.notices) {
          await tx.notice.upsert({
            where: { id: payload.id },
            update: { payload: json(payload) },
            create: { id: payload.id, workspaceId, payload: json(payload) },
          });
        }
      },
      { timeout: 15000 },
    );
  }
  async enqueue(key: string, kind: string): Promise<Job> {
    const activeWhere = {
      workspaceId,
      kind,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
    };
    const active =
      kind.startsWith('investor:') || kind === 'discover-investors'
        ? await this.client.workflowJob.findFirst({ where: activeWhere })
        : null;
    const row =
      active ??
      (await this.client.workflowJob
        .upsert({
          where: { key },
          update: {},
          create: { id: randomUUID(), workspaceId, key, kind },
        })
        .catch(async (error: unknown) => {
          // The partial unique index resolves simultaneous manual/scheduled checks.
          const code = z.object({ code: z.string() }).safeParse(error);
          if (
            (kind.startsWith('investor:') || kind === 'discover-investors') &&
            code.success &&
            code.data.code === 'P2002'
          ) {
            const pending = await this.client.workflowJob.findFirst({ where: activeWhere });
            if (pending) {
              return pending;
            }
          }
          throw error;
        }));
    return jobSchema.parse({
      id: row.id,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      createdAt: row.createdAt.toISOString(),
      result: row.result,
      error: row.error,
    });
  }
  async listJobs(): Promise<Job[]> {
    const [recent, investorJobs] = await Promise.all([
      this.client.workflowJob.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.client.workflowJob.findMany({
        where: {
          workspaceId,
          OR: [
            { kind: { startsWith: 'investor:' } },
            { kind: 'discover-investors' },
            { kind: { startsWith: 'evaluate:' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['kind'],
      }),
    ]);
    const rows = [
      ...new Map([...recent, ...investorJobs].map((row) => [row.id, row])).values(),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.map((row) =>
      jobSchema.parse({
        id: row.id,
        kind: row.kind,
        status: row.status,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
        result: row.result,
        error: row.error,
      }),
    );
  }
  async claimJob(now: Date): Promise<ClaimedJob | null> {
    const row = await this.client.workflowJob.findFirst({
      where: {
        workspaceId,
        OR: [
          { status: JobStatus.QUEUED, runAt: { lte: now } },
          { status: JobStatus.RUNNING, leaseUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) {
      return null;
    }
    if (row.attempts >= 3) {
      await this.client.workflowJob.updateMany({
        where: { id: row.id, attempts: row.attempts },
        data: {
          status: JobStatus.FAILED,
          error: 'Run exceeded its retry limit.',
          leaseUntil: null,
          leaseToken: null,
        },
      });
      return null;
    }
    const token = randomUUID();
    const result = await this.client.workflowJob.updateMany({
      where: { id: row.id, attempts: row.attempts, status: row.status, leaseToken: row.leaseToken },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        leaseUntil: new Date(now.getTime() + 360000),
        leaseToken: token,
        error: null,
        updatedAt: new Date(),
      },
    });
    return result.count === 1
      ? { id: row.id, kind: row.kind, leaseToken: token, attempts: row.attempts + 1 }
      : null;
  }
  async finishJob(job: ClaimedJob, result: string): Promise<void> {
    await this.client.workflowJob.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken },
      data: {
        status: JobStatus.SUCCEEDED,
        result,
        leaseUntil: null,
        leaseToken: null,
        updatedAt: new Date(),
      },
    });
  }
  async failJob(job: ClaimedJob, error: string): Promise<void> {
    await this.client.workflowJob.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken },
      data: {
        status: job.attempts >= 3 ? JobStatus.FAILED : JobStatus.QUEUED,
        error,
        runAt: new Date(Date.now() + job.attempts * 10000),
        leaseUntil: null,
        leaseToken: null,
        updatedAt: new Date(),
      },
    });
  }
  /** Same ID/body is idempotent; an existing archive is never overwritten. */
  async saveResearchRun(input: ResearchRun): Promise<ResearchRun> {
    const run = researchRunSchema.parse(input);
    const contentHash = createHash('sha256').update(JSON.stringify(run)).digest('hex');
    const row = await this.client.researchRun.upsert({
      where: { id: run.id },
      update: {},
      create: {
        id: run.id,
        workspaceId,
        investorId: run.investorId,
        jobId: run.jobId,
        kind: run.kind,
        contentHash,
        payload: json(run),
      },
    });
    if (row.workspaceId !== workspaceId || row.contentHash !== contentHash) {
      throw new ConflictError('Research run already exists with different data.');
    }
    return researchRunSchema.parse(row.payload);
  }

  async findResearchRun(id: string): Promise<ResearchRun | null> {
    const row = await this.client.researchRun.findFirst({ where: { id, workspaceId } });
    return row ? researchRunSchema.parse(row.payload) : null;
  }

  async listResearchRuns(query: ResearchRunQuery): Promise<ResearchRunList> {
    const rows = await this.client.researchRun.findMany({
      where: {
        workspaceId,
        ...(query.investorId ? { investorId: query.investorId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.offset,
      take: query.limit + 1,
    });
    return researchRunListSchema.parse({
      items: rows.slice(0, query.limit).map((row) => {
        const run = researchRunSchema.parse(row.payload);
        return {
          id: run.id,
          kind: run.kind,
          origin: run.origin,
          status: run.status,
          investorId: run.investorId,
          jobId: run.jobId,
          attempt: run.attempt,
          model: run.model,
          failure: run.failure,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          profileVersion: run.input.profileVersion,
          sourceCount: run.searches.reduce((sum, search) => sum + search.sources.length, 0),
          evidenceCount: run.evidence.length,
        };
      }),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    });
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }

  async getGenerationByRequestKey(key: string) {
    const row = await this.client.scenarioGeneration.findFirst({
      where: { workspaceId, job: { key: workspaceId + ':scenario:' + key } },
      include: { job: true },
    });
    return row ? this.generationFromRow(row) : null;
  }

  async createGeneration(requestKey: string, input: NewScenarioGeneration) {
    const id = await this.client
      .$transaction(async (tx) => {
        const job = await tx.workflowJob.upsert({
          where: { key: workspaceId + ':scenario:' + requestKey },
          update: {},
          create: {
            id: randomUUID(),
            workspaceId,
            key: workspaceId + ':scenario:' + requestKey,
            kind: 'scenario',
          },
        });
        const generation = await tx.scenarioGeneration.upsert({
          where: { jobId: job.id },
          update: {},
          create: {
            id: randomUUID(),
            workspaceId,
            investorId: input.input.investor.id,
            jobId: job.id,
            ...input,
            input: json(input.input),
          },
        });
        if (generation.requestHash !== input.requestHash)
          throw new ConflictError('Request key reused with different scenario inputs.');
        return generation.id;
      })
      .catch(async (error: unknown) => {
        // Concurrent Prisma upserts can lose the unique-key race. The winning
        // transaction has committed both records before its key can conflict.
        const code = z.object({ code: z.string() }).safeParse(error);
        if (code.success && code.data.code === 'P2002') {
          const existing = await this.client.scenarioGeneration.findFirst({
            where: { workspaceId, job: { key: workspaceId + ':scenario:' + requestKey } },
          });
          if (existing) {
            if (existing.requestHash !== input.requestHash)
              throw new ConflictError('Request key reused with different scenario inputs.');
            return existing.id;
          }
        }
        throw error;
      });
    const generation = await this.getGeneration(id);
    if (!generation) throw new Error('Scenario generation was not saved.');
    return generation;
  }

  private generationFromRow(row: Prisma.ScenarioGenerationGetPayload<{ include: { job: true } }>) {
    return generationSchema.parse({
      id: row.id,
      jobId: row.jobId,
      input: row.input,
      output: row.output,
      inputHash: row.inputHash,
      requestHash: row.requestHash,
      promptVersion: row.promptVersion,
      model: row.model,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      status: row.job.status,
      error: row.job.error,
    });
  }

  async getGeneration(id: string) {
    const row = await this.client.scenarioGeneration.findFirst({
      where: { id, workspaceId },
      include: { job: true },
    });
    return row ? this.generationFromRow(row) : null;
  }

  async getGenerationForJob(jobId: string) {
    const row = await this.client.scenarioGeneration.findFirst({
      where: { jobId, workspaceId },
      include: { job: true },
    });
    return row ? this.generationFromRow(row) : null;
  }

  async listGenerations(investorId: string) {
    const rows = await this.client.scenarioGeneration.findMany({
      where: { workspaceId, investorId },
      include: { job: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => this.generationFromRow(row));
  }

  async completeGeneration(job: ClaimedJob, output: ScenarioOutput): Promise<void> {
    const parsed = scenarioOutputSchema.parse(output);
    await this.client.$transaction(async (tx) => {
      const lock = await tx.workflowJob.updateMany({
        where: {
          id: job.id,
          workspaceId,
          status: 'running',
          leaseToken: job.leaseToken,
          leaseUntil: { gt: new Date() },
        },
        data: {
          status: 'succeeded',
          result: 'Practice scenarios saved.',
          error: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (lock.count !== 1)
        throw new ConflictError('Scenario lease no longer belongs to this worker.');
      const saved = await tx.scenarioGeneration.updateMany({
        where: { workspaceId, jobId: job.id },
        data: { output: json(parsed) },
      });
      if (saved.count !== 1) throw new Error('Scenario generation unavailable.');
    });
  }
}
