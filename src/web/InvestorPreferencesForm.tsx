import { useState } from 'react';
import { z } from 'zod';
import {
  InvestorType,
  investorPreferencesSchema,
  type InvestorPreferences,
} from '../contracts/InvestorDiscovery.js';
import { request } from './ApiClient.js';

export function InvestorPreferencesForm({
  preferences,
  onRefresh,
  onSaved,
}: {
  preferences: InvestorPreferences;
  onRefresh: () => Promise<void>;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [references, setReferences] = useState(preferences.referenceFirms.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="investor-preferences"
      onChange={() => setSaved(false)}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void (async () => {
          try {
            const input = investorPreferencesSchema.parse({
              ...draft,
              referenceFirms: references
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean),
            });
            await request(
              '/investors/discovery/preferences',
              z.object({ ok: z.boolean() }),
              input,
              'PUT',
            );
            setSaved(true);
            await onRefresh();
            onSaved?.();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Unable to save preferences.');
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <fieldset disabled={busy}>
        <legend>Who would you like to meet?</legend>
        <div className="investor-type-options">
          {Object.values(InvestorType).map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={draft.types.includes(type)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    types: event.target.checked
                      ? [...draft.types, type]
                      : draft.types.filter((item) => item !== type),
                  })
                }
              />
              {type}
            </label>
          ))}
        </div>
        <p className="muted">Leave all unchecked to explore every investor type.</p>
        <label className="field">
          Preferred firm size
          <select
            value={draft.firmSize}
            onChange={(event) =>
              setDraft({
                ...draft,
                firmSize: investorPreferencesSchema.shape.firmSize.parse(event.target.value),
              })
            }
          >
            {investorPreferencesSchema.shape.firmSize.unwrap().options.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Example firms · optional, up to five separated by commas
          <input
            value={references}
            maxLength={508}
            placeholder="YC, a16z"
            onChange={(event) => setReferences(event.target.value)}
          />
        </label>
        <label className="field">
          What matters to you?
          <textarea
            value={draft.priorities}
            maxLength={500}
            placeholder="For example: hands-on support, B2B experience, first-time founders"
            onChange={(event) => setDraft({ ...draft, priorities: event.target.value })}
          />
        </label>
        <p className="muted">
          These preferences guide public searches and are sent to the research providers. Keep
          private meeting notes in your meeting context. Firm size is a preference, not a verified
          check size.
        </p>
        <button className="button secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Save search preferences'}
        </button>
      </fieldset>
      {saved && <p role="status">Preferences saved. Choose Find investors to search.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
