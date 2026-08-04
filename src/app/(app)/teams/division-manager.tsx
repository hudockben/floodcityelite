"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import ConfirmButton from "./confirm-button";
import {
  createDivisionAction,
  deleteDivisionAction,
  type FormState,
} from "./actions";
import {
  DIVISION_LABEL_MAX,
  SPORTS,
  slugifyDivision,
  type Division,
} from "./divisions";

const initialState: FormState = {};

// Add or remove a division, tucked under the division selector on the Teams
// tab. Collapsed by default: adding a division is a once-a-season act, and the
// selector above it is what gets used every visit.
//
// A division can only be removed while it has no teams, and never the last one
// — the server enforces both; this just doesn't offer the button when it would
// be refused, and says why.
export default function DivisionManager({
  divisions,
  teamCounts,
}: {
  divisions: Division[];
  /** Teams per division slug, across every season — what makes removal safe. */
  teamCounts: Record<string, number>;
}) {
  const [state, formAction, pending] = useActionState(
    createDivisionAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [label, setLabel] = useState("");

  // Clear the form after a division is added so the next one starts blank.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setLabel("");
    }
  }, [state]);

  // Show the slug the name will produce — it's what lands in the ?division=
  // link, so it's worth seeing before committing to a name.
  const slug = slugifyDivision(label);
  const taken = divisions.some((d) => d.slug === slug);

  return (
    <details className="division-manage">
      <summary className="division-manage-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="division-manage-title">Add or remove a division</span>
        <span className="division-manage-count">
          {divisions.length}{" "}
          {divisions.length === 1 ? "division" : "divisions"}
        </span>
      </summary>

      <p className="division-manage-hint">
        A division gets its own seasons, teams, rosters, schedules, and budget —
        add one for a fall showcase circuit, a winter program, or any run you
        track separately.
      </p>

      <form ref={formRef} action={formAction} className="division-form">
        <div className="field">
          <label htmlFor="division-label">Division name</label>
          <input
            id="division-label"
            name="label"
            type="text"
            placeholder="e.g. 18U Fall Showcase"
            maxLength={DIVISION_LABEL_MAX}
            autoComplete="off"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {slug ? (
            <p className="field-hint">
              Link: <code>?division={slug}</code>
              {taken ? " — already in use" : ""}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="division-sport">Default sport</label>
          <select id="division-sport" name="default_sport" defaultValue="baseball">
            {SPORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn team-form-btn" disabled={pending}>
          {pending ? "Adding…" : "Add division"}
        </button>

        {state?.error ? (
          <p className="error team-form-msg" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>

      <ul className="division-chips">
        {divisions.map((d) => {
          const count = teamCounts[d.slug] ?? 0;
          const last = divisions.length <= 1;
          return (
            <li key={d.slug} className="division-chip">
              <span className="division-chip-name">{d.label}</span>
              <span className="division-chip-count">
                {count} {count === 1 ? "team" : "teams"}
              </span>
              {count > 0 ? (
                <span className="division-chip-note">
                  Remove its teams first
                </span>
              ) : last ? (
                <span className="division-chip-note">
                  The last division stays
                </span>
              ) : (
                <ConfirmButton
                  action={deleteDivisionAction}
                  hidden={{ slug: d.slug }}
                  confirmText={`Remove the ${d.label} division? It has no teams, so nothing is lost — its empty seasons go with it.`}
                  className="row-delete"
                >
                  Remove
                </ConfirmButton>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
