"use client";

import { useActionState, useEffect, useRef } from "react";
import { addSectionAction, type FormState } from "./actions";
import { SECTION_NAME_MAX } from "./fixed-costs";

const initialState: FormState = {};

// Creates a named section to group fixed costs under ("Uniforms", "Insurance"),
// on the season year currently being viewed.
export default function AddSectionForm({ year }: { year: number }) {
  const [state, formAction, pending] = useActionState(
    addSectionAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="fx-add-section">
      <input type="hidden" name="year" value={year} />

      <div className="field">
        <label htmlFor="fx-new-section">Section name</label>
        <input
          id="fx-new-section"
          name="name"
          type="text"
          placeholder="e.g. Uniforms"
          maxLength={SECTION_NAME_MAX}
          required
          autoComplete="off"
        />
      </div>

      <button type="submit" className="btn fx-add-section-btn" disabled={pending}>
        {pending ? "Adding…" : "Add section"}
      </button>

      {state?.error ? (
        <p className="error fx-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
