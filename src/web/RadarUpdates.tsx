import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Bell, RefreshCw, Radio, Mail, Check } from 'lucide-react';
import {
  radarCategories,
  radarCategorySchema,
  radarFeedSchema,
  radarStatusSchema,
  radarInvestorGroupsSchema,
  type RadarInvestorGroup,
  radarItemSchema,
  publicPreferencesSchema,
  type RadarFeed,
  type RadarItem,
} from '../contracts/RadarDelivery.js';
import type { StateResponse } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { InvestorMatchDialog, TargetInvestors, useGoalJourney } from './GoalJourney.js';
import './RadarUpdates.css';
import { RadarResearchHistory } from './RadarResearchHistory.js';
import { RadarInvestorList } from './RadarInvestorList.js';
import { InvestorProfileEstimate } from './InvestorProfileEstimate.js';
import { targetPreparationHref } from '../contracts/PreparationNavigation.js';
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
  const [loadedFeed, setLoadedFeed] = useState<{ key: string; value: RadarFeed } | null>(null);
  const [status, setStatus] = useState<z.infer<typeof radarStatusSchema> | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [category, setCategory] = useState('');
  const [groups, setGroups] = useState<RadarInvestorGroup[] | null>(null);
  const [selectedKey, setSelectedKey] = useState(
    () => new URLSearchParams(window.location.search).get('radarInvestor') ?? '',
  );
  const [unread, setUnread] = useState(false);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<'overview' | 'updates' | 'sources' | 'targets'>(() =>
    z.uuid().safeParse(new URLSearchParams(window.location.search).get('targetId')).success
      ? 'targets'
      : 'overview',
  );
  const journey = useGoalJourney(state.workspace.revision);
  const [matchItem, setMatchItem] = useState<RadarItem | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [linked, setLinked] = useState<RadarItem | null>(null);
  const deepId = new URLSearchParams(window.location.search).get('radarEvent');
  const requestedTargetId = new URLSearchParams(window.location.search).get('targetId');
  const requestedInvestorId = journey.data?.targets.find(
    (target) => target.id === requestedTargetId,
  )?.investorId;
  const selected =
    groups?.find(
      (group) =>
        group.key === selectedKey ||
        (selectedKey.startsWith('candidate:') &&
          group.suggestionIds.includes(selectedKey.slice(10))),
    ) ??
    groups?.find((group) => group.investorId === requestedInvestorId) ??
    groups?.[0];
  const investor = selected?.investorId ?? '';
  const suggestion = selected && !investor ? (selected.suggestionIds[0] ?? '') : '';
  const feedKey = JSON.stringify([selected?.key, category, unread, cursor]);
  const feed = loadedFeed?.key === feedKey ? loadedFeed.value : null;
  const tracked = state.workspace.investors.find((item) => item.id === investor);
  const target = journey.data?.targets.find((item) => item.investorId === investor);
  const assessment = journey.data?.assessments.findLast(
    (item) =>
      item.investorId === investor && item.goalVersionId === journey.data?.journey?.currentGoalId,
  );
  const matchLabel = target?.matchOutdated
    ? 'Needs reassessment'
    : assessment?.assessment.status === 'scored'
      ? `${assessment.assessment.score}/10 match`
      : assessment?.assessment.status === 'outside_mandate'
        ? 'Outside stated mandate'
        : 'Needs verification';
  // Keep the current investor selected when incoming research reorders the list.
  useEffect(() => {
    if (!selectedKey && selected && (!requestedTargetId || requestedInvestorId))
      setSelectedKey(selected.key);
  }, [selectedKey, selected, requestedTargetId, requestedInvestorId]);
  function selectInvestor(group: RadarInvestorGroup) {
    setSelectedKey(group.key);
    setTab('overview');
    setCursor('');
    setLinked(null);
    setCategory('');
    setUnread(false);
    const url = new URL(window.location.href);
    url.searchParams.set('radarInvestor', group.key);
    url.searchParams.delete('radarEvent');
    url.searchParams.delete('targetId');
    window.history.replaceState(null, '', url);
  }
  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const [next, prefs, health] = await Promise.all([
          request('/radar/investors', radarInvestorGroupsSchema, undefined, 'GET'),
          request('/notification-preferences', publicPreferencesSchema, undefined, 'GET'),
          request('/radar/status', radarStatusSchema, undefined, 'GET'),
        ]);
        if (active) {
          setGroups(next.items);
          setPreferences(prefs);
          setStatus(health);
        }
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Unable to load investors.');
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    const onVisible = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (document.hidden || !selected || loading) return;
      loading = true;
      const query = new URLSearchParams({
        limit: '20',
        ...(category ? { category } : {}),
        ...(investor ? { investorId: investor } : {}),
        ...(suggestion ? { suggestionId: suggestion } : {}),
        ...(unread ? { unread: 'true' } : {}),
        ...(cursor ? { cursor } : {}),
      });
      try {
        const next = await request(
          `/radar/events?${query.toString()}`,
          radarFeedSchema,
          undefined,
          'GET',
        );
        if (active) {
          setLoadedFeed({ key: feedKey, value: next });
          setError('');
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load radar.');
      } finally {
        loading = false;
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
  }, [category, investor, suggestion, unread, cursor, refresh, selected?.key, feedKey]);
  useEffect(() => {
    let active = true;
    if (deepId)
      void request(`/radar/events/${encodeURIComponent(deepId)}`, radarItemSchema, undefined, 'GET')
        .then((item) => {
          if (active) {
            setLinked(item);
            setTab('updates');
            setSelectedKey(
              item.investorId ? `investor:${item.investorId}` : `candidate:${item.suggestionId}`,
            );
            setCursor('');
            setCategory('');
            setUnread(false);
          }
        })
        .catch(() => {
          if (active) setError('The linked radar update is unavailable.');
        });
    return () => {
      active = false;
    };
  }, [deepId, refresh]);
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
  function eventCard(item: RadarItem, expanded = false) {
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
        compact
        expanded={expanded}
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
          <strong>{status ? `Worker: ${status.state}` : 'Loading worker status…'}</strong>
          <span>Last completed: {when(status?.lastCompletedAt ?? null)}</span>
          <span>Next due: {when(status?.nextAt ?? null)}</span>
          <span>{groups?.reduce((total, group) => total + group.unreadCount, 0) ?? 0} unread</span>
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
      <div className="radar-workspace">
        <RadarInvestorList
          groups={groups ?? []}
          selectedKey={selected?.key ?? ''}
          onSelect={selectInvestor}
        />
        <div className="radar-investor-detail" key={selected?.key ?? 'empty'}>
          {!groups && <p role="status">Loading investors…</p>}
          {selected && (
            <>
              <header className="radar-detail-heading">
                <div>
                  <div className="eyebrow">
                    {target
                      ? 'Saved target investor'
                      : investor
                        ? 'Tracked investor'
                        : 'Discovered lead'}
                  </div>
                  <h2>{selected.name}</h2>
                </div>
                <span className="radar-detail-fit">{matchLabel}</span>
              </header>
              <div className="radar-detail-stats">
                <span>
                  <strong>{selected.updateCount}</strong>{' '}
                  {selected.updateCount === 1 ? 'update' : 'updates'}
                </span>
                <span>
                  <strong>{selected.unreadCount}</strong> unread
                </span>
                <span>
                  <strong>{selected.sourceCount}</strong>{' '}
                  {selected.sourceCount === 1 ? 'update source' : 'update sources'}
                </span>
              </div>
              <div className="radar-actions">
                {selected.latestEventId && (
                  <button
                    className="button"
                    disabled={journey.busy || busy}
                    onClick={() =>
                      void act(async () => {
                        const item = await request(
                          `/radar/events/${encodeURIComponent(selected.latestEventId ?? '')}`,
                          radarItemSchema,
                          undefined,
                          'GET',
                        );
                        await reviewInvestor(item);
                      })
                    }
                  >
                    Review investor fit →
                  </button>
                )}
                {target && (
                  <a className="button secondary" href={targetPreparationHref(target)}>
                    Continue preparation →
                  </a>
                )}
              </div>
              <div className="radar-tabs" aria-label="Investor sections">
                {(['overview', 'updates', 'sources', 'targets'] as const).map((value) => (
                  <button
                    key={value}
                    className="button secondary"
                    aria-pressed={tab === value}
                    onClick={() => setTab(value)}
                  >
                    {value === 'overview'
                      ? 'Overview'
                      : value === 'updates'
                        ? 'Updates'
                        : value === 'sources'
                          ? 'Sources & checks'
                          : 'Preparation'}
                  </button>
                ))}
              </div>
              {tab === 'overview' && (
                <section className="radar-person-overview" aria-label="Investor overview">
                  <p className="muted">
                    Match uses saved evidence for your current goal. AI estimates remain separately
                    labeled.
                  </p>
                  {tracked?.url && (
                    <a href={tracked.url} target="_blank" rel="noreferrer">
                      Saved investor website ↗
                    </a>
                  )}
                  {tracked?.profileLinks
                    .filter((link) => link !== tracked.url)
                    .map((link) => (
                      <p key={link}>
                        <a href={link} target="_blank" rel="noreferrer">
                          Saved profile ↗
                        </a>
                      </p>
                    ))}
                  {tracked && (
                    <p className="muted">
                      Monitoring: {tracked.frequency} · Last check:{' '}
                      {when(tracked.checks.at(-1)?.checkedAt ?? null)}
                    </p>
                  )}
                  {selected.latestHeadline && (
                    <div className="radar-latest-news">
                      <span className="eyebrow">Latest saved update</span>
                      <p>{selected.latestHeadline}</p>
                      <button className="text-button" onClick={() => setTab('updates')}>
                        See{' '}
                        {selected.updateCount === 1
                          ? 'the update'
                          : `all ${selected.updateCount} updates`}{' '}
                        →
                      </button>
                    </div>
                  )}
                  {investor ? (
                    <InvestorProfileEstimate
                      key={investor}
                      investorId={investor}
                      revision={state.workspace.revision}
                    />
                  ) : (
                    <p>
                      Review this lead to confirm its identity and explore its profile. It has not
                      been added to your preparation plan.
                    </p>
                  )}
                  {!selected.latestEventId && (
                    <p>
                      No classified updates yet. Existing research and check history remain
                      available in Sources & checks.
                    </p>
                  )}
                  <a
                    className="text-button"
                    href={`/?page=investors${investor ? `&investor=${encodeURIComponent(investor)}` : ''}`}
                  >
                    Research investor details →
                  </a>
                </section>
              )}
            </>
          )}
          {tab === 'updates' && (
            <details className="journey-details">
              <summary>Filter updates</summary>
              <div className="radar-controls">
                {selected && (
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
            </details>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {journey.error && <p role="alert">{journey.error}</p>}
          {tab === 'targets' &&
            (investor ? (
              <TargetInvestors controller={journey} investorId={investor} />
            ) : (
              <p>Review this lead and choose it as a target to begin preparation.</p>
            ))}
          <div className="radar-layout radar-scoped-layout">
            <div>
              {tab === 'updates' && selected && (
                <>
                  {linked &&
                    (linked.investorId === investor ||
                      (!!linked.suggestionId &&
                        selected.suggestionIds.includes(linked.suggestionId))) && (
                      <section aria-label="Linked investor update">
                        <h2>Update from your email</h2>
                        {eventCard(linked, true)}
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
                    {feed?.items.filter((i) => i.id !== linked?.id).map((item) => eventCard(item))}
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
              {tab === 'sources' &&
                (investor ? (
                  <RadarResearchHistory key={investor} investorId={investor} revision={refresh} />
                ) : (
                  <>
                    <h3>Lead sources</h3>
                    <p>
                      Exact passages are saved with this lead’s updates. Shared discovery runs
                      remain in the company-wide archive below.
                    </p>
                    <button className="button secondary" onClick={() => setTab('updates')}>
                      Open lead updates & sources →
                    </button>
                  </>
                ))}
            </div>
          </div>
        </div>
      </div>
      <details
        className="journey-details"
        onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
      >
        <summary>Company-wide research archive</summary>
        <p className="muted">
          Includes discovery checks covering multiple investors. Individual investor history is
          available above.
        </p>
        {archiveOpen && <RadarResearchHistory revision={refresh} />}
      </details>
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
      </details>
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
