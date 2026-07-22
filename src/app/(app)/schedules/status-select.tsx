"use client";

import { useState } from "react";
import { updateStatusAction } from "./actions";
import { STATUSES, type EventStatus } from "./events";

// The inline status dropdown shown in each schedule row.
// Changing it submits the (void) server action immediately; local state gives
// instant colour feedback while the page revalidates in the background.
export default function StatusSelect({
  eventId,
  value,
}: {
  eventId: number;
  value: EventStatus;
}) {
  const [status, setStatus] = useState<EventStatus>(value);

  return (
    <form action={updateStatusAction} className="status-form">
      <input type="hidden" name="eventId" value={eventId} />
      <select
        name="status"
        className={`status-select status-${status}`}
        value={status}
        aria-label="Registration status"
        onChange={(e) => {
          setStatus(e.currentTarget.value as EventStatus);
          e.currentTarget.form?.requestSubmit();
        }}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}
