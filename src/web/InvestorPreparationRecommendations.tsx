import { useEffect, useState } from 'react';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationView,
} from '../contracts/ConnectedPreparation.js';
import { request } from './ApiClient.js';
import { InvestorPreparationRecommendations } from './InvestorRecommendationCards.js';

/** Same saved-data recommendation projection as the Overview checklist; no generation on reads. */
export function InvestorPreparationRecommendationPanel({ revision }: { revision: number }) {
  const [view, setView] = useState<ConnectedPreparationView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void request('/preparation-loop', connectedPreparationViewSchema, undefined, 'GET')
      .then((result) => {
        if (!cancelled) {
          setView(result);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Preparation recommendations could not load. Your investor research remains available.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return (
    <>
      {error && <p role="status">{error}</p>}
      {view && (
        <>
          <InvestorPreparationRecommendations view={view} />
          {view.cycle && (
            <p className="loop-method">
              <a href="/?preparationStep=investor">Continue your preparation plan on Overview →</a>
            </p>
          )}
        </>
      )}
    </>
  );
}
