"use client";

import { useActionState, useEffect, useRef } from "react";
import { addCampPlayerAction, type FormState } from "./actions";

const initialState: FormState = {};

// The "add a player to this camp" form. `campId` scopes the insert to the
// currently selected camp; on success the form resets so the next player can be
// entered right away.
export default function AddCampPlayerForm({ campId }: { campId: number }) {
  const [state, formAction, pending] = useActionState(
    addCampPlayerAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="player-form">
      {/* The hidden campId keys the insert; keep it in sync as the selected
          camp changes by using the id as the form's React key upstream. */}
      <input type="hidden" name="campId" value={campId} />

      <div className="player-grid">
        <div className="field">
          <label htmlFor="camp-player-name">Player Name *</label>
          <input
            id="camp-player-name"
            name="player_name"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. Jordan Smith"
          />
        </div>

        <div className="field">
          <label htmlFor="camp-player-parent-name">Parent Name</label>
          <input
            id="camp-player-parent-name"
            name="parent_name"
            type="text"
            autoComplete="off"
            placeholder="e.g. Alex Smith"
          />
        </div>

        <div className="field">
          <label htmlFor="camp-player-parent-contact">Parent Contact</label>
          <input
            id="camp-player-parent-contact"
            name="parent_contact"
            type="text"
            autoComplete="off"
            placeholder="Phone or email"
          />
        </div>

        <div className="field">
          <label htmlFor="camp-player-location">Location</label>
          <input
            id="camp-player-location"
            name="location"
            type="text"
            autoComplete="off"
            placeholder="e.g. Johnstown, PA"
          />
        </div>
      </div>

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add player"}
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
