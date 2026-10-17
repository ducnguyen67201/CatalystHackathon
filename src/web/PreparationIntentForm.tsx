import { useState } from 'react';

export function PreparationIntentForm({
  intent,
  busy,
  onSave,
}: {
  intent: string;
  busy: boolean;
  onSave: (intent: string) => Promise<void>;
}) {
  const [value, setValue] = useState(intent || 'I want to raise my next round');
  return (
    <form
      className="prep-intent-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value);
      }}
    >
      <label>
        What do you want to achieve?
        <input
          required
          maxLength={1000}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="I want to raise my next round"
        />
      </label>
      <button className="button" disabled={busy || !value.trim()}>
        {busy ? 'Preparing…' : 'Build my preparation plan →'}
      </button>
      <p className="muted">
        June uses your saved company and financial evidence. You can add a round, deadline or
        investor later.
      </p>
    </form>
  );
}
