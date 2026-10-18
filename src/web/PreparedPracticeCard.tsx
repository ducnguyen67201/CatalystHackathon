import type { ConnectedPreparationView } from '../contracts/ConnectedPreparation.js';
import { practiceHref } from '../contracts/ScenarioNavigation.js';

type ReadyScenario = NonNullable<ConnectedPreparationView['generation']>['scenarios'][number];

export function PreparedPracticeCard({
  generationId,
  scenario,
  targetId,
  disabled,
  mode,
}: {
  generationId: string;
  scenario: ReadyScenario;
  targetId: string | null;
  disabled: boolean;
  mode?: 'demo' | 'live' | undefined;
}) {
  const href =
    practiceHref({ generationId, scenarioId: scenario.id }) +
    (targetId ? `&targetId=${encodeURIComponent(targetId)}` : '');
  return (
    <section className="prepared-practice" aria-label="Ready for AI interview">
      <div className="prepared-practice-heading">
        <span>{mode === 'demo' ? 'Template practice ready' : 'Practice ready'}</span>
        <h3>{scenario.title}</h3>
      </div>
      {scenario.openingQuestion && (
        <div className="prepared-practice-question">
          <h4>Your first question</h4>
          <p>{scenario.openingQuestion}</p>
        </div>
      )}
      {scenario.answerGuide && (
        <div className="prepared-practice-answer">
          <h4>Suggested starting answer</h4>
          <p className="prepared-practice-basis">
            Prepared from your approved company story. You can use your own words.
          </p>
          {scenario.answerGuide.fictional && (
            <span className="loop-tag">Fictional demo evidence</span>
          )}
          <p className="prepared-practice-answer-text">{scenario.answerGuide.text}</p>
          <details>
            <summary>What to cover</summary>
            <ul>
              {scenario.answerGuide.checkpoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {disabled ? (
        <button className="button" disabled>
          Start AI interview →
        </button>
      ) : (
        <a className="button" href={href}>
          Start AI interview →
        </a>
      )}
      <p className="prepared-practice-hint">
        The AI asks; you respond. Your answers drive feedback and progress.
      </p>
    </section>
  );
}
