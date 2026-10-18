import { useState } from 'react';
import {
  preparationGoalInputSchema,
  preparationIntentSchema,
  type PreparationView,
} from '../contracts/FundraisingPreparation.js';
import type { StateResponse } from '../contracts/Workspace.js';
import { investorCheckRangeSchema } from '../contracts/InvestorMatch.js';

export function PreparationGoalEditor({
  data,
  state,
  busy,
  save,
  onEditContext,
}: {
  data: PreparationView;
  state: StateResponse;
  busy: boolean;
  save: (body: unknown) => Promise<void>;
  onEditContext: () => void;
}) {
  const [initial] = useState(data);
  const goal = initial.goal;
  const [error, setError] = useState('');
  return (
    <form
      className="simple-goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const intent = preparationIntentSchema.safeParse(values.get('intent'));
        const minimum = values.get('desiredCheckMin');
        const maximum = values.get('desiredCheckMax');
        const check =
          minimum || maximum
            ? investorCheckRangeSchema.safeParse({
                min: minimum,
                max: maximum,
                currency: values.get('desiredCheckCurrency'),
              })
            : null;
        if (check && !check.success) {
          setError(
            'Enter both individual check amounts, with a positive minimum no greater than the maximum.',
          );
          return;
        }
        const previous = values.get('previousRounds');
        const parsed = preparationGoalInputSchema.safeParse({
          round: values.get('round'),
          previousRounds: previous ? Number(previous) : null,
          amount: values.get('amount') || null,
          currency: values.get('currency'),
          targetDate: values.get('targetDate') || null,
          timezone: values.get('timezone'),
          investorId: goal?.investorId ?? null,
          desiredCheck: check?.success ? check.data : null,
        });
        if (!intent.success || !parsed.success) {
          setError('Check your goal, round, amounts, date and timezone.');
          return;
        }
        setError('');
        void save({
          intent: intent.data,
          goal: parsed.data,
          version: initial.version,
          profileVersion: initial.profileVersion,
        });
      }}
    >
      <label>
        What do you want to achieve?
        <textarea
          name="intent"
          required
          maxLength={1000}
          defaultValue={initial.intent}
          placeholder="Raise our pre-seed round and prepare for investor conversations"
          rows={3}
        />
      </label>
      <p className="muted">
        June uses this goal to match investors, prepare your brief and track your practice.
      </p>
      <details className="journey-details">
        <summary>Funding details · optional</summary>
        <div className="prep-goal-form">
          <label>
            Intended round
            <input
              name="round"
              required
              maxLength={100}
              placeholder="For example, Series A; or round not yet decided"
              defaultValue={goal?.round ?? state.workspace.profile.stage}
            />
          </label>
          <label>
            Prior financing rounds
            <input
              name="previousRounds"
              type="number"
              min="0"
              max="30"
              placeholder="Unknown"
              defaultValue={goal?.previousRounds ?? ''}
            />
          </label>
          <label>
            Target raise amount
            <input
              name="amount"
              inputMode="decimal"
              placeholder="Unknown"
              defaultValue={goal?.amount ?? state.workspace.profile.raiseTarget ?? ''}
            />
          </label>
          <label>
            Currency
            <select
              name="currency"
              defaultValue={goal?.currency ?? state.workspace.profile.currency}
            >
              {['unspecified', 'USD', 'CAD', 'EUR', 'GBP'].map((currency) => (
                <option key={currency} value={currency}>
                  {currency === 'unspecified' ? 'Not confirmed' : currency}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desired preparation date
            <input type="date" name="targetDate" defaultValue={goal?.targetDate ?? ''} />
          </label>
          <label>
            Desired individual check · minimum
            <input
              name="desiredCheckMin"
              inputMode="decimal"
              placeholder="Unknown"
              defaultValue={goal?.desiredCheck?.min ?? ''}
            />
          </label>
          <label>
            Desired individual check · maximum
            <input
              name="desiredCheckMax"
              inputMode="decimal"
              placeholder="Unknown"
              defaultValue={goal?.desiredCheck?.max ?? ''}
            />
          </label>
          <label>
            Individual check currency
            <select
              name="desiredCheckCurrency"
              defaultValue={goal?.desiredCheck?.currency ?? 'CAD'}
            >
              {['CAD', 'USD', 'EUR', 'GBP'].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
          <p className="muted prep-full">
            The desired investment from one investor is separate from your total raise. Leave both
            amounts empty when unknown; currencies are never automatically converted for matching.
          </p>
          <label>
            Timezone
            <input
              name="timezone"
              required
              defaultValue={goal?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
            />
          </label>
        </div>
        <p className="muted">
          Company context: {state.workspace.profile.stage} · {state.workspace.profile.sector} ·{' '}
          {state.workspace.profile.geography}
        </p>
        <button type="button" className="text-button" onClick={onEditContext}>
          Edit company context
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      <button className="button" disabled={busy}>
        {busy ? 'Saving…' : 'Save goal'}
      </button>
    </form>
  );
}
