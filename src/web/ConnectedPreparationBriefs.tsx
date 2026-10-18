import { useEffect, useState } from 'react';
import type { StateResponse } from '../contracts/Workspace.js';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationView,
} from '../contracts/ConnectedPreparation.js';
import { request } from './ApiClient.js';
import './ConnectedPreparation.css';
import { ArrowRight, FileText } from 'lucide-react';
import { summarizeTailoredBrief } from './TailoredBriefReview.js';

/** The same saved cycle briefs surfaced in the existing Meeting brief destination. */
export function ConnectedPreparationBriefs({
  state,
  onCount,
}: {
  state: StateResponse;
  onCount: (count: number) => void;
}) {
  const [view, setView] = useState<ConnectedPreparationView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void request('/preparation-loop', connectedPreparationViewSchema, undefined, 'GET')
      .then((result) => {
        if (!cancelled) {
          setView(result);
          onCount(result.history.filter((cycle) => cycle.brief).length);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.workspace.revision, onCount]);
  if (!view?.history.some((cycle) => cycle.brief)) return null;
  return (
    <section className="loop-recommendations" aria-label="Connected preparation briefs">
      <h3>Briefs from your preparation checklist</h3>
      <p className="loop-method">
        These use the exact reviewed pitch. Other saved meeting briefs appear in the cards below.
      </p>
      <div className="meeting-cycle-grid">
        {view.history
          .filter((cycle) => cycle.brief)
          .map((cycle) => {
            const current = cycle.id === view.cycle?.id;
            const pitch = view.historyPitches.find((item) => item.id === cycle.pitchId);
            const summary = summarizeTailoredBrief(cycle.brief ?? '');
            const status = current
              ? view.outdated
                ? 'Sources changed'
                : cycle.briefApprovedAt
                  ? 'Approved'
                  : 'Needs review'
              : 'Historical brief';
            return (
              <article className="meeting-cycle-card" data-current={current} key={cycle.id}>
                <header>
                  <div className="meeting-record-icon">
                    <FileText size={21} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="eyebrow">
                      {current ? 'Current preparation' : 'Saved cycle'}
                    </span>
                    <h4>
                      {state.workspace.investors.find(
                        (investor) => investor.id === cycle.investorId,
                      )?.name ?? 'Earlier selected investor'}
                    </h4>
                  </div>
                  <span className="meeting-record-status">{status}</span>
                </header>
                <div className="meeting-cycle-meta">
                  <span>Pitch v{pitch?.revision ?? 'unknown'}</span>
                  {pitch?.fictional && <span className="loop-tag">Fictional demo evidence</span>}
                </div>
                {summary.objective && (
                  <p className="meeting-cycle-objective">{summary.objective}</p>
                )}
                <div className="meeting-cycle-actions">
                  <a
                    className="button"
                    href={`/?preparationStep=brief&preparationCycleId=${encodeURIComponent(cycle.id)}`}
                  >
                    {current ? 'Continue preparation' : 'Inspect cycle history'}
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </div>
                <details className="meeting-support-details">
                  <summary>Saved content</summary>
                  <p className="loop-prose">{cycle.brief}</p>
                </details>
              </article>
            );
          })}
      </div>
    </section>
  );
}
