"use client";

import { useActionState, useEffect, useRef } from "react";
import { addFundraiserAction, type FormState } from "./actions";

const initialState: FormState = {};

// The "create a fundraiser" form. On success it resets so the next fundraiser
// can be typed in right away; the new fundraiser appears in the list beside it
// (and in the Log-fundraising dropdown) after revalidation.
export default function CreateFundraiser() {
  const [state, formAction, pending] = useActionState(
    addFundraiserAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="player-form">
      <div className="player-grid">
        <div className="field">
          <label htmlFor="fund-name">Fundraiser Name *</label>
          <input
            id="fund-name"
            name="name"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. Spring Car Wash"
          />
        </div>

        <div className="field">
          <label htmlFor="fund-goal">Goal</label>
          <input
            id="fund-goal"
            name="goal"
            type="number"
            min={0}
            step="0.01"
            autoComplete="off"
            placeholder="2000.00"
          />
        </div>

        <div className="field">
          <label htmlFor="fund-date">Date</label>
          <input id="fund-date" name="event_date" type="date" autoComplete="off" />
        </div>
      </div>

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add fundraiser"}
        </button>
        {state?.error ? (
          <p className="error player-form-msg" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
