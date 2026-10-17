import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  peerDashboardSchema,
  peerInputSchema,
  peerRecordSchema,
} from '../contracts/PeerComparison.js';
import { buildPeerComparison, currentPeers } from '../features/PeerComparison.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import { ConflictError } from '../features/WorkspaceStore.js';

export function registerPeerRoutes(app: FastifyInstance, service: WorkspaceService) {
  app.get('/api/peers', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const state = await service.read();
    const snapshot =
      state.snapshots.find((item) => item.id === state.onboarding.snapshotId) ??
      state.snapshots.at(-1);
    return peerDashboardSchema.parse({
      peers: currentPeers(state.peers ?? []),
      comparison: buildPeerComparison(snapshot, state.peers ?? [], state.profile.version),
    });
  });
  app.post('/api/peers', async (request) => {
    const { expectedVersion, ...input } = peerInputSchema.parse(request.body);
    await service.change((state) => {
      const history = state.peers ?? [];
      const version = Math.max(
        0,
        ...history.filter((peer) => peer.peerId === input.peerId).map((peer) => peer.version),
      );
      if (version !== expectedVersion)
        throw new ConflictError('Peer evidence changed. Reload before saving.');
      if (
        currentPeers(history).length >= 20 &&
        !currentPeers(history).some((peer) => peer.peerId === input.peerId)
      )
        throw new z.ZodError([
          {
            code: 'custom',
            path: [],
            message: 'Archive a peer before adding another (maximum 20).',
          },
        ]);
      state.peers = [
        ...history,
        peerRecordSchema.parse({
          ...input,
          id: randomUUID(),
          version: version + 1,
          recordedAt: new Date().toISOString(),
          archived: false,
        }),
      ];
    });
    return { ok: true };
  });
  app.post('/api/peers/:id/archive', async (request) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    const { expectedVersion } = z
      .strictObject({ expectedVersion: z.int().positive() })
      .parse(request.body);
    await service.change((state) => {
      const peer = currentPeers(state.peers ?? []).find((item) => item.peerId === id);
      if (!peer || peer.version !== expectedVersion)
        throw new ConflictError('Peer evidence changed. Reload before archiving.');
      state.peers = [
        ...(state.peers ?? []),
        {
          ...peer,
          id: randomUUID(),
          version: peer.version + 1,
          recordedAt: new Date().toISOString(),
          archived: true,
        },
      ];
    });
    return { ok: true };
  });
}
