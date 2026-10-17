import './EvidenceReview.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  evidenceReviewSchema,
  supportLabels,
  type EvidenceReview as Review,
} from '../contracts/EvidenceReview.js';
import type { EvaluationContext, EvaluationRecord } from '../contracts/RehearsalEvaluation.js';
import { request } from './ApiClient.js';
import { FinancialEvidenceGrid, sourceLabel } from './FinancialEvidenceGrid.js';
import { TranscriptEvidence } from './TranscriptEvidence.js';

export function EvidenceReview({
  sessionId,
  evaluation,
  context,
  cache,
  renderCoaching,
}: {
  sessionId: string;
  evaluation: EvaluationRecord;
  context: EvaluationContext | null;
  cache: Map<string, Review>;
  renderCoaching: (claimId: string) => ReactNode;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [view, setView] = useState<'sheet' | 'transcript'>('transcript');
  const cellsRef = useRef(new Map<string, HTMLButtonElement>());
  const claimsRef = useRef(new Map<string, HTMLButtonElement>());
  const turnsRef = useRef(new Map<string, HTMLDivElement>());
  const inspectorRef = useRef<HTMLElement>(null);
  const tabsRef = useRef(new Map<string, HTMLButtonElement>());
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    const key = JSON.stringify([
      sessionId,
      evaluation.id,
      evaluation.contextHash,
      evaluation.transcriptHash,
      'csv-review-v1',
    ]);
    const load = async () => {
      setError(false);
      try {
        const saved =
          cache.get(key) ??
          (await request(
            `/rehearsals/${encodeURIComponent(sessionId)}/evaluations/${encodeURIComponent(evaluation.id)}/evidence`,
            evidenceReviewSchema,
            undefined,
            'GET',
          ));
        if (cancelled) return;
        if (
          saved.sessionId !== sessionId ||
          saved.evaluationId !== evaluation.id ||
          saved.contextHash !== evaluation.contextHash ||
          saved.transcriptHash !== evaluation.transcriptHash
        )
          throw new Error('Review identity mismatch');
        if (saved.state === 'completed') {
          if (cache.size >= 8) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          cache.set(key, saved);
        }
        setReview(saved);
        const first =
          saved.claimLinks.find((link) => link.support === 'contradicted') ?? saved.claimLinks[0];
        setSelectedClaimId(first?.claimId ?? null);
        setSelectedCellId(first?.primaryCellIds[0] ?? first?.cellIds[0] ?? null);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, evaluation.id, evaluation.contextHash, evaluation.transcriptHash, cache, retry]);
  if (error)
    return (
      <div role="alert">
        <p>Could not load the evidence sheet. Your saved coaching is available below.</p>
        <button className="button secondary" onClick={() => setRetry((value) => value + 1)}>
          Reload evidence
        </button>
        {[...new Set(evaluation.report?.coaching.items.map((item) => item.claimId))].map(
          (claimId) => (
            <div key={claimId}>{renderCoaching(claimId)}</div>
          ),
        )}
      </div>
    );
  if (!review) return <p role="status">Loading evidence-linked review…</p>;
  const cells = review.grids.flatMap((grid) => grid.cells);
  const link = review.claimLinks.find((l) => l.claimId === selectedClaimId);
  const claim = evaluation.report?.extraction.claims.find((c) => c.id === selectedClaimId);
  const selectedCell = cells.find((cell) => cell.id === selectedCellId);
  const cellClaims = review.claimLinks.filter(
    (l) => selectedCellId !== null && l.cellIds.includes(selectedCellId),
  );
  const chooseClaim = (claimId: string) => {
    const target = review.claimLinks.find((l) => l.claimId === claimId);
    setSelectedClaimId(claimId);
    setSelectedCellId(target?.primaryCellIds[0] ?? target?.cellIds[0] ?? null);
  };
  const focusElement = (element: HTMLElement | undefined | null) => {
    element?.focus();
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const primaryCells = link?.primaryCellIds ?? [];
  const supportingCells = link?.cellIds.filter((cellId) => !primaryCells.includes(cellId)) ?? [];
  return (
    <section className="evidence-review" aria-label="Evidence-linked financial review">
      {review.currentSnapshotChanged && (
        <p className="evidence-notice">
          The workspace now selects a different financial snapshot. This review retains the evidence
          saved with this practice. Start a new practice to review new evidence.
        </p>
      )}
      {evaluation.legacyDemo && <p className="evidence-notice">Historical fictional review</p>}
      {review.scope !== 'complete' && (
        <p className="evidence-notice">
          {review.scope === 'partial'
            ? 'Partial transcript: this review covers only the saved conversation.'
            : 'Transcript-only review: financial verification may be unavailable.'}
        </p>
      )}
      {review.reason && <p role="status">{review.reason}</p>}
      {review.reason &&
        !review.claimLinks.length &&
        [...new Set(evaluation.report?.coaching.items.map((item) => item.claimId))].map(
          (claimId) => <div key={claimId}>{renderCoaching(claimId)}</div>,
        )}
      <div className="evidence-findings" aria-label="Reviewed claims">
        {review.claimLinks.map((item, index) => (
          <button
            key={item.claimId}
            className={`finding support-${item.support}`}
            aria-pressed={selectedClaimId === item.claimId}
            onClick={() => chooseClaim(item.claimId)}
          >
            <span>Claim {index + 1}</span>
            <strong>{supportLabels[item.support]}</strong>
          </button>
        ))}
      </div>
      <div className="evidence-tabs" role="tablist" aria-label="Review views">
        {(['sheet', 'transcript'] as const).map((name) => (
          <button
            key={name}
            ref={(node) => {
              if (node) tabsRef.current.set(name, node);
              else tabsRef.current.delete(name);
            }}
            role="tab"
            id={`${id}-${name}`}
            aria-controls={`${id}-view`}
            aria-selected={view === name}
            tabIndex={view === name ? 0 : -1}
            onClick={() => setView(name)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'sheet'
                  : event.key === 'End'
                    ? 'transcript'
                    : name === 'sheet'
                      ? 'transcript'
                      : 'sheet';
              setView(next);
              tabsRef.current.get(next)?.focus();
            }}
          >
            {name === 'sheet' ? 'Excel-style evidence' : 'Interview transcript'}
          </button>
        ))}
      </div>
      <div className="evidence-review-layout">
        <div
          className="evidence-review-content"
          role="tabpanel"
          id={`${id}-view`}
          aria-labelledby={`${id}-${view}`}
        >
          {view === 'transcript' && (
            <TranscriptEvidence
              evaluation={evaluation}
              links={review.claimLinks}
              cells={cells}
              selectedClaimId={selectedClaimId}
              onSelect={chooseClaim}
              registerClaim={(claimId, node) => {
                if (node) claimsRef.current.set(claimId, node);
                else claimsRef.current.delete(claimId);
              }}
              registerTurn={(turnId, node) => {
                if (node) turnsRef.current.set(turnId, node);
                else turnsRef.current.delete(turnId);
              }}
            />
          )}
          {selectedClaimId && (
            <button
              className="button secondary evidence-inspect-button"
              onClick={() => focusElement(inspectorRef.current)}
            >
              Inspect selected claim ↓
            </button>
          )}
          {review.grids.map((grid) => (
            <FinancialEvidenceGrid
              key={grid.id}
              grid={grid}
              changes={review.changes}
              selectedCellId={selectedCellId}
              primaryCellIds={primaryCells}
              supportingCellIds={supportingCells}
              flaggedCellIds={review.claimLinks
                .filter((l) => l.support === 'contradicted')
                .flatMap((l) => l.primaryCellIds)}
              onSelect={(cell) => {
                setSelectedCellId(cell.id);
                const candidates = review.claimLinks.filter((l) => l.cellIds.includes(cell.id));
                setSelectedClaimId(
                  candidates.length === 1 ? (candidates[0]?.claimId ?? null) : null,
                );
              }}
              registerCell={(cellId, node) => {
                if (node) cellsRef.current.set(cellId, node);
                else cellsRef.current.delete(cellId);
              }}
            />
          ))}
          {!review.grids.length && (
            <p>No validated financial sheet is available in this review’s frozen evidence.</p>
          )}
          <details className="evidence-coverage">
            <summary>Evidence coverage and limitations</summary>
            {review.coverage.limitations.map((limit, index) => (
              <p key={index}>{limit}</p>
            ))}
            {review.coverage.unavailableSources.map((source, index) => (
              <p key={index}>Source unavailable: {source.reason}</p>
            ))}
            <p>
              {review.coverage.periods.length} reporting periods available. Source matches establish
              agreement with the saved statement, not independent verification.
            </p>
          </details>
        </div>
        <section
          className="evidence-inspector"
          ref={inspectorRef}
          tabIndex={-1}
          aria-label="Selected claim evidence inspector"
        >
          <div className="eyebrow">Evidence inspector</div>
          {selectedCell && (
            <div className="evidence-cell-detail">
              <strong>
                Review cell {selectedCell.displayAddress} · {selectedCell.label}
              </strong>
              <p>{sourceLabel(selectedCell)}</p>
              <p>
                {selectedCell.value} {selectedCell.unit} · {selectedCell.period}
                {selectedCell.origin === 'fictional' ? ' · Fictional evidence' : ''}
              </p>
            </div>
          )}
          {cellClaims.length > 1 && !link && (
            <div>
              <h4>Claims using this cell</h4>
              {cellClaims.map((item, index) => (
                <button
                  key={item.claimId}
                  className="button secondary"
                  onClick={() => chooseClaim(item.claimId)}
                >
                  Inspect claim {index + 1}:{' '}
                  {evaluation.report?.extraction.claims.find((c) => c.id === item.claimId)?.quote}
                </button>
              ))}
            </div>
          )}
          {link && claim ? (
            <>
              <p className={`evidence-status support-${link.support}`}>
                {supportLabels[link.support]}
              </p>
              <h4>What you said</h4>
              <blockquote>{claim.quote}</blockquote>
              <p>{link.explanation}</p>
              {link.comparison ? (
                <>
                  <div className="evidence-comparison">
                    <div>
                      <small>You said</small>
                      <strong>{link.comparison.claimed}</strong>
                    </div>
                    <div>
                      <small>Selected source</small>
                      <strong>{link.comparison.source}</strong>
                    </div>
                  </div>
                  <p>
                    {link.comparison.unit} · {link.comparison.period}
                    <br />
                    Claim minus source: {link.comparison.difference}
                  </p>
                </>
              ) : (
                <p>{link.unavailableReason}</p>
              )}
              {(claim.uncertainty || link.spanStatus !== 'exact') && (
                <p className="muted">
                  {claim.uncertainty}{' '}
                  {link.spanStatus !== 'exact'
                    ? 'Use the whole-turn link; this quote cannot be highlighted uniquely.'
                    : ''}
                </p>
              )}
              {link.cellIds.length > 0 && (
                <div className="evidence-citations">
                  <h4>Supporting cells</h4>
                  {link.cellIds.map((cellId) => {
                    const cell = cells.find((c) => c.id === cellId);
                    return cell ? (
                      <button
                        key={cellId}
                        className="evidence-citation"
                        onClick={() => {
                          setSelectedCellId(cellId);
                          focusElement(cellsRef.current.get(cellId));
                        }}
                      >
                        <strong>
                          {cell.displayAddress} · {cell.label}
                        </strong>
                        <span>
                          {primaryCells.includes(cellId)
                            ? 'Primary evidence'
                            : 'Explanatory evidence'}{' '}
                          · {cell.value} {cell.unit}
                        </span>
                        <small>
                          {sourceLabel(cell)}
                          {cell.origin === 'fictional' ? ' · Fictional' : ''}
                        </small>
                      </button>
                    ) : null;
                  })}
                </div>
              )}
              {context?.facts
                .filter((fact) =>
                  [...link.primaryFactIds, ...link.supportingFactIds].includes(fact.id),
                )
                .map((fact) => (
                  <p className="evidence-fact" key={fact.id}>
                    {fact.metric.replaceAll('_', ' ')}: {fact.value} {fact.unit}, {fact.period}.{' '}
                    {fact.calculation}
                  </p>
                ))}
              {context?.sources
                .filter(
                  (source) => link.sourceIds.includes(source.id) && source.kind !== 'financial',
                )
                .map((source) => (
                  <details key={source.id}>
                    <summary>
                      {source.title} · {source.origin}
                    </summary>
                    <p>{source.text}</p>
                    {source.url && /^https?:/.test(source.url) && (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    )}
                  </details>
                ))}
              <div className="actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setView('transcript');
                    requestAnimationFrame(() =>
                      focusElement(
                        claimsRef.current.get(link.claimId) ?? turnsRef.current.get(link.turnId),
                      ),
                    );
                  }}
                >
                  Show transcript claim
                </button>
                {link.primaryCellIds.length > 0 && (
                  <button
                    className="button secondary"
                    onClick={() => focusElement(cellsRef.current.get(link.primaryCellIds[0] ?? ''))}
                  >
                    Show supporting cells
                  </button>
                )}
                {link.correctedByTurnId && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setView('transcript');
                      requestAnimationFrame(() =>
                        focusElement(turnsRef.current.get(link.correctedByTurnId ?? '')),
                      );
                    }}
                  >
                    Show later correction
                  </button>
                )}
              </div>
              {!link.correctedByTurnId && renderCoaching(link.claimId)}
            </>
          ) : (
            !cellClaims.length && (
              <p>Select a transcript claim or a highlighted figure to inspect its evidence.</p>
            )
          )}
        </section>
      </div>
    </section>
  );
}
