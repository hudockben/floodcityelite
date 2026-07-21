"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTeamAction, type FormState } from "./actions";
import { SPORTS, type DivisionSlug, type Sport } from "./divisions";

const initialState: FormState = {};

export default function CreateTeamForm({
  division,
  defaultSport,
}: {
  division: DivisionSlug;
  defaultSport: Sport;
}) {
  const [state, formAction, pending] = useActionState(
    createTeamAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a team is created so the next one is easy to add.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="team-form">
      <input type="hidden" name="division" value={division} />

      <div className="field">
        <label htmlFor="team-name">Team name</label>
        <input
          id="team-name"
          name="name"
          type="text"
          placeholder="e.g. 14U Flood City Elite"
          autoComplete="off"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="team-sport">Sport</label>
        <select id="team-sport" name="sport" defaultValue={defaultSport}>
          {SPORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className="btn team-form-btn" disabled={pending}>
        {pending ? "Creating…" : "Create team"}
      </button>

      {state?.error ? (
        <p className="error team-form-msg" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
