import { useEffect, useState } from 'react';
import {
  generationViewSchema,
  type ScenarioGenerationView,
  type ScenarioSelection,
} from '../contracts/Scenario.js';
import { practiceHref, readScenarioRoute } from '../contracts/ScenarioNavigation.js';
import type { StateResponse } from '../contracts/Workspace.js';
import { request } from './ApiClient.js';
import { ScenarioDetails } from './ScenarioDetails.js';
import { VoicePractice } from './VoicePractice.js';
import { VoiceRoom } from './VoiceRoom.js';

export function ScenarioRoom({
  state,
  onRefresh,
  onError,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [route, setRoute] = useState(() => readScenarioRoute(window.location.search));
  const [generation, setGeneration] = useState<ScenarioGenerationView | null>(null);
  const [error, setError] = useState('');
  const selection = route.kind === 'scenario' ? route.selection : undefined;
  const scenario =
    generation?.id === selection?.generationId
      ? generation?.output?.scenarios.find((item) => item.id === selection?.scenarioId)
      : undefined;
  const ready =
    route.kind === 'open' ||
    (route.kind === 'scenario' && !!scenario && generation?.status === 'succeeded');
  const brief = state.workspace.briefs[0];

  useEffect(() => {
    const update = () => {
      setRoute(readScenarioRoute(window.location.search));
    };
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('popstate', update);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setGeneration(null);
    setError('');
    if (!selection) return;
    void request(
      '/scenario-generations/' + encodeURIComponent(selection.generationId),
      generationViewSchema,
      undefined,
      'GET',
    )
      .then((result) => {
        if (!alive) return;
        if (
          result.status !== 'succeeded' ||
          !result.output?.scenarios.some((item) => item.id === selection.scenarioId)
        ) {
          setError('This saved scenario is unavailable. Choose a scenario from the table.');
          return;
        }
        setGeneration(result);
      })
      .catch((caught: unknown) => {
        if (alive)
          setError(caught instanceof Error ? caught.message : 'Could not load this scenario.');
      });
    return () => {
      alive = false;
    };
  }, [selection?.generationId, selection?.scenarioId]);

  function selectSaved(next: ScenarioSelection | undefined) {
    window.history.replaceState(null, '', next ? practiceHref(next) : '/practice');
    setRoute(next ? { kind: 'scenario', selection: next } : { kind: 'open' });
  }

  return (
    <>
      <a
        className="text-button"
        href={
          '/scenarios' +
          (generation ? '?investor=' + encodeURIComponent(generation.input.investor.id) : '')
        }
      >
        ← Back to scenarios
      </a>
      <section className="scenario-room-brief panel">
        <div className="eyebrow">
          {generation ? 'Practice with ' + generation.input.investor.name : 'Practice room'}
        </div>
        <h2>
          {scenario?.title ??
            (route.kind === 'open' ? 'Open conversation' : 'Your selected scenario')}
        </h2>
        {scenario && <p>{scenario.objective}</p>}
        {route.kind === 'open' && (
          <p>
            Start an open conversation, or choose a saved scenario to rehearse a specific situation.
          </p>
        )}
        {route.kind === 'invalid' && (
          <p className="error" role="alert">
            This scenario link is incomplete or invalid. Choose a scenario from the table.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {route.kind === 'scenario' && !ready && !error && (
          <p role="status">Loading the saved scenario and its source context…</p>
        )}
        {scenario && (
          <p className="muted">
            The interviewer receives this saved scenario, investor profile, and source snapshot when
            you start the session.
          </p>
        )}
      </section>
      <VoicePractice
        state={state}
        onRefresh={onRefresh}
        onError={onError}
        selection={selection}
        onSelection={selectSaved}
        startDisabled={!ready || !!error}
      />
      {scenario && generation && (
        <section aria-label="Scenario context">
          <h2>Your scenario context</h2>
          <ScenarioDetails generation={generation} scenario={scenario} />
        </section>
      )}
      {route.kind === 'open' && brief && (
        <details className="scenario-sources">
          <summary>Existing written practice with a financial brief</summary>
          <VoiceRoom
            state={state}
            brief={brief}
            onRefresh={onRefresh}
            onError={onError}
            onBrief={() => {
              window.location.href = '/';
            }}
          />
        </details>
      )}
    </>
  );
}
