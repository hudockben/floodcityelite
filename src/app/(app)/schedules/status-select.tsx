"use client";

import { useOptimistic, useTransition } from "react";
import { updateStatusAction } from "./actions";
import { STATUSES, type EventStatus } from "./events";

// The inline status dropdown shown in each schedule row.
//
// Changing it calls the server action directly (not via a <form action>): a
// form action would make React 19 reset the form once the action resolved,
// snapping this controlled <select> back to its first option ("Registered")
// while the state still held the chosen value — the dropdown appeared to bounce
// back even though the save succeeded. useOptimistic shows the picked status
// instantly for colour feedback, then falls back to the confirmed server value
// once the page revalidates.
export default function StatusSelect({
  eventId,
  value,
}: {
  eventId: number;
  value: EventStatus;
}) {
  const [status, setStatus] = useOptimistic<EventStatus>(value);
  const [, startTransition] = useTransition();

  return (
    <select
      name="status"
      className={`status-select status-${status}`}
      value={status}
      aria-label="Registration status"
      onChange={(e) => {
        const next = e.currentTarget.value as EventStatus;
        startTransition(async () => {
          setStatus(next);
          await updateStatusAction({ eventId, status: next });
        });
      }}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
