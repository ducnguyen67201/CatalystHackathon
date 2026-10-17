import { ScenarioSourcesView } from './ScenarioSourcesView.js';
import type {
  ScenarioGenerationView,
  GeneratedScenario,
  ScenarioInput,
} from '../contracts/Scenario.js';
import './ScenarioPractice.css';
import { QuestionExplanation, scenarioWhySources } from './QuestionExplanation.js';

const label = (value: string) => value.replaceAll('_', ' ');
function EvidenceLinks({ ids, input }: { ids: string[]; input: ScenarioInput }) {
  return (
    <small className="scenario-citations">
      {ids.map((id) => {
        const index = input.sources.findIndex((source) => source.id === id);
        return (
          <a
            key={id}
            href={'#scenario-source-' + String(index)}
            onClick={(event) => {
              event.currentTarget
                .closest('.scenario-workspace')
                ?.querySelector('.scenario-sources')
                ?.setAttribute('open', '');
              document.getElementById('scenario-source-' + String(index))?.setAttribute('open', '');
            }}
          >
            Source {index + 1}{' '}
          </a>
        );
      })}
    </small>
  );
}

export function ScenarioDetails({
  generation,
  scenario,
}: {
  generation: ScenarioGenerationView;
  scenario: GeneratedScenario;
}) {
  if (!generation.output) return null;
  const profile = generation.output.investorProfile;
  return (
    <div className="scenario-workspace">
      {generation.outdated && (
        <p className="notice">
          Newer source information is available. This saved scenario keeps its original context.
        </p>
      )}
      {generation.mode === 'demo' && (
        <p className="notice">Template-generated practice exercise. No live model was used.</p>
      )}
      {generation.input.sources.some((source) => source.provenance === 'fictional_demo') && (
        <p className="notice">Includes fictional demo evidence, labeled in the source snapshot.</p>
      )}
      <div className="scenario-layout">
        <article className="panel scenario-detail">
          <div className="eyebrow">Full practice scenario</div>
          <h3>{scenario.title}</h3>
          <span className="scenario-badge">{label(scenario.personalization)}</span>
          <p>{scenario.situation}</p>
          <h4>Your objective</h4>
          <p>{scenario.objective}</p>
          <h4>The challenge</h4>
          <p>{scenario.challenge}</p>
          <h4>Why practise this?</h4>
          {scenario.rationale.map((item, index) => (
            <div key={index}>
              <p>
                <strong>{label(item.kind)}:</strong> {item.text}
              </p>
              <EvidenceLinks ids={item.sourceIds} input={generation.input} />
            </div>
          ))}
          <h4>Opening question</h4>
          <div className="scenario-question-line">
            <blockquote>{scenario.openingQuestion}</blockquote>
            {scenario.openingWhy && (
              <QuestionExplanation
                question={scenario.openingQuestion}
                why={scenario.openingWhy}
                sources={scenarioWhySources(generation.input)}
              />
            )}
          </div>
          <h4>How the conversation can develop</h4>
          <ol>
            {scenario.branches.map((branch, index) => (
              <li key={index}>
                <strong>{branch.condition}</strong>
                <p>{branch.question}</p>
                {branch.why && (
                  <QuestionExplanation
                    question={branch.question}
                    why={branch.why}
                    sources={scenarioWhySources(generation.input)}
                  />
                )}
              </li>
            ))}
          </ol>
          <h4>A strong answer will…</h4>
          <ul>
            {scenario.successCriteria.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <h4>What is still unknown</h4>
          <ul>
            {scenario.unknowns.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          {!!scenario.clarificationQuestions.length && (
            <>
              <h4>Questions to resolve</h4>
              <ul>
                {scenario.clarificationQuestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </article>
        <aside className="panel scenario-profile">
          <div className="eyebrow">Reverse engineer the investor</div>
          <h3>{generation.input.investor.name}</h3>
          <p className="muted">Suggested approaches are hypotheses based on available context.</p>
          <h4>What the sources suggest</h4>
          {profile.themes.length ? (
            profile.themes.map((item, index) => (
              <div key={index}>
                <p>
                  <strong>{label(item.kind)}:</strong> {item.text}
                </p>
                <EvidenceLinks ids={item.sourceIds} input={generation.input} />
              </div>
            ))
          ) : (
            <p>No supported investor themes yet. Add investor research to build this profile.</p>
          )}
          <h4>Suggested rehearsal approach</h4>
          {profile.practiceApproach.map((item, index) => (
            <div key={index}>
              <p>
                <strong>Hypothesis:</strong> {item.text}
              </p>
              <EvidenceLinks ids={item.sourceIds} input={generation.input} />
            </div>
          ))}
          <h4>What we do not know</h4>
          <ul>
            {profile.unknowns.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <h4>Information used</h4>
          <ul className="scenario-coverage">
            {generation.input.coverage.map((item) => (
              <li key={item.kind}>
                <strong>{label(item.kind)}</strong> · {label(item.status)}
                <small>{item.detail}</small>
              </li>
            ))}
          </ul>
          <small>Saved {new Date(generation.createdAt).toLocaleString()}</small>
        </aside>
      </div>
      <details className="scenario-sources">
        <summary>Inspect the source snapshot ({generation.input.sources.length})</summary>
        <ScenarioSourcesView input={generation.input} />
      </details>
    </div>
  );
}
