import { useState } from 'react';
import type { StateResponse } from '../contracts/Workspace.js';
import { meetingInputSchema } from '../contracts/Onboarding.js';
import { command } from './ApiClient.js';

/** Meeting context lives beside investor signals; earlier briefs and recordings stay intact. */
export function InvestorMeetingContext({
  state,
  onRefresh,
  onPrepare,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onPrepare: () => void;
}) {
  const meeting = state.workspace.onboarding.meeting;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="investor-meeting-context">
      <div className="prep-heading">
        <div>
          <span className="eyebrow">Your investor conversation</span>
          <h2>
            {meeting?.name || meeting?.firm || 'Add context when you have a conversation lined up.'}
          </h2>
          {meeting && (
            <p>
              {meeting.firm} {meeting.date ? `· ${meeting.date}` : ''}
            </p>
          )}
        </div>
        <div className="prep-buttons">
          <button className="button secondary" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel editing' : meeting ? 'Edit conversation' : 'Add conversation'}
          </button>
          {meeting && (
            <button className="button" onClick={onPrepare}>
              Prepare for this investor
            </button>
          )}
        </div>
      </div>
      {meeting?.notes && (
        <details>
          <summary>Conversation notes</summary>
          <p className="preserve-lines">{meeting.notes}</p>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && (
        <form
          key={meeting?.revision ?? 'new'}
          className="prep-goal-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const parsed = meetingInputSchema.safeParse({
              name: values.get('name'),
              firm: values.get('firm'),
              date: values.get('date') || null,
              notes: values.get('notes'),
              links: {
                linkedin: values.get('linkedin') || null,
                x: values.get('x') || null,
                website: values.get('website') || null,
              },
            });
            if (!parsed.success) {
              setError('Check the date and public profile links.');
              return;
            }
            setBusy(true);
            setError('');
            void command('/investor-meeting', { meeting: parsed.data }, 'PUT')
              .then(onRefresh)
              .then(() => setEditing(false))
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : 'Cannot save conversation.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Investor name
            <input name="name" maxLength={100} defaultValue={meeting?.name} />
          </label>
          <label>
            Firm
            <input name="firm" maxLength={100} defaultValue={meeting?.firm} />
          </label>
          <label>
            Conversation date · optional
            <input name="date" type="date" defaultValue={meeting?.date ?? ''} />
          </label>
          <label className="prep-full">
            Questions or notes · optional
            <textarea name="notes" maxLength={5000} defaultValue={meeting?.notes} />
          </label>
          <details className="prep-full">
            <summary>Profile links · optional</summary>
            <div className="prep-goal-form">
              {(['linkedin', 'x', 'website'] as const).map((key) => (
                <label key={key}>
                  {key === 'x' ? 'X' : key === 'linkedin' ? 'LinkedIn' : 'Website'}
                  <input name={key} type="url" defaultValue={meeting?.links[key] ?? ''} />
                </label>
              ))}
            </div>
          </details>
          <button className="button prep-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save conversation'}
          </button>
        </form>
      )}
    </section>
  );
}
