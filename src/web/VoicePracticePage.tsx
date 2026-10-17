import { useEffect, useState } from 'react';
import type { StateResponse } from '../contracts/Workspace.js';
import { fetchState, startLocalSession } from './ApiClient.js';
import { ScenarioPractice } from './ScenarioPractice.js';
import { ScenarioRoom } from './ScenarioRoom.js';

/** Independent entrypoint while onboarding and context assembly are developed separately. */
export function VoicePracticePage({ page = 'room' }: { page?: 'scenarios' | 'room' }) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState('');

  async function refresh(): Promise<void> {
    setState(await fetchState());
  }

  useEffect(() => {
    let mounted = true;
    let polling = false;
    void startLocalSession()
      .then(fetchState)
      .then((result) => {
        if (mounted) {
          setState(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Cannot connect to June. Start the API and database with pnpm dev.');
        }
      });

    const timer = setInterval(() => {
      if (polling || document.visibilityState === 'hidden') {
        return;
      }
      polling = true;
      void fetchState()
        .then((result) => {
          if (mounted) {
            setState(result);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main style={{ maxWidth: '1200px', padding: '32px 20px', margin: '0 auto' }}>
      <header className="page-heading">
        <div>
          <div className="eyebrow">
            June · {page === 'scenarios' ? 'Practice scenario' : 'Practice room'}
          </div>
          <h1>
            {page === 'scenarios'
              ? 'Choose your next conversation.'
              : 'Make the next conversation count.'}
          </h1>
          <p className="muted">
            {page === 'scenarios'
              ? 'Generate a scenario, explore the details, and take it into the practice room.'
              : 'Rehearse with June using your selected scenario and saved context.'}
          </p>
        </div>
        <a href="/" className="text-button">
          Open workspace →
        </a>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}{' '}
          <button
            className="text-button"
            onClick={() => {
              setError('');
            }}
          >
            Dismiss
          </button>
        </p>
      )}
      {state ? (
        page === 'scenarios' ? (
          <ScenarioPractice state={state} />
        ) : (
          <ScenarioRoom state={state} onRefresh={refresh} onError={setError} />
        )
      ) : (
        <p role="status">Loading workspace…</p>
      )}
    </main>
  );
}
