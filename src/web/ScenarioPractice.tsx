import { useEffect, useRef, useState } from 'react';
import {
  generationListSchema,
  type ScenarioGenerationView,
  type GeneratedScenario,
} from '../contracts/Scenario.js';
import { practiceHref } from '../contracts/ScenarioNavigation.js';
import type { StateResponse } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { ScenarioGenerationReview } from './ScenarioGenerationReview.js';
import { ScenarioDetails } from './ScenarioDetails.js';
import './ScenarioPractice.css';

export function ScenarioPractice({ state }: { state: StateResponse }) {
  const investors = state.workspace.investors;
  const [investorId, setInvestorId] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('investor');
    return (
      investors.find((item) => item.id === requested)?.id ??
      state.workspace.onboarding.meeting?.investorId ??
      investors[0]?.id ??
      ''
    );
  });
  const [objective, setObjective] = useState(() =>
    (new URLSearchParams(window.location.search).get('objective') ?? '').slice(0, 1000),
  );
  const [generations, setGenerations] = useState<ScenarioGenerationView[]>([]);
  const [selected, setSelected] = useState<{
    generation: ScenarioGenerationView;
    scenario: GeneratedScenario;
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = generations.some((item) => item.status === 'queued' || item.status === 'running');
  const rows = generations.flatMap(
    (generation) =>
      generation.output?.scenarios.map((scenario) => ({ generation, scenario })) ?? [],
  );

  useEffect(() => {
    if (!investorId) {
      setLoading(false);
      return;
    }
    let alive = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const list = await request(
          '/investors/' + encodeURIComponent(investorId) + '/scenario-generations',
          generationListSchema,
          undefined,
          'GET',
        );
        if (alive) {
          setGenerations(list);
          setLoadError('');
        }
      } catch (caught) {
        if (alive)
          setLoadError(caught instanceof Error ? caught.message : 'Could not load scenarios.');
      } finally {
        polling = false;
        if (alive) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [investorId]);

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);

  return (
    <section className="scenario-workspace" aria-label="Scenario preparation">
      <div className="scenario-heading">
        <div>
          <div className="eyebrow">From research to rehearsal</div>
          <h2>Practice scenario</h2>
          <p className="muted">A focused conversation, built from the information you have.</p>
        </div>
        <span className="scenario-badge">
          {state.capabilities.scenarioMode === 'demo'
            ? 'Template generation'
            : 'AI scenario generation'}
        </span>
      </div>
      {investors.length ? (
        <div className="scenario-controls">
          <label>
            Investor
            <select
              value={investorId}
              disabled={reviewing}
              onChange={(event) => {
                setInvestorId(event.target.value);
                setGenerations([]);
                setLoading(true);
              }}
            >
              {investors.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Practice objective{' '}
            <input
              value={objective}
              maxLength={1000}
              disabled={reviewing}
              placeholder="What would you like to get better at?"
              onChange={(event) => {
                setObjective(event.target.value);
              }}
            />
          </label>
          <button
            className="button"
            disabled={reviewing || loading || pending || !state.capabilities.scenarioReady}
            onClick={() => {
              setReviewing(true);
            }}
          >
            {pending
              ? 'Generating…'
              : rows.length
                ? 'Generate more scenarios'
                : 'Generate scenarios'}
          </button>
        </div>
      ) : (
        <p className="notice">Add an investor in Investor research to generate scenarios.</p>
      )}
      <p className="muted scenario-input-note">
        Review the company context, investor research, financial CSVs and previous practice that
        will shape your next scenarios.
      </p>
      {!state.capabilities.scenarioReady && (
        <p className="notice">Scenario generation is unavailable in this runtime.</p>
      )}
      {state.capabilities.scenarioMode === 'live' && (
        <p className="muted">Generate sends this context to the configured AI provider.</p>
      )}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {pending && (
        <p className="notice" role="status">
          Building your scenarios… They will appear in the table when ready.
        </p>
      )}
      {generations
        .filter((item) => item.status === 'failed')
        .map((item) => (
          <p className="error" key={item.id}>
            Generation failed: {item.error} Generate again to retry.
          </p>
        ))}
      <div className="scenario-table-heading">
        <h3>
          Your scenarios <span className="muted">{rows.length}</span>
        </h3>
        <a href="/practice" className="text-button">
          Open practice room →
        </a>
      </div>
      <div className="scenario-table-wrap">
        <table className="scenario-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Investor</th>
              <th scope="col">Context</th>
              <th scope="col">Generated</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.generation.id + row.scenario.id}
                onClick={() => {
                  setSelected(row);
                }}
              >
                <td>
                  <button
                    className="scenario-row-title"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setSelected(row);
                    }}
                  >
                    {row.scenario.title}
                  </button>
                  <p>{row.scenario.objective}</p>
                </td>
                <td>{row.generation.input.investor.name}</td>
                <td>
                  <span className="scenario-badge">
                    {row.scenario.personalization === 'limited_context'
                      ? 'Limited context'
                      : 'Research grounded'}
                  </span>
                  <small>
                    {row.generation.mode === 'demo' ? 'Template exercise' : 'AI generated'}
                    {row.generation.outdated ? ' · Update available' : ''}
                  </small>
                </td>
                <td>
                  {new Date(row.generation.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                <td aria-hidden="true">↗</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="scenario-empty" role="status">
            {loading
              ? 'Loading saved scenarios…'
              : pending
                ? 'Your first scenarios are on their way.'
                : 'No scenarios yet. Choose an investor and generate your first practice plan.'}
          </p>
        )}
      </div>
      <p className="muted">
        <small>Showing scenarios from the latest 20 generations for this investor.</small>
      </p>
      {reviewing && (
        <ScenarioGenerationReview
          investorId={investorId}
          objective={objective}
          onClose={() => {
            setReviewing(false);
          }}
          onGenerated={(result) => {
            setGenerations((current) =>
              [
                { ...result, outdated: false },
                ...current.filter((item) => item.id !== result.id),
              ].slice(0, 20),
            );
            setReviewing(false);
          }}
        />
      )}
      <dialog
        ref={dialog}
        className="scenario-drawer"
        aria-labelledby="scenario-drawer-title"
        onClose={() => {
          setSelected(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {selected && (
          <div className="scenario-drawer-content">
            <header className="scenario-drawer-header">
              <div>
                <div className="eyebrow">
                  Scenario details · {selected.generation.input.investor.name}
                </div>
                <h2 id="scenario-drawer-title">{selected.scenario.title}</h2>
              </div>
              <button
                className="button secondary"
                aria-label="Close scenario details"
                onClick={() => {
                  dialog.current?.close();
                }}
              >
                ✕
              </button>
            </header>
            <div className="scenario-drawer-body">
              <ScenarioDetails generation={selected.generation} scenario={selected.scenario} />
            </div>
            <footer className="scenario-drawer-footer">
              <span className="muted">Your scenario and source context come with you.</span>
              <a
                className="button"
                href={practiceHref({
                  generationId: selected.generation.id,
                  scenarioId: selected.scenario.id,
                })}
              >
                Start Practicing →
              </a>
            </footer>
          </div>
        )}
      </dialog>
    </section>
  );
}
