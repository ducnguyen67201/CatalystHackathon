import { isDeepStrictEqual } from 'node:util';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  goalJourneySchema,
  goalProgressEventSchema,
  goalProgressPageSchema,
  type GoalJourney,
  type GoalProgressQuery,
} from '../contracts/GoalJourney.js';
import type { Workspace } from '../contracts/Workspace.js';
import { ConflictError, UnavailableError } from '../features/WorkspaceStore.js';

const json = (value: unknown): Prisma.InputJsonObject =>
  z.record(z.string(), z.json()).parse(value);
type JourneyClient = Pick<PrismaClient, 'goalJourney' | 'goalProgressEvent'>;

/** Preparation content stays in its aggregate; growing journey records use focused tables. */
export function preparationForStorage(preparation: Workspace['preparation']) {
  if (!preparation) return {};
  const content = { ...preparation };
  delete content.journey;
  delete content.journeyHistory;
  return content;
}

export async function loadCurrentGoalJourney(client: JourneyClient, workspaceId: string) {
  const row = await client.goalJourney.findFirst({
    where: { workspaceId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      targets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      assessments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      scopes: { orderBy: { version: 'asc' } },
      events: { orderBy: { sequence: 'desc' }, take: 100 },
    },
  });
  if (!row) return null;
  return goalJourneySchema.parse({
    ...z.record(z.string(), z.json()).parse(row.payload),
    targets: row.targets.map((r) => r.payload),
    assessments: row.assessments.map((r) => r.payload),
    scopes: row.scopes.map((r) => r.payload),
    events: row.events.reverse().map((r) => r.payload),
  });
}

export async function loadArchivedGoalJourneys(client: JourneyClient, workspaceId: string) {
  const rows = await client.goalJourney.findMany({
    where: { workspaceId, status: 'archived' },
    orderBy: { createdAt: 'asc' },
    include: {
      targets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      assessments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      scopes: { orderBy: { version: 'asc' } },
      events: { orderBy: { sequence: 'desc' }, take: 1 },
    },
  });
  return rows.map((row) =>
    goalJourneySchema.parse({
      ...z.record(z.string(), z.json()).parse(row.payload),
      targets: row.targets.map((r) => r.payload),
      assessments: row.assessments.map((r) => r.payload),
      scopes: row.scopes.map((r) => r.payload),
      events: row.events.map((r) => r.payload),
    }),
  );
}

function immutable(saved: unknown, proposed: unknown) {
  if (!isDeepStrictEqual(saved, proposed))
    throw new ConflictError('Historical journey record cannot be replaced.');
}

export async function saveGoalJourneys(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  preparation: Workspace['preparation'],
) {
  const journeys = [
    ...(preparation?.journeyHistory ?? []),
    ...(preparation?.journey ? [preparation.journey] : []),
  ];
  for (const journey of journeys) {
    const header = { ...journey, targets: [], assessments: [], scopes: [], events: [] };
    await tx.goalJourney.upsert({
      where: { id: journey.id },
      update: { status: journey.status, payload: json(header) },
      create: {
        id: journey.id,
        workspaceId,
        status: journey.status,
        payload: json(header),
        createdAt: new Date(journey.createdAt),
      },
    });
    for (const target of journey.targets) {
      await tx.goalInvestorTarget.upsert({
        where: { id: target.id },
        update: { payload: json(target) },
        create: {
          id: target.id,
          workspaceId,
          journeyId: journey.id,
          investorId: target.investorId,
          payload: json(target),
          createdAt: new Date(target.createdAt),
        },
      });
    }
    for (const assessment of journey.assessments) {
      const payload = json(assessment);
      const row = await tx.investorMatchAssessment.upsert({
        where: { id: assessment.id },
        update: {},
        create: {
          id: assessment.id,
          workspaceId,
          journeyId: journey.id,
          investorId: assessment.investorId,
          payload,
          createdAt: new Date(assessment.assessment.assessedAt),
        },
      });
      immutable(row.payload, payload);
    }
    for (const scope of journey.scopes) {
      const payload = json(scope);
      const row = await tx.goalPreparationScope.upsert({
        where: { id: scope.id },
        update: {},
        create: {
          id: scope.id,
          workspaceId,
          journeyId: journey.id,
          version: scope.version,
          payload,
          createdAt: new Date(scope.createdAt),
        },
      });
      immutable(row.payload, payload);
    }
    for (const event of journey.events) {
      const payload = json(event);
      const row = await tx.goalProgressEvent.upsert({
        where: { id: event.id },
        update: {},
        create: {
          id: event.id,
          workspaceId,
          journeyId: journey.id,
          sequence: event.sequence,
          fingerprint: event.fingerprint,
          targetIds: event.position.tracks.map((t) => t.targetId),
          payload,
          recordedAt: new Date(event.recordedAt),
        },
      });
      immutable(row.payload, payload);
    }
  }
}

export async function listGoalProgress(
  client: JourneyClient,
  workspaceId: string,
  journeyId: string,
  query: GoalProgressQuery,
) {
  const journey = await client.goalJourney.findFirst({ where: { id: journeyId, workspaceId } });
  if (!journey) throw new UnavailableError('Goal history unavailable.');
  const latest = await client.goalProgressEvent.findFirst({
    where: { journeyId, workspaceId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  const boundary = query.beforeSequence ?? latest?.sequence ?? 0;
  const rows = await client.goalProgressEvent.findMany({
    where: {
      workspaceId,
      journeyId,
      sequence: { lte: boundary, ...(query.cursor ? { lt: query.cursor } : {}) },
      ...(query.targetId ? { targetIds: { has: query.targetId } } : {}),
      ...(query.from || query.to
        ? {
            recordedAt: {
              ...(query.from ? { gte: new Date(query.from + 'T00:00:00Z') } : {}),
              ...(query.to ? { lt: new Date(Date.parse(query.to + 'T00:00:00Z') + 86400000) } : {}),
            },
          }
        : {}),
    },
    orderBy: { sequence: 'desc' },
    take: query.limit + 1,
  });
  return goalProgressPageSchema.parse({
    items: rows.slice(0, query.limit).map((r) => r.payload),
    nextCursor: rows.length > query.limit ? (rows[query.limit - 1]?.sequence ?? null) : null,
    beforeSequence: boundary,
  });
}

export async function findGoalProgress(
  client: JourneyClient,
  workspaceId: string,
  journeyId: string,
  eventId: string,
) {
  const row = await client.goalProgressEvent.findFirst({
    where: { id: eventId, journeyId, workspaceId },
  });
  return row ? goalProgressEventSchema.parse(row.payload) : null;
}

export function journeyHeader(journey: GoalJourney) {
  return { ...journey, targets: [], assessments: [], scopes: [], events: [] };
}
