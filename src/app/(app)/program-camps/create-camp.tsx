"use client";

import { useActionState, useEffect, useRef } from "react";
import { addCampAction, type FormState } from "./actions";

const initialState: FormState = {};

// The "create a camp" form. On success it resets so the next camp can be typed
// in right away; the new camp appears in the list beside it after revalidation.
export default function CreateCamp() {
  const [state, formAction, pending] = useActionState(
    addCampAction,
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
          <label htmlFor="camp-name">Camp Name *</label>
          <input
            id="camp-name"
            name="name"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. Winter Hitting Clinic"
          />
        </div>

        <div className="field">
          <label htmlFor="camp-location">Location</label>
          <input
            id="camp-location"
            name="location"
            type="text"
            autoComplete="off"
            placeholder="e.g. Flood City Fieldhouse"
          />
        </div>

        <div className="field">
          <label htmlFor="camp-date">Date</label>
          <input id="camp-date" name="event_date" type="date" autoComplete="off" />
        </div>
      </div>

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add camp"}
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
