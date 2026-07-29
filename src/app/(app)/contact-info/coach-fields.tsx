"use client";

import type { ReactNode } from "react";
import {
  COACH_FIELDS,
  DIVISION_LEVELS,
  coachValue,
  type CoachFieldType,
  type CoachRow,
} from "./coaches";

// The grid of contact inputs, shared by the "add a contact" form and the inline
// row editor so both always offer exactly the COACH_FIELDS columns.
//
// `idPrefix` namespaces the input ids (and the level datalist) so several
// editors can be open at once without colliding. `coach` prefills the inputs
// when editing; leaving it off gives a blank form. `leading` is rendered as the
// first cell of the grid — the editor uses it for the Sport select.

function inputType(type: CoachFieldType): string {
  switch (type) {
    case "tel":
      return "tel";
    case "email":
      return "email";
    // "link" is deliberately a text input: type="url" would reject a website
    // typed without a scheme ("gopsusports.com"), which is how they're copied
    // off a roster page. websiteHref() adds https:// when the link is rendered.
    default:
      return "text";
  }
}

export default function CoachFields({
  idPrefix,
  coach,
  leading,
}: {
  idPrefix: string;
  coach?: CoachRow;
  leading?: ReactNode;
}) {
  const levelListId = `${idPrefix}-levels`;

  return (
    <>
      {/* Common college levels — free text is still allowed. */}
      <datalist id={levelListId}>
        {DIVISION_LEVELS.map((level) => (
          <option key={level} value={level} />
        ))}
      </datalist>

      <div className="player-grid">
        {leading}

        {COACH_FIELDS.map((f) => {
          const id = `${idPrefix}-${f.key}`;
          const defaultValue = coach ? (coachValue(coach, f.key) ?? "") : "";

          return (
            <div
              key={f.key}
              className={`field${f.type === "notes" ? " coach-field-wide" : ""}`}
            >
              <label htmlFor={id}>
                {f.label}
                {f.required ? " *" : ""}
              </label>

              {f.type === "notes" ? (
                <textarea
                  id={id}
                  name={f.key}
                  defaultValue={defaultValue}
                  placeholder={f.placeholder}
                  maxLength={f.max}
                />
              ) : (
                <input
                  id={id}
                  name={f.key}
                  type={inputType(f.type)}
                  list={f.type === "level" ? levelListId : undefined}
                  defaultValue={defaultValue}
                  placeholder={f.placeholder}
                  required={f.required}
                  maxLength={f.max}
                  autoComplete="off"
                  {...(f.type === "link" ? { inputMode: "url" as const } : {})}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
