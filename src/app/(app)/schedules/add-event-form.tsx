"use client";

import { useActionState, useEffect, useRef } from "react";
import { addEventAction, type FormState } from "./actions";
import { EVENT_FIELDS, STATUSES, STATUS_HEADER, type EventField } from "./events";
import { sportLabel } from "../teams/divisions";

const initialState: FormState = {};

type TeamOption = { id: number; name: string; sport: string };

function FieldInput({ field }: { field: EventField }) {
  const common = {
    id: `event-${field.key}`,
    name: field.key,
    required: field.required,
    autoComplete: "off" as const,
  };

  if (field.type === "money") {
    return <input {...common} type="number" min={0} step="0.01" placeholder={field.placeholder} />;
  }

  return <input {...common} type={field.type} placeholder={field.placeholder} />;
}

export default function AddEventForm({
  division,
  teams,
}: {
  division: string;
  teams: TeamOption[];
}) {
  const [state, formAction, pending] = useActionState(addEventAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  if (teams.length === 0) {
    return (
      <p className="muted-note">
        Create a team in the Teams tab first, then you can start adding
        tournaments to its schedule.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="player-form">
      <input type="hidden" name="division" value={division} />

      <div className="player-grid">
        <div className="field">
          <label htmlFor="event-team">Team</label>
          <select id="event-team" name="teamId" defaultValue="" required>
            <option value="" disabled>
              Choose a team…
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {sportLabel(t.sport)}
              </option>
            ))}
          </select>
        </div>

        {EVENT_FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={`event-${field.key}`}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <FieldInput field={field} />
          </div>
        ))}

        <div className="field">
          <label htmlFor="event-status">{STATUS_HEADER}</label>
          <select id="event-status" name="status" defaultValue="registered">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="player-form-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add tournament"}
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
