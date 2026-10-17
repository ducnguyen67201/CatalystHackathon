import { useId, useState, type ReactNode } from 'react';
import { supportLabels, type ClaimLink, type EvidenceCell } from '../contracts/EvidenceReview.js';
import type { EvaluationRecord } from '../contracts/RehearsalEvaluation.js';
import { sourceLabel } from './FinancialEvidenceGrid.js';

function ClaimPreview({
  link,
  cells,
  children,
  selected,
  onSelect,
  registerClaim,
}: {
  link: ClaimLink;
  cells: EvidenceCell[];
  children: ReactNode;
  selected: boolean;
  onSelect: (id: string) => void;
  registerClaim: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const tooltipId = useId();
  return (
    <span
      className={`transcript-claim-wrap ${dismissed ? 'preview-dismissed' : ''}`}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setDismissed(true);
        }
      }}
    >
      <button
        ref={(node) => registerClaim(link.claimId, node)}
        className={`transcript-claim support-${link.support}`}
        aria-pressed={selected}
        aria-describedby={tooltipId}
        onClick={() => onSelect(link.claimId)}
      >
        {children}
      </button>
      <span id={tooltipId} role="tooltip" className="transcript-evidence-preview">
        <strong>{supportLabels[link.support]}</strong>
        <span>{link.explanation}</span>
        {cells.slice(0, 4).map((cell) => (
          <span key={cell.id} className="preview-fact">
            <b>
              {cell.label}: {cell.value} {cell.unit}
            </b>
            <small>
              {sourceLabel(cell)} · {cell.period}
              {cell.origin === 'fictional' ? ' · Fictional' : ''}
            </small>
          </span>
        ))}
        {!cells.length && (
          <span>{link.unavailableReason ?? 'No financial cells are linked to this claim.'}</span>
        )}
        <small>Select the claim to pin its evidence.</small>
      </span>
    </span>
  );
}

export function TranscriptEvidence({
  evaluation,
  links,
  cells,
  selectedClaimId,
  onSelect,
  registerClaim,
  registerTurn,
}: {
  evaluation: EvaluationRecord;
  links: ClaimLink[];
  cells: EvidenceCell[];
  selectedClaimId: string | null;
  onSelect: (id: string) => void;
  registerClaim: (id: string, node: HTMLButtonElement | null) => void;
  registerTurn: (id: string, node: HTMLDivElement | null) => void;
}) {
  return (
    <section className="evidence-transcript" aria-label="Evidence-linked saved transcript">
      <div className="evidence-section-heading">
        <h4>Saved interview transcript</h4>
        <p>Hover, focus or select a claim to inspect its evidence.</p>
      </div>
      {evaluation.turns.map((turn, index) => {
        const turnLinks = links.filter((link) => link.turnId === turn.id);
        const spans = turnLinks
          .filter((link) => link.span !== null)
          .sort((a, b) => (a.span?.startUtf16 ?? 0) - (b.span?.startUtf16 ?? 0));
        const overlapping = spans.some((link, i) =>
          spans
            .slice(i + 1)
            .some((other) => (link.span?.endUtf16 ?? 0) > (other.span?.startUtf16 ?? 0)),
        );
        const content: ReactNode[] = [];
        let offset = 0;
        if (!overlapping)
          for (const link of spans) {
            if (!link.span) continue;
            content.push(turn.text.slice(offset, link.span.startUtf16));
            content.push(
              <ClaimPreview
                key={link.claimId}
                link={link}
                cells={cells.filter((cell) => link.cellIds.includes(cell.id))}
                selected={selectedClaimId === link.claimId}
                onSelect={onSelect}
                registerClaim={registerClaim}
              >
                {turn.text.slice(link.span.startUtf16, link.span.endUtf16)}
              </ClaimPreview>,
            );
            offset = link.span.endUtf16;
          }
        content.push(turn.text.slice(offset));
        const fallback = overlapping ? turnLinks : turnLinks.filter((link) => link.span === null);
        return (
          <div
            key={turn.id}
            className="evidence-turn"
            tabIndex={-1}
            ref={(node) => registerTurn(turn.id, node)}
          >
            <small>
              {turn.role === 'user' ? 'Founder' : 'June · AI interviewer'} · Turn {index + 1}
            </small>
            <p>{content}</p>
            {fallback.length > 0 && (
              <div className="evidence-turn-claims">
                <small>
                  {overlapping
                    ? 'Overlapping claims: choose one to inspect.'
                    : 'Exact highlight unavailable or repeated; inspect this turn’s claims.'}
                </small>
                {fallback.map((link) => (
                  <ClaimPreview
                    key={link.claimId}
                    link={link}
                    cells={cells.filter((cell) => link.cellIds.includes(cell.id))}
                    selected={selectedClaimId === link.claimId}
                    onSelect={onSelect}
                    registerClaim={registerClaim}
                  >
                    Inspect claim:{' '}
                    {evaluation.report?.extraction.claims.find((c) => c.id === link.claimId)?.quote}
                  </ClaimPreview>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
