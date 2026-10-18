import { useState } from 'react';
import { CheckCircle2, TrendingUp, Target, LoaderCircle } from 'lucide-react';
import type { GoalJourneyView, GoalPracticeUpdate } from '../contracts/GoalJourney.js';

const statusLabels: Record<GoalPracticeUpdate['status'], string> = {
  awaiting_transcript: 'Waiting for final transcript',
  queued: 'Assessing your answers…',
  ready: 'Assessment ready',
  failed: 'Assessment needs a retry',
  skipped: 'Assessment unavailable',
  unavailable: 'No completed assessment',
};

export function GoalPracticeFeedback({ data }: { data: GoalJourneyView }) {
  const [targetId, setTargetId] = useState('');
  const activeTargets = data.targets.filter((target) => target.status === 'active');
  const latestTargetId = [...data.practiceUpdates].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0]?.targetId;
  const chosen =
    activeTargets.find((target) => target.id === targetId) ??
    activeTargets.find((target) => target.id === latestTargetId) ??
    activeTargets.find((target) => target.id === data.journey?.focusedTargetId) ??
    activeTargets[0];
  const feedback = data.practiceUpdates.find((update) => update.targetId === chosen?.id);
  return (
    <section className="goal-practice-feedback" aria-label="Practice feedback by investor">
      <div className="goal-heading">
        <div>
          <div className="eyebrow">Your latest practice</div>
          <h3>{chosen ? `Preparing for ${chosen.name}` : 'Your next conversation'}</h3>
          {chosen?.track && (
            <small>
              {chosen.track.completed}/{chosen.track.required} investor steps reviewed
              {chosen.included ? '' : ' · outside current plan'}
            </small>
          )}
        </div>
        {activeTargets.length > 1 && (
          <label>
            Investor
            <select value={chosen?.id ?? ''} onChange={(event) => setTargetId(event.target.value)}>
              {activeTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                  {target.included ? '' : ' · outside plan'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!feedback ? (
        <p className="muted">
          {chosen
            ? `No saved call for ${chosen.name} yet. Your first assessment will appear here.`
            : 'Choose a target investor, then practise to see your feedback here.'}
        </p>
      ) : (
        <>
          <div className="goal-feedback-status" role="status">
            {['awaiting_transcript', 'queued'].includes(feedback.status) && (
              <LoaderCircle className="goal-feedback-spinner" size={16} aria-hidden="true" />
            )}
            <span>
              {statusLabels[feedback.status]}
              {feedback.partial ? ' · Partial call' : ''}
              {feedback.fictional ? ' · Fictional evidence' : ''}
            </span>
          </div>
          {feedback.status === 'awaiting_transcript' && (
            <p className="muted">
              Your call ended. Feedback appears after the provider delivers the final transcript
              containing your answers.
            </p>
          )}
          {feedback.assessedSessionId && (
            <>
              <p className="goal-feedback-summary">{feedback.summary}</p>
              {feedback.sessionId !== feedback.assessedSessionId && (
                <small>
                  Showing the last completed assessment. The latest call status appears above.
                </small>
              )}
              {feedback.outdated && (
                <p className="muted">
                  From an earlier preparation cycle. Review your current brief before another full
                  interview.
                </p>
              )}
              <div className="goal-feedback-grid">
                <article>
                  <CheckCircle2 size={20} aria-hidden="true" />
                  <h4>What went well</h4>
                  {feedback.strengths.length ? (
                    <ul>
                      {feedback.strengths.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No strengths recorded in this assessment yet.</p>
                  )}
                </article>
                <article>
                  <TrendingUp size={20} aria-hidden="true" />
                  <h4>What improved</h4>
                  {feedback.improvements.length ? (
                    <ul>
                      {feedback.improvements.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Complete a targeted retry to see evidence of improvement.</p>
                  )}
                </article>
                <article>
                  <Target size={20} aria-hidden="true" />
                  <h4>Practise next</h4>
                  <p>
                    {feedback.nextPractice?.question ??
                      (feedback.outdated
                        ? 'Continue preparation with your current story and brief.'
                        : 'Review your assessment and decide your next preparation step.')}
                  </p>
                  {feedback.nextPractice && (
                    <a className="text-button" href={feedback.nextPractice.href}>
                      Practise this improvement →
                    </a>
                  )}
                </article>
              </div>
              {feedback.assessedAt && (
                <small>Assessment saved {new Date(feedback.assessedAt).toLocaleString()}</small>
              )}
            </>
          )}
          <a className="text-button" href={feedback.reviewHref}>
            {feedback.assessedSessionId ? 'View saved feedback & call history' : 'View call status'}{' '}
            →
          </a>
        </>
      )}
    </section>
  );
}

export function GoalRadarOpportunities({
  items,
}: {
  items: GoalJourneyView['radarOpportunities'];
}) {
  if (!items.length) return null;
  return (
    <section className="goal-radar-opportunities" aria-label="New investor opportunities">
      <div className="goal-heading">
        <div>
          <div className="eyebrow">From your radar</div>
          <h3>Other investors to consider</h3>
        </div>
      </div>
      <p className="muted">
        Review a new lead without interrupting your current practice. Choosing another investor adds
        its own brief and practice track.
      </p>
      {items.map((item) => (
        <article key={item.eventId}>
          <div>
            <strong>{item.name}</strong>
            {item.fictional && <small>Fictional evidence</small>}
            <p>{item.headline}</p>
          </div>
          <a className="button secondary" href={item.href}>
            Review investor →
          </a>
        </article>
      ))}
    </section>
  );
}
