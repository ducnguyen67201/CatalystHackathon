import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Bell, ExternalLink, RefreshCw, Radio, Mail, Check } from 'lucide-react';
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
import './RadarUpdates.css';

const labels = {
  new_candidate: 'New candidate',
  investment: 'Investment',
  fund_announcement: 'Fund announcement',
  thesis_change: 'Thesis change',
  other_news: 'Related news',
};
const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Not available');
type Preferences = z.infer<typeof publicPreferencesSchema>;
const ok = z.object({ ok: z.boolean() });
export function RadarUpdates({
  state,
  onRefresh,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
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
  const [tab, setTab] = useState<'updates' | 'sources'>('updates');
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
  function eventCard(item: RadarItem) {
    return (
      <article className="radar-update" key={item.id} id={`update-${item.id}`}>
        <div className="radar-update-meta">
          <span>{labels[item.signal.category]}</span>
          <span>{item.readAt ? 'Read' : 'Unread'}</span>
          {item.fictional && <strong>Fictional example</strong>}
          {item.historical && <span>Historical · no email</span>}
        </div>
        <h3>{item.signal.headline}</h3>
        <p className="muted">
          {item.investorName} · Published: {item.occurredAt ?? 'Date unknown'}
        </p>
        <p>{item.signal.summary}</p>
        <div className="radar-relevance">
          <strong>Why it matters</strong>
          <p>{item.signal.whyItMatters}</p>
        </div>
        <div className="radar-flags">
          <span>
            {item.signal.needsReview
              ? 'Needs identity/relevance review'
              : 'Unverified public-source claim'}
          </span>
          {item.stale && <span>Based on older company context</span>}
          {item.dismissedAt && <span>Dismissed</span>}
          {item.supersedesEventId && <span>Corrects a previous update</span>}
        </div>
        <details>
          <summary>Supporting source and passage</summary>
          <blockquote>{item.signal.supportingQuote}</blockquote>
          <p>{item.source.title}</p>
          {item.source.url && (
            <a href={item.source.url} target="_blank" rel="noopener noreferrer">
              Open source <ExternalLink size={12} />
            </a>
          )}
          <p className="muted">
            Observed {when(item.observedAt)} · Saved {when(item.committedAt)}
          </p>
        </details>
        <div className="radar-card-bottom">
          <span>
            <Mail size={13} />{' '}
            {item.delivery
              ? `Email: ${item.delivery.status === 'sent' ? 'sent (provider accepted)' : item.delivery.status.replaceAll('_', ' ')}`
              : 'Email not queued'}
          </span>
          <div className="radar-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  request(`/radar/events/${item.id}/read`, ok, { read: !item.readAt }, 'PATCH'),
                )
              }
            >
              {item.readAt ? 'Mark unread' : 'Mark read'}
            </button>
            {!item.dismissedAt && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act(() => request(`/radar/events/${item.id}/dismiss`, ok, {}))}
              >
                Dismiss update
              </button>
            )}
            {item.delivery?.status === 'failed' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    request(`/notification-deliveries/${item.delivery?.id ?? ''}/retry`, ok, {}),
                  )
                }
              >
                Retry email
              </button>
            )}
          </div>
        </div>
        {item.delivery?.error && (
          <p className="muted" role="status">
            {item.delivery.error}
          </p>
        )}
      </article>
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
      <div className="radar-tabs">
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
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
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
              {feed?.items.filter((i) => i.id !== linked?.id).map(eventCard)}
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
                  Email is not configured. Add RESEND_API_KEY and NOTIFICATION_FROM to the backend,
                  then restart API and worker.
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
                      request('/notification-preferences/confirmations', ok, { recipient: email }),
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
                    busy || (!preferences.enabled && (!preferences.ready || !preferences.recipient))
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
                Emails link to this local workspace. Open those links on the computer running June.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
