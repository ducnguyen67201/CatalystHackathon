import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
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
import { recoverSavedRead } from './RecoverSavedRead.js';

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
  const [waiting, setWaiting] = useState(false);
  const [retry, setRetry] = useState(0);
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
    setGeneration(null);
    setError('');
    setWaiting(false);
    if (!selection) return;
    return recoverSavedRead(
      () =>
        request(
          '/scenario-generations/' + encodeURIComponent(selection.generationId),
          generationViewSchema,
          undefined,
          'GET',
        ),
      (result) => {
        setWaiting(false);
        if (
          result.status !== 'succeeded' ||
          !result.output?.scenarios.some((item) => item.id === selection.scenarioId)
        ) {
          setError('This saved scenario is unavailable. Choose a scenario from the table.');
          return;
        }
        setGeneration(result);
      },
      (caught) => {
        setWaiting(false);
        setError(caught instanceof Error ? caught.message : 'Could not load this scenario.');
      },
      () => setWaiting(true),
    );
  }, [selection?.generationId, selection?.scenarioId, retry]);

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
            {error}{' '}
            <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
              Retry loading scenario
            </button>
          </p>
        )}
        {route.kind === 'scenario' && !ready && !error && (
          <p role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />{' '}
            {waiting
              ? 'Waiting for June’s API. Your saved scenario will retry automatically…'
              : 'Loading your saved scenario…'}
          </p>
        )}
        {scenario && (
          <p className="muted">
            Live questions and answer guidance appear as you talk in either interview format. Open
            Why? to explore the explanation and saved evidence.
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
        <details className="practice-context-disclosure">
          <summary>Inspect the saved scenario and source context</summary>
          <ScenarioDetails generation={generation} scenario={scenario} />
        </details>
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
