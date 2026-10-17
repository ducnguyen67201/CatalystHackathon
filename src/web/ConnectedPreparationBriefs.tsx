import { useEffect, useState } from 'react';
import type { StateResponse } from '../contracts/Workspace.js';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationView,
} from '../contracts/ConnectedPreparation.js';
import { request } from './ApiClient.js';
import './ConnectedPreparation.css';

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
        These use the exact reviewed pitch. Other saved meeting briefs appear in the table below.
      </p>
      <div className="loop-comparison-scroll">
        <table className="loop-comparison">
          <thead>
            <tr>
              <th>Investor</th>
              <th>Story</th>
              <th>Review state</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {view.history
              .filter((cycle) => cycle.brief)
              .map((cycle) => {
                const current = cycle.id === view.cycle?.id;
                const pitch = view.historyPitches.find((item) => item.id === cycle.pitchId);
                return (
                  <tr key={cycle.id}>
                    <td>
                      {state.workspace.investors.find(
                        (investor) => investor.id === cycle.investorId,
                      )?.name ?? 'Earlier selected investor'}
                    </td>
                    <td>
                      Pitch v{pitch?.revision ?? 'unknown'}
                      {pitch?.fictional && (
                        <span className="loop-tag">Fictional demo evidence</span>
                      )}
                    </td>
                    <td>
                      {current
                        ? view.outdated
                          ? 'Sources changed'
                          : cycle.briefApprovedAt
                            ? 'Approved'
                            : 'Needs review'
                        : 'Historical brief'}
                      <details>
                        <summary>Saved content</summary>
                        <p className="loop-prose">{cycle.brief}</p>
                      </details>
                    </td>
                    <td>
                      <a
                        className="button secondary"
                        href={`/?preparationStep=brief&preparationCycleId=${encodeURIComponent(cycle.id)}`}
                      >
                        {current ? 'Continue preparation' : 'Inspect cycle history'} →
                      </a>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
