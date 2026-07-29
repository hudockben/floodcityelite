"use client";

import { DIVISIONS, divisionLabel } from "../teams/divisions";
import {
  HOTEL_FIELDS,
  KEEP_EVENT,
  hotelValue,
  tournamentOptionLabel,
  type HotelFieldType,
  type HotelRow,
  type TournamentOption,
} from "./hotels";

// The grid of hotel inputs, shared by the "add a hotel" form and the inline row
// editor so both always offer exactly the same columns.
//
// `idPrefix` namespaces the input ids so several editors can be open at once
// without colliding. `hotel` prefills the inputs when editing; leaving it off
// gives a blank form. The hotel name leads, then the two dropdowns — which
// tournament the stay is for, and which division it belongs to — then the rest
// of the typed fields.

function inputType(type: HotelFieldType): string {
  switch (type) {
    case "tel":
      return "tel";
    case "money":
      return "number";
    // "link" is deliberately a text input: type="url" would reject a website
    // typed without a scheme ("hotel.com/johnstown"). websiteHref() adds
    // https:// when the link is rendered.
    default:
      return "text";
  }
}

function FieldInput({
  field,
  id,
  defaultValue,
}: {
  field: (typeof HOTEL_FIELDS)[number];
  id: string;
  defaultValue: string;
}) {
  if (field.type === "notes") {
    return (
      <textarea
        id={id}
        name={field.key}
        defaultValue={defaultValue}
        placeholder={field.placeholder}
        maxLength={field.max}
      />
    );
  }

  return (
    <input
      id={id}
      name={field.key}
      type={inputType(field.type)}
      defaultValue={defaultValue}
      placeholder={field.placeholder}
      required={field.required}
      maxLength={field.max}
      autoComplete="off"
      {...(field.type === "money"
        ? { min: 0, step: "0.01", inputMode: "decimal" as const }
        : {})}
      {...(field.type === "link" ? { inputMode: "url" as const } : {})}
    />
  );
}

export default function HotelFields({
  idPrefix,
  hotel,
  tournaments,
}: {
  idPrefix: string;
  hotel?: HotelRow;
  tournaments: TournamentOption[];
}) {
  const [nameField, ...restFields] = HOTEL_FIELDS;
  const value = (key: string) => (hotel ? (hotelValue(hotel, key) ?? "") : "");

  // Group the dropdown by division so a long list of tournaments stays
  // scannable, keeping DIVISIONS' display order.
  const byDivision = DIVISIONS.map((d) => ({
    label: d.label,
    events: tournaments.filter((t) => t.division === d.slug),
  })).filter((g) => g.events.length > 0);

  // A tournament deleted from the Schedules tab leaves the hotel's event_id
  // null but keeps the name it was booked under, and a name with no id can't be
  // one of the live options. Offer it as its own (selected) option so saving
  // the row doesn't quietly drop it — see KEEP_EVENT.
  const removedEvent = hotel?.event_id == null ? hotel?.event_name : null;
  const selectedEvent =
    hotel?.event_id != null
      ? String(hotel.event_id)
      : removedEvent
        ? KEEP_EVENT
        : "";

  return (
    <div className="player-grid">
      <div className="field">
        <label htmlFor={`${idPrefix}-${nameField.key}`}>
          {nameField.label} *
        </label>
        <FieldInput
          field={nameField}
          id={`${idPrefix}-${nameField.key}`}
          defaultValue={value(nameField.key)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-eventId`}>Tournament</label>
        <select
          id={`${idPrefix}-eventId`}
          name="eventId"
          defaultValue={selectedEvent}
        >
          <option value="">
            {tournaments.length === 0
              ? "No tournaments scheduled yet"
              : "Not tied to a tournament"}
          </option>
          {removedEvent ? (
            <option value={KEEP_EVENT}>{removedEvent} (removed)</option>
          ) : null}
          {byDivision.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.events.map((t) => (
                <option key={t.id} value={t.id}>
                  {tournamentOptionLabel(t)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-division`}>Division</label>
        <select
          id={`${idPrefix}-division`}
          name="division"
          defaultValue={hotel?.division ?? ""}
        >
          <option value="">No division</option>
          {DIVISIONS.map((d) => (
            <option key={d.slug} value={d.slug}>
              {divisionLabel(d.slug)}
            </option>
          ))}
        </select>
      </div>

      {restFields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <div
            key={f.key}
            className={`field${f.type === "notes" ? " dir-field-wide" : ""}`}
          >
            <label htmlFor={id}>{f.label}</label>
            <FieldInput field={f} id={id} defaultValue={value(f.key)} />
          </div>
        );
      })}
    </div>
  );
}
