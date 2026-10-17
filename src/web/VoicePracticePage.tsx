import { useEffect, useState } from 'react';
import type { StateResponse } from '../contracts/Workspace.js';
import { fetchState, startLocalSession } from './ApiClient.js';
import { VoicePractice } from './VoicePractice.js';

/** Independent entrypoint while onboarding and context assembly are developed separately. */
export function VoicePracticePage() {
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
      if (polling) {
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
          <div className="eyebrow">June · Practice room</div>
          <h1>Start talking. Keep the conversation.</h1>
          <p className="muted">Voice practice is ready independently of company setup.</p>
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
        <VoicePractice state={state} onRefresh={refresh} onError={setError} />
      ) : (
        <p role="status">Loading voice practice…</p>
      )}
    </main>
  );
}
