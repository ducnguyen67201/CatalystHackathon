import { radarEvidence } from './fixtures/RadarFixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { workspaceSchema, type Workspace } from '../src/contracts/Workspace.js';
import {
  radarCategories,
  type EmailMessage,
  type WorkerHeartbeat,
} from '../src/contracts/RadarDelivery.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { ConflictError, type WorkspaceStore } from '../src/features/WorkspaceStore.js';
import { EmailSendError, type EmailSender } from '../src/features/EmailSender.js';
import { publishRadarResult } from '../src/features/RadarResults.js';
import { ResendEmailSender } from '../src/infrastructure/EmailNotifications.js';

const now = () => new Date().toISOString();
async function fixture() {
  let state: Workspace | null = null;
  let heartbeat: WorkerHeartbeat | null = null;
  const store: WorkspaceStore = {
    load: () => Promise.resolve(state ? workspaceSchema.parse(structuredClone(state)) : null),
    initialize: (value) => {
      state = workspaceSchema.parse(value);
      return Promise.resolve();
    },
    save: (value, revision) => {
      if (state?.revision !== revision) return Promise.reject(new ConflictError());
      state = workspaceSchema.parse({ ...structuredClone(value), revision: revision + 1 });
      return Promise.resolve();
    },
    enqueue: vi.fn(),
    listJobs: () => Promise.resolve([]),
    claimJob: () => Promise.resolve(null),
    finishJob: () => Promise.resolve(),
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
    recordHeartbeat: (value) => {
      heartbeat = structuredClone(value);
      return Promise.resolve();
    },
    readHeartbeat: () => Promise.resolve(heartbeat),
  };
  const evidence = radarEvidence();
  const research = { discover: vi.fn().mockResolvedValue([evidence]) };
  const service = new WorkspaceService(store, research);
  await service.initialize(readFileSync('fixtures/Tidewell.csv', 'utf8'));
  const investor = await service.investors.add({
    name: 'Fictional Northline',
    url: 'https://example.com/team',
    frequency: 'paused',
  });
  const send = vi.fn<EmailSender['send']>().mockResolvedValue('fake-receipt');
  service.radar.configure({ send }, 'alerts@example.com', 'http://127.0.0.1:4317');
  return { service, store, investor, evidence, research, send };
}
async function enable(service: WorkspaceService) {
  await service.change((state) => {
    state.radar.preferences.recipient = 'founder@example.com';
    state.radar.preferences.recipientRevision = 1;
    state.radar.preferences.enabled = true;
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('radar publication and founder delivery', () => {
  it('commits the check, one cited event and outbox together; repeated evidence and page noise do not alert twice', async () => {
    const { service, investor, evidence, research } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'job-one');
    await service.investors.check(investor.id, 'job-one');
    research.discover.mockResolvedValue([
      { ...evidence, id: 'new-version', eventKey: 'new-version' },
    ]);
    await service.investors.check(investor.id, 'job-two');
    const state = await service.read();
    expect(state.radar.events).toHaveLength(1);
    expect(state.radar.deliveries).toHaveLength(1);
    expect(state.investors[0]?.checks).toHaveLength(2);
    expect(state.radar.events[0]?.researchRunId).toBe(evidence.researchRunId);
  });
  it('does not publish when commit fails or the profile changes during research', async () => {
    const { service, investor, store, research, evidence } = await fixture();
    await enable(service);
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.investors.check(investor.id, 'failed')).rejects.toThrow();
    expect((await service.read()).radar.events).toEqual([]);
    research.discover.mockImplementation(async () => {
      await service.change((s) => {
        s.profile.version++;
      });
      return [evidence];
    });
    await expect(service.investors.check(investor.id, 'stale')).rejects.toThrow('Profile changed');
    expect((await service.read()).radar.events).toEqual([]);
  });
  it('leaves raw, unclassified, review-needed and fictional results out of email', async () => {
    const { service, investor, research, evidence } = await fixture();
    await enable(service);
    research.discover.mockResolvedValue([{ ...evidence, signal: null }]);
    await service.investors.check(investor.id, 'raw');
    expect((await service.read()).radar.events).toEqual([]);
    research.discover.mockResolvedValue([
      {
        ...evidence,
        id: 'review',
        eventKey: 'review',
        signal: { ...evidence.signal, needsReview: true },
      },
    ]);
    await service.investors.check(investor.id, 'review');
    expect((await service.read()).radar.events).toHaveLength(1);
    expect((await service.read()).radar.deliveries).toEqual([]);
  });
  it('confirms address possession, never exposes the code, and keeps alerts off until enabled', async () => {
    const { service, send } = await fixture();
    await service.radar.requestConfirmation('founder@example.com');
    const prefs = await service.radar.preferences();
    expect(JSON.stringify(prefs)).not.toContain('hash');
    expect(prefs.confirmationPending).toBe(true);
    await service.radar.deliverOne();
    const code = send.mock.calls[0]?.[0].text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    await expect(service.radar.confirm('000000')).rejects.toThrow();
    await service.radar.confirm(code ?? '');
    expect((await service.radar.preferences()).enabled).toBe(false);
    await service.radar.updatePreferences({ enabled: true, categories: [...radarCategories] });
    expect((await service.radar.preferences()).enabled).toBe(true);
  });
  it('limits confirmation guesses and invalidates earlier addresses', async () => {
    const { service } = await fixture();
    await service.radar.requestConfirmation('old@example.com');
    for (let i = 0; i < 5; i++) await expect(service.radar.confirm('000000')).rejects.toThrow();
    expect((await service.read()).radar.preferences.challenge?.attempts).toBe(5);
    await service.change((s) => {
      if (s.radar.preferences.challenge)
        s.radar.preferences.challenge.requestedAt = new Date(Date.now() - 61000).toISOString();
    });
    await service.radar.requestConfirmation('new@example.com');
    expect((await service.read()).radar.deliveries[0]?.status).toBe('skipped');
  });
  it('does not email backfilled history or enqueue old updates when enabled', async () => {
    const { service, investor } = await fixture();
    await service.investors.check(investor.id, 'email-off');
    await enable(service);
    await service.radar.backfill();
    expect((await service.read()).radar.deliveries).toEqual([]);
    const { evidence } = await fixture();
    await service.change((s) => {
      const e = { ...evidence, id: 'history', eventKey: 'history', url: 'https://example.com/old' };
      s.evidence.push(e);
      publishRadarResult(s, e, { investorId: investor.id, suggestionId: null }, 'old', true);
    });
    expect((await service.read()).radar.deliveries).toEqual([]);
  });
  it('recovers expired leases with the identical provider request and idempotency key', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'check');
    send.mockRejectedValueOnce(new EmailSendError('uncertain')).mockResolvedValue('receipt');
    await service.radar.deliverOne();
    const first = send.mock.calls[0];
    await service.change((s) => {
      const d = s.radar.deliveries[0];
      if (d) {
        d.status = 'sending';
        d.leaseToken = randomUUID();
        d.leaseUntil = new Date(Date.now() - 1).toISOString();
      }
    });
    await service.radar.deliverOne();
    expect(send.mock.calls[1]).toEqual(first);
    expect((await service.read()).radar.deliveries[0]?.status).toBe('sent');
    expect(first?.[0].text).not.toContain('raiseTarget');
    expect(first?.[0].text).toContain('?radarEvent=');
  });
  it('recovers when provider acceptance succeeds but saving the receipt fails', async () => {
    const { service, investor, send, store } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'receipt-crash');
    send.mockImplementationOnce(() => {
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('receipt write failed'));
      return Promise.resolve('accepted-receipt');
    });
    await service.radar.deliverOne();
    expect((await service.read()).radar.deliveries[0]?.status).toBe('retry_wait');
    await service.change((s) => {
      const d = s.radar.deliveries[0];
      if (d) d.nextAt = new Date(Date.now() - 1).toISOString();
    });
    await service.radar.deliverOne();
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect((await service.read()).radar.deliveries[0]?.status).toBe('sent');
  });
  it('caps retries and leaves an in-app failure notice', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'retry-cap');
    send.mockRejectedValue(new EmailSendError('transient', 120000));
    for (let i = 0; i < 5; i++) {
      await service.radar.deliverOne();
      if (i === 0)
        expect(
          Date.parse((await service.read()).radar.deliveries[0]?.nextAt ?? '') - Date.now(),
        ).toBeGreaterThan(119000);
      await service.change((s) => {
        const d = s.radar.deliveries[0];
        if (d) d.nextAt = new Date(Date.now() - 1).toISOString();
      });
    }
    const state = await service.read();
    expect(state.radar.deliveries[0]?.status).toBe('failed');
    expect(state.radar.deliveries[0]?.attempts).toBe(5);
    expect(state.notices.at(-1)?.title).toBe('Investor alert email needs attention');
    await service.radar.deliverOne();
    expect(send).toHaveBeenCalledTimes(5);
  });
  it('does not double claim a delivery under concurrent workers', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'check');
    await Promise.all([service.radar.deliverOne(), service.radar.deliverOne()]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('stops retries outside the provider replay window and rejects manual unknown retries', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'check');
    await service.change((s) => {
      const d = s.radar.deliveries[0];
      if (d) {
        d.status = 'retry_wait';
        d.firstAttemptAt = new Date(Date.now() - 24 * 3600000).toISOString();
      }
    });
    await service.radar.deliverOne();
    expect(send).not.toHaveBeenCalled();
    const delivery = (await service.read()).radar.deliveries[0];
    expect(delivery?.status).toBe('unknown');
    await expect(service.radar.retry(delivery?.id ?? '')).rejects.toThrow('Unknown outcomes');
  });
  it.each(['disabled', 'stale', 'dismissed', 'recipient'] as const)(
    'suppresses pending emails after %s change',
    async (reason) => {
      const { service, investor, send } = await fixture();
      await enable(service);
      await service.investors.check(investor.id, 'check');
      await service.change((s) => {
        if (reason === 'disabled') s.radar.preferences.enabled = false;
        if (reason === 'stale') s.profile.version++;
        if (reason === 'recipient') s.radar.preferences.recipientRevision++;
        if (reason === 'dismissed' && s.radar.events[0]) s.radar.events[0].dismissedAt = now();
      });
      await service.radar.deliverOne();
      expect(send).not.toHaveBeenCalled();
      expect((await service.read()).radar.deliveries[0]?.status).toBe('skipped');
    },
  );
  it('preserves corrections and suppresses superseded pending alerts', async () => {
    const { service, investor, evidence, research, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'first');
    research.discover.mockResolvedValue([
      {
        ...evidence,
        id: 'correction',
        eventKey: 'correction',
        supersedesEvidenceId: evidence.id,
        signal: { ...evidence.signal, supportingQuote: 'Corrected fictional passage.' },
      },
    ]);
    await service.investors.check(investor.id, 'correction');
    await service.radar.deliverOne();
    const state = await service.read();
    expect(state.radar.events).toHaveLength(2);
    expect(state.radar.events[1]?.supersedesEventId).toBe(state.radar.events[0]?.id);
    expect(state.radar.deliveries[0]?.status).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps uncertain delivery outcomes visible if preferences change before retry', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'uncertain');
    send.mockRejectedValueOnce(new EmailSendError('uncertain'));
    await service.radar.deliverOne();
    await service.radar.updatePreferences({ enabled: false, categories: [...radarCategories] });
    expect((await service.read()).radar.deliveries[0]?.status).toBe('unknown');
  });
  it('ignores a late sender receipt after a newer lease took ownership', async () => {
    const { service, investor, send } = await fixture();
    await enable(service);
    await service.investors.check(investor.id, 'lease');
    send.mockImplementation(async () => {
      await service.change((s) => {
        const d = s.radar.deliveries[0];
        if (d) d.leaseToken = randomUUID();
      });
      return 'late-receipt';
    });
    await service.radar.deliverOne();
    expect((await service.read()).radar.deliveries[0]?.providerMessageId).toBeNull();
  });
  it('publishes discovery candidates without auto-tracking, and keeps their events after tracking', async () => {
    const { service, evidence, research } = await fixture();
    await enable(service);
    research.discover.mockResolvedValue([
      {
        ...evidence,
        investor: 'Fictional New Fund',
        comparableDeal: {
          company: 'Fictional ExampleCo',
          stage: 'Seed',
          sector: 'B2B software',
          geography: 'Canada',
          announcedAt: null,
          roundTotal: null,
          participationQuote: 'Fictional participation.',
          comparisonQuote: 'Fictional software company.',
        },
      },
    ]);
    await service.investors.discover('candidate');
    const first = await service.read();
    const candidate = first.discovery.suggestions[0];
    expect(candidate).toBeDefined();
    expect(first.radar.events[0]?.signal.category).toBe('new_candidate');
    expect(first.investors).toHaveLength(1);
    await service.investors.discovery.decide(candidate?.id ?? '', 'tracked');
    const after = await service.read();
    expect(after.radar.events).toHaveLength(1);
    expect(after.radar.events[0]?.investorId).not.toBeNull();
    expect(after.radar.deliveries).toHaveLength(1);
  });
  it('paginates and marks read without invoking research or sending', async () => {
    const { service, investor, research, send } = await fixture();
    await service.investors.check(investor.id, 'one');
    research.discover.mockClear();
    const feed = await service.radar.feed({ limit: 20 });
    expect(feed.items).toHaveLength(1);
    await service.radar.markRead(feed.items[0]?.id ?? '', true);
    expect((await service.radar.feed({ limit: 20, unread: 'true' })).items).toEqual([]);
    expect(research.discover).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('shows offline for stale heartbeats, checking for active work', async () => {
    const { service, store } = await fixture();
    expect((await service.radar.status()).state).toBe('offline');
    await service.radar.heartbeat('checking', 'job');
    expect((await service.radar.status()).state).toBe('checking');
    await store.recordHeartbeat?.({
      at: new Date(Date.now() - 61000).toISOString(),
      state: 'waiting',
      jobId: null,
      lastCompletedAt: null,
    });
    expect((await service.radar.status()).state).toBe('offline');
  });
});
describe('Resend adapter', () => {
  const message: EmailMessage = {
    from: 'alerts@example.com',
    to: 'founder@example.com',
    subject: 'Fictional test',
    text: 'Fictional test only.',
  };
  it('sends a plain-text snapshot with a stable idempotency header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'receipt' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await new ResendEmailSender('test-key').send(message, 'delivery-key')).toBe('receipt');
    const options = fetcher.mock.calls[0]?.[1];
    expect(options?.headers).toMatchObject({ 'Idempotency-Key': 'delivery-key' });
    expect(options?.body).toBe(JSON.stringify({ ...message, to: [message.to] }));
  });
  it('honors throttling and treats transport failures as uncertain', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
      .mockRejectedValueOnce(new Error('PRIVATE PROVIDER BODY'));
    vi.stubGlobal('fetch', fetcher);
    const sender = new ResendEmailSender('key');
    await expect(sender.send(message, 'key')).rejects.toMatchObject({
      kind: 'transient',
      retryAfterMs: 120000,
    });
    await expect(sender.send(message, 'key')).rejects.toMatchObject({
      kind: 'uncertain',
      message: 'Email uncertain failure.',
    });
  });
});
