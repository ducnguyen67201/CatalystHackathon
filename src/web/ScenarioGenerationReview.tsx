import { useEffect, useRef, useState } from 'react';
import {
  generationSchema,
  scenarioPreviewSchema,
  type ScenarioGeneration,
  type ScenarioPreview,
} from '../contracts/Scenario.js';
import { request } from './ApiClient.js';
import { ScenarioSourcesView } from './ScenarioSourcesView.js';

export function ScenarioGenerationReview({
  investorId,
  objective,
  onClose,
  onGenerated,
}: {
  investorId: string;
  objective: string;
  onClose: () => void;
  onGenerated: (generation: ScenarioGeneration) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setPreview(null);
    key.current = crypto.randomUUID();
    void request('/scenario-generations/preview', scenarioPreviewSchema, { investorId, objective })
      .then((result) => {
        if (alive) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (alive)
          setError(
            caught instanceof Error ? caught.message : 'Could not prepare your source preview.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [investorId, objective, revision]);
  async function generate() {
    if (!preview || busy || loading) return;
    setBusy(true);
    setError('');
    try {
      const result = await request('/scenario-generations', generationSchema, {
        investorId,
        objective,
        key: key.current,
        expectedInputHash: preview.inputHash,
      });
      onGenerated(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not generate. Retry or refresh the source preview.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="scenario-review-dialog"
      ref={dialog}
      aria-labelledby="scenario-review-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="scenario-drawer-content">
        <header className="scenario-drawer-header">
          <div>
            <div className="eyebrow">Before you generate</div>
            <h2 id="scenario-review-title">Here’s what June will use.</h2>
          </div>
          <button
            className="button secondary"
            aria-label="Close data review"
            disabled={busy}
            onClick={() => {
              dialog.current?.close();
            }}
          >
            ✕
          </button>
        </header>
        <div className="scenario-drawer-body">
          <p>
            New scenarios use your current saved context. Your existing scenarios and their original
            sources stay unchanged.
          </p>
          {loading && <p role="status">Gathering your current sources…</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <>
              <div className="scenario-review-summary">
                <div>
                  <span className="eyebrow">Selected investor</span>
                  <h3>{preview.input.investor.name}</h3>
                </div>
                <span className="scenario-badge">
                  {preview.input.sources.length} sources included
                </span>
              </div>
              <p>
                <strong>Your focus:</strong>{' '}
                {preview.input.objective || 'Use the saved company goal and available evidence.'}
              </p>
              <p className="muted">
                Data checked {new Date(preview.input.capturedAt).toLocaleString()}. Only the
                included content below is used.
              </p>
              <p className="notice">
                {preview.mode === 'demo'
                  ? 'Template mode: no live model call. Template exercises may repeat once the available variations are exhausted.'
                  : 'Generating sends this reviewed content to the configured AI provider.'}
              </p>
              {preview.input.sources.some((source) => source.provenance === 'fictional_demo') && (
                <p className="notice">
                  Includes fictional demo evidence. These sources are labeled below.
                </p>
              )}
              <ScenarioSourcesView input={preview.input} />
            </>
          )}
        </div>
        <footer className="scenario-drawer-footer">
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={() => {
              setRevision((value) => value + 1);
            }}
          >
            Refresh data
          </button>
          <button
            className="button"
            disabled={!preview || busy || loading}
            onClick={() => {
              void generate();
            }}
          >
            {busy ? 'Queuing…' : 'Generate with this data'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
