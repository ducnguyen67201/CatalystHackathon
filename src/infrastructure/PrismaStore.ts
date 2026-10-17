import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
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
export class PrismaStore implements WorkspaceStore {
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
    const active = kind.startsWith('investor:')
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
          if (kind.startsWith('investor:') && code.success && code.data.code === 'P2002') {
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
  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
