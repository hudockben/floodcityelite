"use client";

import { useActionState, useEffect, useRef } from "react";
import { addHotelAction, type FormState } from "./actions";
import HotelFields from "./hotel-fields";
import type { TournamentOption } from "./hotels";

const initialState: FormState = {};

// Adds a hotel to the travel list. On success the form resets so the next
// hotel can be typed straight in.
export default function AddHotelForm({
  tournaments,
}: {
  tournaments: TournamentOption[];
}) {
  const [state, formAction, pending] = useActionState(
    addHotelAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="player-form">
      <HotelFields idPrefix="hotel-new" tournaments={tournaments} />

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add hotel"}
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
