"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { telHref, websiteHref, websiteLabel } from "@/lib/links";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel, type Division } from "../teams/divisions";
import { formatMoney } from "../schedules/events";
import { deleteHotelAction, updateHotelAction, type FormState } from "./actions";
import HotelFields from "./hotel-fields";
import {
  HOTEL_FIELDS,
  formatShortDate,
  hotelValue,
  scheduleHref,
  type HotelField,
  type HotelRow as HotelRowData,
  type TournamentOption,
} from "./hotels";

const initialState: FormState = {};
// The hotel name, the tournament and division columns, the rest of the fields,
// and the actions column.
const COL_SPAN = HOTEL_FIELDS.length + 3;

// Which tournament the stay is for. A live one links through to that
// tournament's Schedules view; if the tournament was deleted the snapshot name
// is kept but shown as struck-out context rather than a dead link.
function TournamentCell({ hotel }: { hotel: HotelRowData }) {
  if (!hotel.event_name) return <span className="cell-empty">—</span>;

  const when = formatShortDate(hotel.event_date);

  if (hotel.event_id != null) {
    return (
      <Link
        className="dir-link"
        href={scheduleHref(hotel.event_division, hotel.event_year)}
        title={`${hotel.event_name}${when ? ` · ${when}` : ""} — open on the Schedules tab`}
      >
        {hotel.event_name}
      </Link>
    );
  }

  return (
    <span
      className="dir-removed"
      title="This tournament was removed from the Schedules tab"
    >
      {hotel.event_name}
    </span>
  );
}

// One typed field's cell. Phone and website become tap-to-use links; the
// nightly rate is formatted as money.
function HotelCell({ field, value }: { field: HotelField; value: string | null }) {
  if (value == null) return <span className="cell-empty">—</span>;

  switch (field.type) {
    case "tel": {
      const href = telHref(value);
      // Free text: only linkify what can actually be dialed (see telHref).
      return href ? (
        <a className="dir-link" href={href}>
          {value}
        </a>
      ) : (
        <>{value}</>
      );
    }
    case "link": {
      const href = websiteHref(value);
      // Anything that isn't an http(s) link stays plain text (see websiteHref).
      return href ? (
        <a
          className="dir-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {websiteLabel(value)}
        </a>
      ) : (
        <>{value}</>
      );
    }
    case "money":
      return <>{formatMoney(value)}</>;
    default:
      return <>{value}</>;
  }
}

export default function HotelRow({
  hotel,
  tournaments,
  divisions,
}: {
  hotel: HotelRowData;
  tournaments: TournamentOption[];
  /** The company's divisions, for this row's badge and its inline editor. */
  divisions: Division[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateHotelAction,
    initialState,
  );

  // Collapse the editor once a save succeeds (fresh data arrives via
  // revalidation, so the display row shows the updated values).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <tr className="player-edit-row">
        <td colSpan={COL_SPAN}>
          <form action={formAction} className="player-edit-form">
            <input type="hidden" name="hotelId" value={hotel.id} />

            <div className="player-edit-head">
              Editing <strong>{hotel.name}</strong>
            </div>

            <HotelFields
              divisions={divisions}
              idPrefix={`hotel-edit-${hotel.id}`}
              hotel={hotel}
              tournaments={tournaments}
            />

            <div className="player-form-actions">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
              {state?.error ? (
                <p className="error player-form-msg" role="alert">
                  {state.error}
                </p>
              ) : null}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  // The name is rendered explicitly (it's the frozen first column), so the
  // mapped tail starts at the second field.
  const [, ...restFields] = HOTEL_FIELDS;

  return (
    <tr>
      <td className="col-name">{hotel.name}</td>

      <td>
        <TournamentCell hotel={hotel} />
      </td>

      <td>
        {hotel.division ? (
          <span className="dir-badge">
            {divisionLabel(hotel.division, divisions)}
          </span>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </td>

      {restFields.map((f) => {
        const value = hotelValue(hotel, f.key);
        const classes = [
          f.type === "notes" ? "dir-notes" : null,
          f.type === "money" ? "dir-num" : null,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <td
            key={f.key}
            className={classes || undefined}
            title={f.type === "notes" && value ? value : undefined}
          >
            <HotelCell field={f} value={value} />
          </td>
        );
      })}

      <td className="col-actions">
        <div className="row-actions">
          <button
            type="button"
            className="row-edit"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ConfirmButton
            action={deleteHotelAction}
            hidden={{ hotelId: hotel.id }}
            confirmText={`Remove ${hotel.name} from the hotel list?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}
