"use client";

import { useActionState, useEffect, useRef } from "react";
import { sportLabel } from "../teams/divisions";
import { addCoachAction, type FormState } from "./actions";
import CoachFields from "./coach-fields";
import type { Sport } from "./coaches";

const initialState: FormState = {};

// Adds a college contact to the sport currently being viewed (the tab carries
// the sport, so it rides along as a hidden field). On success the form resets
// so the next school can be typed straight in.
export default function AddCoachForm({ sport }: { sport: Sport }) {
  const [state, formAction, pending] = useActionState(
    addCoachAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="player-form">
      <input type="hidden" name="sport" value={sport} />

      <CoachFields idPrefix={`coach-new-${sport}`} />

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : `Add ${sportLabel(sport)} contact`}
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
