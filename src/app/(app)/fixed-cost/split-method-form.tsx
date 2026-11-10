"use client";

import { useActionState } from "react";
import { saveSplitMethodAction, type FormState } from "./actions";
import { SPLIT_METHODS, type SplitMethod } from "./fixed-costs";

const initialState: FormState = {};

// How the year's total is split across its teams. Two pills, one per method;
// each is its own submit button carrying its method, so picking one saves it
// straight away and the tiles, sections and team breakdown below re-render on
// the new split. Same pill look as the season picker above it.
export default function SplitMethodForm({
  method,
  year,
}: {
  method: SplitMethod;
  /** The season year this choice belongs to. */
  year: number;
}) {
  const [state, formAction, pending] = useActionState(
    saveSplitMethodAction,
    initialState,
  );
  const active = SPLIT_METHODS.find((m) => m.value === method) ?? SPLIT_METHODS[0];

  return (
    <form action={formAction} className="fx-method">
      <input type="hidden" name="year" value={year} />
      <div className="season-bar fx-method-bar">
        <span className="season-bar-label" id="fx-method-label">
          Split
        </span>
        <div
          className="season-pills"
          role="group"
          aria-labelledby="fx-method-label"
        >
          {SPLIT_METHODS.map((m) => {
            const on = m.value === method;
            return (
              <button
                key={m.value}
                type="submit"
                name="method"
                value={m.value}
                className={`season-pill fx-method-pill${on ? " active" : ""}`}
                aria-pressed={on}
                // Re-picking the method already in use has nothing to save.
                disabled={pending || on}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="fx-method-note">
        {pending ? "Saving…" : active.description}
      </p>
      {state?.error ? (
        <p className="error fx-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
