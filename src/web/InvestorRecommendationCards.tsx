import { Decimal } from 'decimal.js';
import {
  ArrowRight,
  Building2,
  Check,
  CircleHelp,
  FileText,
  Layers3,
  MapPin,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import type {
  ConnectedPreparationView,
  PreparationRecommendation,
} from '../contracts/ConnectedPreparation.js';
import './InvestorRecommendationCards.css';

function RecommendationCard({
  candidate,
  onSelect,
  disabled,
}: {
  candidate: PreparationRecommendation;
  onSelect?: ((investorId: string) => void) | undefined;
  disabled: boolean;
}) {
  const match = candidate.match;
  const scored = match?.status === 'scored' && match.score !== null;
  const coverage = match
    ? Decimal.min(100, Decimal.max(0, new Decimal(match.coverage).mul(100))).toFixed(0)
    : null;
  const facts = [
    { label: 'Stage', value: candidate.stage, icon: Layers3 },
    { label: 'Sector', value: candidate.sector, icon: Building2 },
    { label: 'Geography', value: candidate.geography, icon: MapPin },
  ];
  const fictional = candidate.sources.some((source) => source.fictional);
  return (
    <article className="investor-recommendation-card" data-recommendation={candidate.label}>
      <header>
        <div className="investor-recommendation-icon">
          <Building2 size={20} aria-hidden="true" />
        </div>
        <h4>{candidate.name}</h4>
      </header>
      <div className="investor-recommendation-status">
        {scored ? (
          <ShieldCheck size={17} aria-hidden="true" />
        ) : (
          <ShieldQuestion size={17} aria-hidden="true" />
        )}
        <strong>{candidate.label}</strong>
        {scored && <span>{match.score}/10 match</span>}
      </div>
      {fictional && (
        <span className="investor-recommendation-fictional">Fictional demo evidence</span>
      )}
      <div className="investor-evidence-coverage">
        <div>
          <span>Evidence coverage</span>
          <strong>{coverage === null ? 'Not assessed' : `${coverage}%`}</strong>
        </div>
        {coverage !== null && (
          <meter
            min={0}
            max={100}
            value={coverage}
            aria-label={`Evidence coverage for ${candidate.name}`}
          >
            {coverage}%
          </meter>
        )}
        <small>
          {match
            ? `${match.supportedWeight}/${match.applicableWeight} weighted evidence${scored ? '' : ' · no match score'}`
            : 'No saved match assessment'}
        </small>
      </div>
      <span className="investor-recommendation-facts-label">Saved observations</span>
      <dl className="investor-recommendation-facts">
        {facts.map(({ label, value, icon: Icon }) => (
          <div key={label} data-known={!!value}>
            <dt>
              <Icon size={13} aria-hidden="true" />
              {label}
            </dt>
            <dd title={value ?? 'Not confirmed'}>{value ?? 'Not confirmed'}</dd>
          </div>
        ))}
      </dl>
      <div className="investor-recommendation-signals">
        <span>
          <FileText size={14} aria-hidden="true" />
          {candidate.sources.length} saved {candidate.sources.length === 1 ? 'source' : 'sources'}
        </span>
        <span>
          <CircleHelp size={14} aria-hidden="true" />
          {candidate.unknowns.length} {candidate.unknowns.length === 1 ? 'gap' : 'gaps'} to review
        </span>
      </div>
      <div className="investor-recommendation-action">
        {candidate.investorId && onSelect ? (
          <button
            className="button"
            disabled={disabled}
            onClick={() => {
              if (candidate.investorId) onSelect(candidate.investorId);
            }}
          >
            Prepare for this investor <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <a
            className="button secondary"
            href={`/?page=investors${candidate.investorId ? '&investor=' + encodeURIComponent(candidate.investorId) + '#investor-research-detail' : '#investor-discovery'}`}
          >
            {candidate.investorId ? 'Inspect investor' : 'Review suggestion & track explicitly'}{' '}
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <details className="investor-recommendation-details">
        <summary>Why this investor & gaps</summary>
        <h5>Why review this investor?</h5>
        {candidate.reasons.length ? (
          <ul>
            {candidate.reasons.map((reason) => (
              <li key={reason}>
                <Check size={14} aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No supported alignment has been established.</p>
        )}
        <h5>Tradeoffs & unknowns</h5>
        {candidate.unknowns.length ? (
          <ul>
            {candidate.unknowns.map((reason) => (
              <li key={reason}>
                <CircleHelp size={14} aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No additional gaps recorded in this saved recommendation.</p>
        )}
        {match && (
          <p className="muted">
            Assessed {new Date(match.assessedAt).toLocaleString()} · {match.rubricVersion}
          </p>
        )}
      </details>
      <details className="investor-recommendation-details">
        <summary>Sources ({candidate.sources.length})</summary>
        {!candidate.sources.length && <p>No supporting sources saved for this recommendation.</p>}
        {candidate.sources.map((source) => (
          <blockquote key={source.id}>
            <strong>
              {source.fictional ? 'Fictional demo evidence · ' : ''}
              {source.title}
            </strong>
            <p>{source.excerpt}</p>
            <small>Recorded: {source.recordedAt ?? 'Unknown'}</small>
            {source.url && (
              <p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  Read original source ↗
                </a>
              </p>
            )}
          </blockquote>
        ))}
      </details>
    </article>
  );
}

/** The saved recommendation and evidence remain intact; cards only change presentation. */
export function InvestorPreparationRecommendations({
  view,
  onSelect,
  disabled = false,
}: {
  view: ConnectedPreparationView;
  onSelect?: (investorId: string) => void;
  disabled?: boolean;
}) {
  return (
    <section
      className="loop-recommendations investor-recommendation-section"
      aria-label="Recommended investors"
    >
      <div className="loop-section-heading">
        <h3>Investors to review for your next conversation</h3>
        <span className="muted">Saved research · no funding score</span>
      </div>
      {!view.recommendations.length ? (
        <p>
          No saved candidates yet. Add or discover investors in{' '}
          <a href="/?page=investors">Investor research</a>.
        </p>
      ) : (
        <div className="investor-recommendation-grid">
          {view.recommendations.map((candidate) => (
            <RecommendationCard
              key={candidate.investorId ?? candidate.suggestionId}
              candidate={candidate}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      <details className="investor-recommendation-method">
        <summary>How to read these recommendations</summary>
        <p className="loop-method">
          These compare saved observations, which may describe historical deals. Current mandate,
          individual check size and application routes need confirmation. Round totals are not
          investor checks.
        </p>
        <p className="loop-method">
          Evidence coverage describes supported criteria, not investment probability. Unconfirmed
          details stay unconfirmed.
        </p>
      </details>
    </section>
  );
}
