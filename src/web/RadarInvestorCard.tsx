import { ArrowRight, Building2, ExternalLink, Mail, ShieldQuestion } from 'lucide-react';
import type { RadarItem } from '../contracts/RadarDelivery.js';

export const radarCategoryLabels = {
  new_candidate: 'New candidate',
  investment: 'Investment',
  fund_announcement: 'Fund announcement',
  thesis_change: 'Thesis change',
  other_news: 'Related news',
};

function publishedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unknown';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A saved lead stays distinct from verified eligibility and an approved preparation target. */
export function RadarInvestorCard({
  item,
  compact = false,
  expanded = false,
  matchLabel,
  matchKind,
  savedTarget,
  reviewing,
  busy,
  onReview,
  onToggleRead,
  onDismiss,
  onRetryEmail,
}: {
  item: RadarItem;
  compact?: boolean;
  expanded?: boolean;
  matchLabel: string;
  matchKind: 'scored' | 'outside_mandate' | 'outdated' | 'unverified';
  savedTarget: boolean;
  reviewing: boolean;
  busy: boolean;
  onReview: () => void;
  onToggleRead: () => void;
  onDismiss: () => void;
  onRetryEmail: () => void;
}) {
  return (
    <article
      className={`radar-update radar-investor-card${compact ? ' radar-event-compact' : ''}`}
      id={`update-${item.id}`}
    >
      <div className="radar-update-meta">
        <span>{radarCategoryLabels[item.signal.category]}</span>
        <span className={item.readAt ? '' : 'radar-unread'}>{item.readAt ? 'Read' : 'Unread'}</span>
        {item.fictional && <strong>Fictional example</strong>}
        {item.historical && <span>Historical · no email</span>}
      </div>
      {!compact && (
        <header className="radar-investor-heading">
          <div className="radar-investor-icon">
            <Building2 size={21} aria-hidden="true" />
          </div>
          <div>
            <h3>{item.investorName}</h3>
            <span className="radar-plan-state">
              {savedTarget ? 'Saved target investor' : 'Lead to review'}
            </span>
          </div>
        </header>
      )}
      {compact ? (
        <h3>{item.signal.headline}</h3>
      ) : (
        <p className="radar-news-preview">{item.signal.headline}</p>
      )}
      {!compact && (
        <div className="radar-fit-row" data-fit={matchKind}>
          <ShieldQuestion size={16} aria-hidden="true" />
          <span>Goal fit</span>
          <strong>{matchLabel}</strong>
        </div>
      )}
      <div className="radar-card-context">
        <span>
          {item.signal.needsReview
            ? 'Identity / relevance needs review'
            : 'Public source · unverified'}
        </span>
        <time dateTime={item.occurredAt ?? undefined} title={item.occurredAt ?? 'Date unknown'}>
          {publishedDate(item.occurredAt)}
        </time>
      </div>
      <div className="radar-flags">
        {item.stale && <span>Older company context</span>}
        {item.dismissedAt && <span>Dismissed</span>}
        {item.supersedesEventId && <span>Corrects a previous update</span>}
      </div>
      {!compact && (
        <div className="radar-card-primary">
          <button className="button" disabled={reviewing} onClick={onReview}>
            {savedTarget ? 'Review target investor' : 'Review investor'}{' '}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <details className="radar-card-details" open={expanded || undefined}>
        <summary>News & sources</summary>
        <div className="radar-card-expanded">
          <h4>{item.signal.headline}</h4>
          <p>{item.signal.summary}</p>
          <div className="radar-relevance">
            <strong>Why it matters</strong>
            <p>{item.signal.whyItMatters}</p>
          </div>
          <h4>Supporting source and passage</h4>
          <blockquote>{item.signal.supportingQuote}</blockquote>
          <p className="radar-source-title">{item.source.title}</p>
          {item.source.url && (
            <a href={item.source.url} target="_blank" rel="noopener noreferrer">
              Open source <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          <p className="muted">
            Published: {item.occurredAt ?? 'Date unknown'}
            <br />
            Observed {new Date(item.observedAt).toLocaleString()} · Saved{' '}
            {new Date(item.committedAt).toLocaleString()}
          </p>
        </div>
      </details>
      <details className="radar-card-options">
        <summary>Update options</summary>
        <div className="radar-card-bottom">
          <span>
            <Mail size={13} aria-hidden="true" />{' '}
            {item.delivery
              ? `Email: ${item.delivery.status === 'sent' ? 'sent (provider accepted)' : item.delivery.status.replaceAll('_', ' ')}`
              : 'Email not queued'}
          </span>
          <div className="radar-actions">
            <button className="button secondary" disabled={busy} onClick={onToggleRead}>
              {item.readAt ? 'Mark unread' : 'Mark read'}
            </button>
            {!item.dismissedAt && (
              <button className="button secondary" disabled={busy} onClick={onDismiss}>
                Dismiss update
              </button>
            )}
            {item.delivery?.status === 'failed' && (
              <button className="button secondary" disabled={busy} onClick={onRetryEmail}>
                Retry email
              </button>
            )}
          </div>
        </div>
      </details>
      {item.delivery?.error && (
        <p className="muted" role="status">
          {item.delivery.error}
        </p>
      )}
    </article>
  );
}
