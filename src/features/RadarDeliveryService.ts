import { radarInvestorGroups } from './RadarInvestorGroups.js';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  publicDeliverySchema,
  publicPreferencesSchema,
  radarFeedSchema,
  radarItemSchema,
  radarQuerySchema,
  radarStatusSchema,
  updatePreferencesSchema,
  type RadarEvent,
  type Delivery,
  type EmailMessage,
  type WorkerHeartbeat,
} from '../contracts/RadarDelivery.js';
import type { WorkspaceService } from './WorkspaceService.js';
import type { Workspace } from '../contracts/Workspace.js';
import { EmailSendError, type EmailSender } from './EmailSender.js';
import { pendingDelivery, publishRadarResult, suppressionReason } from './RadarResults.js';

const replayWindowMs = 23 * 3600000;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const mask = (email: string | null) =>
  email ? `${email.slice(0, 1)}***@${email.split('@')[1] ?? ''}` : null;
export class RadarDeliveryService {
  private sender: EmailSender | null = null;
  private from: string | null = null;
  private heartbeatValue: WorkerHeartbeat | null = null;
  async heartbeat(
    state?: WorkerHeartbeat['state'],
    jobId: string | null = null,
    completed = false,
  ): Promise<void> {
    this.heartbeatValue ??= (await this.service.store.readHeartbeat?.()) ?? {
      at: new Date().toISOString(),
      jobId: null,
      state: 'waiting',
      lastCompletedAt: null,
    };
    this.heartbeatValue.at = new Date().toISOString();
    if (state) {
      this.heartbeatValue.state = state;
      this.heartbeatValue.jobId = jobId;
    }
    if (completed) this.heartbeatValue.lastCompletedAt = this.heartbeatValue.at;
    await this.service.store.recordHeartbeat?.(this.heartbeatValue);
  }
  private origin = 'http://127.0.0.1:4317';
  constructor(private readonly service: WorkspaceService) {}
  configure(sender: EmailSender, from: string, origin: string): void {
    this.sender = sender;
    this.from = z.email().parse(from);
    this.origin = origin;
  }
  get ready(): boolean {
    return Boolean(this.sender && this.from);
  }
  async preferences() {
    const { preferences: p, deliveries } = (await this.service.read()).radar;
    const confirmation = deliveries.find((item) => item.id === p.challenge?.deliveryId);
    return publicPreferencesSchema.parse({
      enabled: p.enabled,
      recipient: mask(p.recipient),
      categories: p.categories,
      ready: this.ready,
      confirmationPending: Boolean(p.challenge && Date.parse(p.challenge.expiresAt) > Date.now()),
      confirmationDelivery: confirmation
        ? publicDeliverySchema.parse(
            Object.fromEntries(
              Object.entries(confirmation).filter(([key]) =>
                ['id', 'status', 'attempts', 'nextAt', 'acceptedAt', 'error'].includes(key),
              ),
            ),
          )
        : null,
    });
  }
  async updatePreferences(input: z.infer<typeof updatePreferencesSchema>): Promise<void> {
    const parsed = updatePreferencesSchema.parse(input);
    await this.service.change((state) => {
      if (parsed.enabled && (!state.radar.preferences.recipient || !this.ready))
        throw new Error('Radar: configure email and confirm your address first.');
      state.radar.preferences.enabled = parsed.enabled;
      state.radar.preferences.categories = [...new Set(parsed.categories)];
      this.suppressPending(state);
    });
  }
  async requestConfirmation(recipient: string): Promise<void> {
    const address = z.email().max(254).parse(recipient.trim());
    const from = this.from;
    if (!this.ready || !from)
      throw new Error(
        'Radar: configure RESEND_API_KEY and NOTIFICATION_FROM before confirming an address.',
      );
    const code = String(randomInt(100000, 1000000));
    await this.service.change((state) => {
      const now = Date.now();
      const p = state.radar.preferences;
      if (p.challenge && now - Date.parse(p.challenge.requestedAt) < 60000)
        throw new Error('Radar: wait one minute before requesting another code.');
      p.enabled = false;
      p.recipient = null;
      p.recipientRevision++;
      const delivery = pendingDelivery(null, p.recipientRevision, new Date(now).toISOString());
      delivery.message = {
        from,
        to: address,
        subject: 'Confirm your June investor alerts address',
        text: `Your June confirmation code is ${code}. It expires in 15 minutes. Enter it in your local June workspace. This confirms your address; alerts remain off until you enable them. If you did not request this, ignore this email.`,
      };
      p.challenge = {
        recipient: address,
        hash: hash(code),
        expiresAt: new Date(now + 900000).toISOString(),
        requestedAt: new Date(now).toISOString(),
        attempts: 0,
        deliveryId: delivery.id,
      };
      state.radar.deliveries.push(delivery);
      this.suppressPending(state);
    });
  }
  async confirm(code: string): Promise<void> {
    z.string()
      .regex(/^\d{6}$/)
      .parse(code);
    const accepted = await this.service.change((state) => {
      const p = state.radar.preferences;
      const c = p.challenge;
      if (!c || c.attempts >= 5 || Date.parse(c.expiresAt) <= Date.now()) return false;
      c.attempts++;
      if (!timingSafeEqual(Buffer.from(c.hash, 'hex'), Buffer.from(hash(code), 'hex')))
        return false;
      p.recipient = c.recipient;
      p.challenge = null;
      this.suppressPending(state);
      return true;
    });
    if (!accepted)
      throw new Error('Radar: invalid or expired code. Request a new code after five attempts.');
  }
  private reason(state: Workspace, delivery: Delivery): string | null {
    if (delivery.recipientRevision !== state.radar.preferences.recipientRevision)
      return 'Recipient changed.';
    if (delivery.kind === 'confirmation') {
      const challenge = state.radar.preferences.challenge;
      return challenge?.deliveryId === delivery.id &&
        Date.parse(challenge.expiresAt) > Date.now() &&
        challenge.attempts < 5
        ? null
        : 'Confirmation expired or replaced.';
    }
    const event = state.radar.events.find((item) => item.id === delivery.eventId);
    return event ? suppressionReason(state, event) : 'Update unavailable.';
  }
  private suppressPending(state: Workspace): void {
    for (const delivery of state.radar.deliveries) {
      if (!['pending', 'retry_wait'].includes(delivery.status)) continue;
      const reason = this.reason(state, delivery);
      if (reason) {
        delivery.status = delivery.uncertain ? 'unknown' : 'skipped';
        delivery.error = reason;
      }
    }
  }
  private message(state: Workspace, event: RadarEvent): EmailMessage {
    const evidence = state.evidence.find((item) => item.id === event.evidenceId);
    const recipient = state.radar.preferences.recipient;
    if (!recipient || !this.from || !evidence) throw new Error('Radar: email context unavailable.');
    const deepLink = `${this.origin}/?radarEvent=${encodeURIComponent(event.id)}`;
    return {
      from: this.from,
      to: recipient,
      subject: `June: ${event.signal.headline}`,
      text: `${event.investorName}\n\n${event.signal.summary}\n\nWhy it matters\n${event.signal.whyItMatters}\n\nUnverified public-source claim. Review the source before acting.\nPublished: ${event.occurredAt ?? 'Unknown'}\nObserved: ${event.observedAt}\nSource: ${evidence.url ?? ''}\n\nOpen this update on the computer running June:\n${deepLink}\n\nManage email alerts in Investor Radar. No financial records or meeting notes are included.`,
    };
  }
  async deliverOne(): Promise<boolean> {
    const sender = this.sender;
    if (!sender || !this.from) return false;
    const existing = await this.service.read();
    if (
      !existing.radar.deliveries.some(
        (d) =>
          ((d.status === 'pending' || d.status === 'retry_wait') &&
            Date.parse(d.nextAt) <= Date.now()) ||
          (d.status === 'sending' && d.leaseUntil && Date.parse(d.leaseUntil) <= Date.now()),
      )
    )
      return false;
    const claimed = await this.service.change((state) => {
      const now = Date.now();
      this.suppressPending(state);
      // An expired sending lease may have reached the provider. Keep the original key/body.
      const item = state.radar.deliveries.find(
        (d) =>
          ((d.status === 'pending' || d.status === 'retry_wait') && Date.parse(d.nextAt) <= now) ||
          (d.status === 'sending' && d.leaseUntil && Date.parse(d.leaseUntil) <= now),
      );
      if (!item) return null;
      if (item.status === 'sending') item.uncertain = true;
      if (item.firstAttemptAt && now - Date.parse(item.firstAttemptAt) >= replayWindowMs) {
        item.status = 'unknown';
        item.error = 'Provider replay window expired. Reconcile in Resend; no automatic resend.';
        return null;
      }
      const reason = this.reason(state, item);
      if (reason) {
        item.status = item.uncertain ? 'unknown' : 'skipped';
        item.error = reason;
        return null;
      }
      if (item.attempts >= 5) {
        item.status = item.status === 'sending' ? 'unknown' : 'failed';
        item.error = 'Email retry limit reached.';
        return null;
      }
      if (!item.message) {
        const event = state.radar.events.find((e) => e.id === item.eventId);
        if (!event) {
          item.status = 'failed';
          item.error = 'Update unavailable.';
          return null;
        }
        item.message = this.message(state, event);
      }
      item.status = 'sending';
      item.attempts++;
      item.firstAttemptAt ??= new Date(now).toISOString();
      item.leaseToken = randomUUID();
      item.leaseUntil = new Date(now + 60000).toISOString();
      return structuredClone(item);
    });
    if (!claimed?.message) return false;
    // Eligibility may have changed after claiming. Already accepted requests cannot be recalled.
    const current = await this.service.read();
    const reason = this.reason(current, claimed);
    if (reason) {
      await this.finish(claimed, claimed.uncertain ? 'unknown' : 'skipped', null, reason);
      return true;
    }
    try {
      const receipt = await sender.send(claimed.message, `june/${claimed.id}`);
      await this.finish(claimed, 'sent', receipt, null);
    } catch (error) {
      const failure = error instanceof EmailSendError ? error : new EmailSendError('uncertain');
      const terminal = failure.kind === 'permanent' || claimed.attempts >= 5;
      await this.service.change((state) => {
        const item = state.radar.deliveries.find((d) => d.id === claimed.id);
        if (item?.status !== 'sending' || item.leaseToken !== claimed.leaseToken) return;
        item.uncertain ||= failure.kind === 'uncertain';
        item.status = terminal ? (item.uncertain ? 'unknown' : 'failed') : 'retry_wait';
        item.error =
          failure.kind === 'permanent'
            ? 'Provider rejected this email. Check sender/address configuration.'
            : terminal
              ? 'Delivery outcome needs review in Resend.'
              : 'Temporary email failure; retry scheduled.';
        const delay = Math.max(
          failure.retryAfterMs,
          Math.min(3600000, 60000 * 2 ** (item.attempts - 1)) + randomInt(0, 10001),
        );
        item.nextAt = new Date(Date.now() + delay).toISOString();
        item.leaseToken = null;
        item.leaseUntil = null;
        if (terminal)
          state.notices.push({
            id: randomUUID(),
            title: 'Investor alert email needs attention',
            message: item.error,
            createdAt: new Date().toISOString(),
            read: false,
          });
      });
    }
    return true;
  }
  private async finish(
    claimed: Delivery,
    status: 'sent' | 'skipped' | 'unknown',
    receipt: string | null,
    error: string | null,
  ): Promise<void> {
    await this.service.change((state) => {
      const item = state.radar.deliveries.find((d) => d.id === claimed.id);
      if (item?.status !== 'sending' || item.leaseToken !== claimed.leaseToken) return;
      item.status = status;
      item.providerMessageId = receipt;
      item.error = error;
      item.acceptedAt = status === 'sent' ? new Date().toISOString() : null;
      item.leaseToken = null;
      item.leaseUntil = null;
    });
  }
  async retry(id: string): Promise<void> {
    await this.service.change((state) => {
      const item = state.radar.deliveries.find((d) => d.id === id);
      if (!item || item.status !== 'failed')
        throw new Error(
          'Radar: only a failed delivery can be retried. Unknown outcomes require provider reconciliation.',
        );
      const reason = this.reason(state, item);
      if (reason) throw new Error(`Radar: ${reason}`);
      if (
        !this.ready ||
        !item.firstAttemptAt ||
        Date.now() - Date.parse(item.firstAttemptAt) >= replayWindowMs
      )
        throw new Error(
          'Radar: configure email and reconcile the provider outcome before retrying outside the replay window.',
        );
      item.status = 'retry_wait';
      item.attempts = 0;
      item.nextAt = new Date().toISOString();
      item.error = null;
    });
  }
  async dismiss(id: string): Promise<void> {
    await this.service.change((state) => {
      const event = state.radar.events.find((e) => e.id === id);
      if (!event) throw new Error('Radar: update unavailable.');
      event.dismissedAt = new Date().toISOString();
      this.suppressPending(state);
    });
  }
  async markRead(id: string, read: boolean): Promise<void> {
    await this.service.change((state) => {
      const item = state.radar.events.find((e) => e.id === id);
      if (!item) throw new Error('Radar: update unavailable.');
      item.readAt = read ? new Date().toISOString() : null;
    });
  }
  async backfill(): Promise<void> {
    if ((await this.service.read()).radar.backfilledAt) return;
    await this.service.change((state) => {
      if (state.radar.backfilledAt) return;
      for (const investor of state.investors)
        for (const check of investor.checks)
          for (const id of check.evidenceIds) {
            const evidence = state.evidence.find((e) => e.id === id);
            if (evidence?.signal)
              publishRadarResult(
                state,
                evidence,
                { investorId: investor.id, suggestionId: null },
                check.jobId,
                true,
                check.profileVersion,
              );
          }
      for (const suggestion of state.discovery.suggestions) {
        const evidence = state.evidence.find((e) => e.id === suggestion.evidenceId);
        if (evidence?.signal)
          publishRadarResult(
            state,
            evidence,
            { investorId: null, suggestionId: suggestion.id },
            null,
            true,
            suggestion.profileVersion,
          );
      }
      state.radar.backfilledAt = new Date().toISOString();
    });
  }
  async status() {
    const state = await this.service.read();
    const heartbeat = (await this.service.store.readHeartbeat?.()) ?? null;
    const paused =
      state.investors.every((i) => i.frequency === 'paused') &&
      state.discovery.frequency === 'paused' &&
      state.schedule.frequency === 'paused';
    const next =
      [...state.investors.map((i) => i.nextAt), state.discovery.nextAt, state.schedule.nextAt]
        .filter((d): d is string => d !== null)
        .sort()[0] ?? null;
    return radarStatusSchema.parse({
      state:
        !heartbeat || Date.now() - Date.parse(heartbeat.at) > 60000
          ? 'offline'
          : heartbeat.state === 'waiting' && paused
            ? 'paused'
            : heartbeat.state,
      heartbeatAt: heartbeat?.at ?? null,
      lastCompletedAt: heartbeat?.lastCompletedAt ?? null,
      nextAt: paused ? null : next,
    });
  }
  private item(state: Workspace, event: RadarEvent) {
    const evidence = state.evidence.find((e) => e.id === event.evidenceId);
    const delivery = state.radar.deliveries.find((d) => d.eventId === event.id);
    return radarItemSchema.parse({
      ...event,
      stale: event.profileVersion !== state.profile.version,
      source: {
        url: evidence?.url ?? null,
        title: evidence?.title ?? 'Source unavailable',
        excerpt: evidence?.excerpt ?? '',
      },
      delivery: delivery
        ? {
            id: delivery.id,
            status: delivery.status,
            attempts: delivery.attempts,
            nextAt: delivery.nextAt,
            acceptedAt: delivery.acceptedAt,
            error: delivery.error,
          }
        : null,
    });
  }
  async event(id: string) {
    const state = await this.service.read();
    const event = state.radar.events.find((e) => e.id === id);
    return event ? this.item(state, event) : null;
  }
  async investors() {
    return radarInvestorGroups(await this.service.read());
  }
  async feed(input: z.infer<typeof radarQuerySchema>) {
    const query = radarQuerySchema.parse(input);
    const state = await this.service.read();
    const events = [...state.radar.events]
      .reverse()
      .filter(
        (e) =>
          (!query.investorId || e.investorId === query.investorId) &&
          (!query.suggestionId || e.suggestionId === query.suggestionId) &&
          (!query.category || e.signal.category === query.category) &&
          (query.unread !== 'true' || !e.readAt),
      );
    const offset = query.cursor ? events.findIndex((e) => e.id === query.cursor) + 1 : 0;
    if (query.cursor && offset === 0)
      throw new Error('Radar: page cursor unavailable. Refresh the feed.');
    const items = events.slice(offset, offset + query.limit);
    return radarFeedSchema.parse({
      items: items.map((e) => this.item(state, e)),
      nextCursor: offset + items.length < events.length ? (items.at(-1)?.id ?? null) : null,
      unreadCount: state.radar.events.filter((e) => !e.readAt && !e.dismissedAt).length,
      status: await this.status(),
    });
  }
}
