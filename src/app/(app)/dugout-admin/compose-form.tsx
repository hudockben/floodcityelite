"use client";

import { useActionState, useEffect, useRef } from "react";
import { createDugoutPostAction, type DugoutFormState } from "./actions";
import PostFields from "./post-fields";

const initialState: DugoutFormState = {};

// Writes a new note onto the parents' board. On success the form resets so the
// next one can be typed straight in.
export default function ComposeForm() {
  const [state, formAction, pending] = useActionState(
    createDugoutPostAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="dugout-compose">
      {state?.ok ? (
        <p className="success" role="status">
          Posted. Parents see it on the board straight away.
        </p>
      ) : null}

      <PostFields idPrefix="dugout-new" />

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Posting…" : "Post to the board"}
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
