import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Bell, RefreshCw, Radio, Mail, Check } from 'lucide-react';
import {
  radarCategories,
  radarCategorySchema,
  radarFeedSchema,
  radarItemSchema,
  publicPreferencesSchema,
  type RadarFeed,
  type RadarItem,
} from '../contracts/RadarDelivery.js';
import {
  researchRunListSchema,
  researchRunSchema,
  type ResearchRun,
} from '../contracts/ResearchRun.js';
import type { StateResponse } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { InvestorMatchDialog, TargetInvestors, useGoalJourney } from './GoalJourney.js';
import './RadarUpdates.css';
import { InvestorDiscoveryAction } from './InvestorDiscoveryAction.js';
import { RadarInvestorCard, radarCategoryLabels as labels } from './RadarInvestorCard.js';

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Not available');
type Preferences = z.infer<typeof publicPreferencesSchema>;
const ok = z.object({ ok: z.boolean() });
export function RadarUpdates({
  state,
  onRefresh,
  onEditProfile,
  children,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onEditProfile: () => void;
  children?: ReactNode;
}) {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [category, setCategory] = useState('');
  const [investor, setInvestor] = useState('');
  const [unread, setUnread] = useState(false);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<'updates' | 'sources' | 'targets'>(() =>
    z.uuid().safeParse(new URLSearchParams(window.location.search).get('targetId')).success
      ? 'targets'
      : 'updates',
  );
  const journey = useGoalJourney(state.workspace.revision);
  const [matchItem, setMatchItem] = useState<RadarItem | null>(null);
  const [runs, setRuns] = useState<z.infer<typeof researchRunListSchema> | null>(null);
  const [runOffset, setRunOffset] = useState(0);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [linked, setLinked] = useState<RadarItem | null>(null);
  const deepId = new URLSearchParams(window.location.search).get('radarEvent');
  useEffect(() => {
    let active = true;
    async function load() {
      if (document.hidden) return;
      const query = new URLSearchParams({
        limit: '20',
        ...(category ? { category } : {}),
        ...(investor ? { investorId: investor } : {}),
        ...(unread ? { unread: 'true' } : {}),
        ...(cursor ? { cursor } : {}),
      });
      try {
        const [next, prefs] = await Promise.all([
          request(`/radar/events?${query.toString()}`, radarFeedSchema, undefined, 'GET'),
          request('/notification-preferences', publicPreferencesSchema, undefined, 'GET'),
        ]);
        if (active) {
          setFeed(next);
          setPreferences(prefs);
          setError('');
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load radar.');
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 10000);
    const onVisible = () => {
      void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [category, investor, unread, cursor, refresh]);
  useEffect(() => {
    let active = true;
    if (deepId)
      void request(`/radar/events/${encodeURIComponent(deepId)}`, radarItemSchema, undefined, 'GET')
        .then((item) => {
          if (active) setLinked(item);
        })
        .catch(() => {
          if (active) setError('The linked radar update is unavailable.');
        });
    return () => {
      active = false;
    };
  }, [deepId, refresh]);
  useEffect(() => {
    let active = true;
    if (tab === 'sources') {
      const query = new URLSearchParams({
        limit: '10',
        offset: String(runOffset),
        ...(investor ? { investorId: investor } : {}),
      });
      void request(`/research-runs?${query.toString()}`, researchRunListSchema, undefined, 'GET')
        .then((value) => {
          if (active) setRuns(value);
        })
        .catch((caught: unknown) => {
          if (active)
            setError(caught instanceof Error ? caught.message : 'Unable to load source history.');
        });
    }
    return () => {
      active = false;
    };
  }, [tab, investor, runOffset, refresh]);
  async function act(operation: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setRefresh((v) => v + 1);
      await onRefresh();
      if (success) setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  }
  async function reviewInvestor(item: RadarItem) {
    if (!journey.data?.journey) {
      setMatchItem(item);
      return;
    }
    try {
      const next = await journey.act({ action: 'assess', eventId: item.id });
      const saved =
        next.assessments.findLast(
          (entry) =>
            entry.investorId === item.investorId || entry.evidenceIds.includes(item.evidenceId),
        ) ?? next.assessments.at(-1);
      setMatchItem(saved ? { ...item, investorId: saved.investorId } : item);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to review this investor.');
    }
  }
  function eventCard(item: RadarItem) {
    const match = journey.data?.assessments.findLast(
      (entry) =>
        entry.investorId === item.investorId &&
        entry.goalVersionId === journey.data?.journey?.currentGoalId,
    );
    const target = journey.data?.targets.find((entry) => entry.investorId === item.investorId);
    const matchKind = target?.matchOutdated
      ? 'outdated'
      : match?.assessment.status === 'scored'
        ? 'scored'
        : match?.assessment.status === 'outside_mandate'
          ? 'outside_mandate'
          : 'unverified';
    const matchLabel =
      matchKind === 'outdated'
        ? 'Needs reassessment'
        : matchKind === 'scored' && match
          ? `${match.assessment.score}/10 match`
          : matchKind === 'outside_mandate'
            ? 'Outside stated mandate'
            : 'Needs verification';
    return (
      <RadarInvestorCard
        key={item.id}
        item={item}
        matchLabel={matchLabel}
        matchKind={matchKind}
        savedTarget={!!target}
        reviewing={journey.busy}
        busy={busy}
        onReview={() => void reviewInvestor(item)}
        onToggleRead={() =>
          void act(() =>
            request(`/radar/events/${item.id}/read`, ok, { read: !item.readAt }, 'PATCH'),
          )
        }
        onDismiss={() => void act(() => request(`/radar/events/${item.id}/dismiss`, ok, {}))}
        onRetryEmail={() =>
          void act(() =>
            request(`/notification-deliveries/${item.delivery?.id ?? ''}/retry`, ok, {}),
          )
        }
      />
    );
  }
  return (
    <section className="radar-updates" aria-label="Investor radar updates">
      <div className="radar-heading">
        <div>
          <div className="eyebrow">Research that keeps you informed</div>
          <h1>Investor radar</h1>
          <p className="muted">New leads, relevant news, and the evidence behind each update.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setCursor('');
            setRunOffset(0);
            setRefresh((v) => v + 1);
          }}
        >
          <RefreshCw size={14} />
          Refresh feed
        </button>
      </div>
      <InvestorDiscoveryAction
        state={state}
        onRefresh={onRefresh}
        onEditProfile={onEditProfile}
        compact
      />
      <details className="journey-details radar-context-settings">
        <summary>Research status & company context</summary>
        <div className="radar-health" role="status">
          <Radio size={17} />
          <strong>{feed ? `Worker: ${feed.status.state}` : 'Loading worker status…'}</strong>
          <span>Last completed: {when(feed?.status.lastCompletedAt ?? null)}</span>
          <span>Next due: {when(feed?.status.nextAt ?? null)}</span>
          <span>{feed?.unreadCount ?? 0} unread</span>
        </div>
        <p className="radar-health-note">
          Checks continue while the local worker runs. Reading this feed reuses saved research.
        </p>
        {children && (
          <details className="journey-details">
            <summary>Investor conversation details · optional</summary>
            {children}
          </details>
        )}
      </details>
      <div className="radar-tabs">
        <button
          className="button secondary"
          aria-pressed={tab === 'targets'}
          onClick={() => setTab('targets')}
        >
          Target investors{journey.data?.targets.length ? ` · ${journey.data.targets.length}` : ''}
        </button>
        <button
          className="button secondary"
          aria-pressed={tab === 'updates'}
          onClick={() => setTab('updates')}
        >
          Updates
        </button>
        <button
          className="button secondary"
          aria-pressed={tab === 'sources'}
          onClick={() => setTab('sources')}
        >
          Sources & check history
        </button>
      </div>
      <details className="journey-details">
        <summary>Filter investors & updates</summary>
        <div className="radar-controls">
          <label>
            Investor
            <select
              value={investor}
              onChange={(e) => {
                setInvestor(e.target.value);
                setCursor('');
                setRunOffset(0);
                setRun(null);
              }}
            >
              <option value="">All investors & candidates</option>
              {state.workspace.investors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          {tab === 'updates' && (
            <>
              <label>
                News type
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCursor('');
                  }}
                >
                  <option value="">All updates</option>
                  {radarCategories.map((c) => (
                    <option key={c} value={c}>
                      {labels[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="radar-checkbox">
                <input
                  type="checkbox"
                  checked={unread}
                  onChange={(e) => {
                    setUnread(e.target.checked);
                    setCursor('');
                  }}
                />
                Unread only
              </label>
            </>
          )}
        </div>{' '}
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {journey.error && <p role="alert">{journey.error}</p>}
      {tab === 'targets' && <TargetInvestors controller={journey} />}
      <div className="radar-layout">
        <div>
          {tab === 'updates' && (
            <>
              {linked && (
                <section aria-label="Linked investor update">
                  <h2>Update from your email</h2>
                  {eventCard(linked)}
                </section>
              )}
              {!feed && !error && <p>Loading saved updates…</p>}
              {feed?.items.length === 0 && (
                <div className="radar-empty">
                  <Bell size={28} />
                  <h2>No updates in this view yet.</h2>
                  <p>
                    New classified research will appear here. Raw sources and incomplete checks
                    remain under Sources & check history.
                  </p>
                </div>
              )}
              <div className="radar-feed-grid">
                {feed?.items.filter((i) => i.id !== linked?.id).map(eventCard)}
              </div>
              <div className="radar-actions">
                {cursor && (
                  <button className="button secondary" onClick={() => setCursor('')}>
                    Newest updates
                  </button>
                )}
                {feed?.nextCursor && (
                  <button
                    className="button secondary"
                    onClick={() => setCursor(feed.nextCursor ?? '')}
                  >
                    Older updates
                  </button>
                )}
              </div>
            </>
          )}
          {tab === 'sources' && (
            <div className="radar-history">
              <h2>Saved research runs</h2>
              <p className="muted">
                Extraction success does not establish investor identity or imply a new news event.
              </p>
              {runs?.items.length === 0 && <p>No research runs saved yet.</p>}
              {runs?.items.map((item) => (
                <button
                  key={item.id}
                  className="radar-run"
                  onClick={() =>
                    void act(async () => {
                      setRun(
                        await request(
                          `/research-runs/${item.id}`,
                          researchRunSchema,
                          undefined,
                          'GET',
                        ),
                      );
                    })
                  }
                >
                  <strong>
                    {item.kind} · {item.status.replaceAll('_', ' ')}
                  </strong>
                  <span>
                    {when(item.finishedAt)} · {item.sourceCount} sources · {item.evidenceCount}{' '}
                    extracted claims
                  </span>
                </button>
              ))}
              <div className="radar-actions">
                {runOffset > 0 && (
                  <button className="button secondary" onClick={() => setRunOffset(0)}>
                    Latest runs
                  </button>
                )}
                {runs?.nextOffset !== null && runs?.nextOffset !== undefined && (
                  <button
                    className="button secondary"
                    onClick={() => setRunOffset(runs.nextOffset ?? 0)}
                  >
                    Older runs
                  </button>
                )}
              </div>
              {run && (
                <section aria-label="Research run details">
                  <h3>{run.status.replaceAll('_', ' ')}</h3>
                  {run.failure && <p className="error">{run.failure.reason}</p>}
                  {run.searches.flatMap((search) =>
                    search.sources.map((source, index) => (
                      <details key={`${search.query}-${index}`}>
                        <summary>{source.title}</summary>
                        <p>
                          Retrieved {when(search.retrievedAt)} · Published{' '}
                          {source.publishedDate ?? 'Unknown'}
                        </p>
                        <blockquote className="radar-source-text">
                          {source.text ?? source.highlights?.join('\n') ?? 'No source text'}
                        </blockquote>
                        <p>
                          Decision:{' '}
                          {run.decisions.find((d) => d.url === source.url)?.reason ??
                            run.decisions.find((d) => d.url === source.url)?.status ??
                            'Not extracted'}
                        </p>
                        {source.url.startsWith('https://') && (
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            Open source
                          </a>
                        )}
                      </details>
                    )),
                  )}
                </section>
              )}
            </div>
          )}
        </div>
        <details className="journey-details radar-email-settings">
          <summary>Email alert settings</summary>
          <aside className="radar-email">
            <h2>
              <Mail size={18} /> Email alerts
            </h2>
            <p>Get meaningful new updates in your inbox.</p>
            {!preferences && <p>Loading preferences…</p>}
            {preferences && (
              <>
                {!preferences.ready && (
                  <p className="radar-email-note">
                    Email is not configured. Add RESEND_API_KEY and NOTIFICATION_FROM to the
                    backend, then restart API and worker.
                  </p>
                )}
                <p>
                  {preferences.recipient
                    ? `Confirmed: ${preferences.recipient}`
                    : 'No confirmed email address'}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(
                      () =>
                        request('/notification-preferences/confirmations', ok, {
                          recipient: email,
                        }),
                      'Confirmation queued. Enter the code from your inbox.',
                    );
                  }}
                >
                  <label>
                    Your email
                    <input
                      type="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy || !preferences.ready}
                    type="submit"
                  >
                    Send confirmation code
                  </button>
                </form>
                {preferences.confirmationPending && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(
                        () => request('/notification-preferences/confirm', ok, { code }),
                        'Address confirmed. Enable alerts when ready.',
                      );
                    }}
                  >
                    <label>
                      Six-digit code
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        required
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                    <button className="button" disabled={busy}>
                      Confirm address
                    </button>
                    <p className="muted">
                      Confirmation email: {preferences.confirmationDelivery?.status ?? 'pending'}
                      {preferences.confirmationDelivery?.error
                        ? ` · ${preferences.confirmationDelivery.error}`
                        : ''}
                    </p>
                  </form>
                )}
                <label className="radar-checkbox">
                  <input
                    type="checkbox"
                    checked={preferences.enabled}
                    disabled={
                      busy ||
                      (!preferences.enabled && (!preferences.ready || !preferences.recipient))
                    }
                    onChange={(e) =>
                      void act(() =>
                        request(
                          '/notification-preferences',
                          ok,
                          { enabled: e.target.checked, categories: preferences.categories },
                          'PUT',
                        ),
                      )
                    }
                  />
                  <strong>Email me new updates</strong>
                </label>
                <fieldset disabled={busy}>
                  <legend>Notify me about</legend>
                  {radarCategories.map((c) => (
                    <label className="radar-checkbox" key={c}>
                      <input
                        type="checkbox"
                        checked={preferences.categories.includes(c)}
                        onChange={(e) => {
                          const categories = e.target.checked
                            ? [...preferences.categories, c]
                            : preferences.categories.filter((item) => item !== c);
                          void act(() =>
                            request(
                              '/notification-preferences',
                              ok,
                              {
                                enabled: preferences.enabled,
                                categories: z.array(radarCategorySchema).parse(categories),
                              },
                              'PUT',
                            ),
                          );
                        }}
                      />
                      {labels[c]}
                    </label>
                  ))}
                </fieldset>
                <p className="muted">
                  <Check size={13} /> Saved history stays in the radar. Enabling email sends future
                  updates only.
                </p>
                <p className="muted">
                  Emails link to this local workspace. Open those links on the computer running
                  June.
                </p>
              </>
            )}
          </aside>
        </details>
      </div>
      {matchItem && (
        <InvestorMatchDialog
          key={matchItem.id}
          item={matchItem}
          controller={journey}
          onClose={() => setMatchItem(null)}
        />
      )}
    </section>
  );
}
