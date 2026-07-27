"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  submitRosterAcceptanceAction,
  type RosterFormState,
} from "./actions";
import {
  divisionLabel,
  POSITIONS,
  sportLabel,
} from "@/app/(app)/teams/divisions";
import type { RosterTeamOption } from "@/lib/roster-submissions";

const initialState: RosterFormState = {};

// A plain labeled text-style input used across the accept branch.
function TextField({
  name,
  label,
  type = "text",
  placeholder,
  inputMode,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "tel" | "email";
}) {
  return (
    <div className="field">
      <label htmlFor={`ra-${name}`}>{label}</label>
      <input
        id={`ra-${name}`}
        name={name}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        {...(type === "number" ? { min: 0 } : {})}
      />
    </div>
  );
}

// A position input backed by the shared datalist of common positions (free text
// still allowed).
function PositionField({ name, label }: { name: string; label: string }) {
  return (
    <div className="field">
      <label htmlFor={`ra-${name}`}>{label}</label>
      <input
        id={`ra-${name}`}
        name={name}
        type="text"
        list="ra-position-options"
        placeholder="e.g. SS"
        autoComplete="off"
      />
    </div>
  );
}

// The public roster-acceptance form. The parent first chooses Yes (accepting) or
// No (declining). Declining just records the response with a thank-you; accepting
// reveals the full player + parent detail and, on submit, pushes the player onto
// the chosen team's roster.
export default function RosterAcceptanceForm({
  teams,
}: {
  teams: RosterTeamOption[];
}) {
  const [state, formAction, pending] = useActionState(
    submitRosterAcceptanceAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // null = no choice yet; "yes" = accepting; "no" = declining.
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);

  // On a successful submit, reset the form and clear the choice so the next
  // parent starts fresh. The success banner (driven by `state.ok`) stays until
  // the next submit.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setChoice(null);
    }
  }, [state]);

  // Group the teams by division so the dropdown can show them under headings.
  const teamsByDivision = useMemo(() => {
    const groups = new Map<string, RosterTeamOption[]>();
    for (const t of teams) {
      const list = groups.get(t.division);
      if (list) list.push(t);
      else groups.set(t.division, [t]);
    }
    return [...groups.entries()];
  }, [teams]);

  return (
    <form ref={formRef} action={formAction} className="form">
      {state?.ok ? (
        <p className="success" role="status">
          {state.accepted
            ? "You're all set — the spot is confirmed and the coaching staff has the player's info. Welcome to Flood City Elite!"
            : "Thanks for letting us know. We appreciate you trying out and wish the player the best of luck!"}
        </p>
      ) : null}

      {/* Shared list of common positions for the primary/secondary inputs. */}
      <datalist id="ra-position-options">
        {POSITIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {/* Step 1 — accept or decline */}
      <fieldset className="accept-choice">
        <legend>Are you accepting the Flood City Elite roster spot? *</legend>
        <div className="accept-options">
          <label
            className={`accept-option${choice === "yes" ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="accepted"
              value="yes"
              checked={choice === "yes"}
              onChange={() => setChoice("yes")}
              required
            />
            <span className="accept-option-title">Yes — accept the spot</span>
            <span className="accept-option-sub">
              We&apos;ll add the player to the team roster.
            </span>
          </label>

          <label
            className={`accept-option${choice === "no" ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="accepted"
              value="no"
              checked={choice === "no"}
              onChange={() => setChoice("no")}
            />
            <span className="accept-option-title">No — decline the spot</span>
            <span className="accept-option-sub">
              We&apos;ll pass along your thanks for trying out.
            </span>
          </label>
        </div>
      </fieldset>

      {choice === null ? (
        <p className="muted-note">Choose an option above to continue.</p>
      ) : (
        <>
          {/* Player name — collected either way so the office knows who responded. */}
          <div className="field">
            <label htmlFor="ra-player_name">Player name *</label>
            <input
              id="ra-player_name"
              name="player_name"
              type="text"
              placeholder="Player's full name"
              autoComplete="off"
              required
            />
          </div>

          {choice === "no" ? (
            <p className="decline-note">
              Sorry to hear the player won&apos;t be joining us this season.
              Thank you for trying out with Flood City Elite — we wish you the
              best of luck! Just submit below and you&apos;re done.
            </p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="ra-teamId">Team *</label>
                <select id="ra-teamId" name="teamId" defaultValue="" required>
                  <option value="" disabled>
                    Choose the team…
                  </option>
                  {teamsByDivision.map(([division, list]) => (
                    <optgroup key={division} label={divisionLabel(division)}>
                      {list.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {sportLabel(t.sport)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {teams.length === 0 ? (
                  <p className="field-hint">
                    No teams are set up yet — please check back soon.
                  </p>
                ) : null}
              </div>

              <div className="player-grid">
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  inputMode="email"
                  placeholder="parent@example.com"
                />
                <TextField
                  name="returning_jersey"
                  label="Returning player jersey number"
                  placeholder="If returning"
                />
                <TextField
                  name="grad_year"
                  label="Grad year"
                  type="number"
                  placeholder="2027"
                />
                <TextField name="date_of_birth" label="Date of birth" type="date" />
                <TextField
                  name="parent_phone"
                  label="Parent's cell phone number"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                />
                <TextField
                  name="secondary_phone"
                  label="Secondary cell phone number"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                />
                <TextField name="height" label="Height" placeholder={`5'10"`} />
                <TextField
                  name="weight"
                  label="Weight"
                  type="number"
                  placeholder="150"
                />

                <div className="field">
                  <label htmlFor="ra-bats">Bats (L/R)</label>
                  <select id="ra-bats" name="bats" defaultValue="">
                    <option value="">—</option>
                    <option value="L">Left (L)</option>
                    <option value="R">Right (R)</option>
                    <option value="S">Switch (S)</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="ra-throws">Throws (L/R)</label>
                  <select id="ra-throws" name="throws" defaultValue="">
                    <option value="">—</option>
                    <option value="L">Left (L)</option>
                    <option value="R">Right (R)</option>
                  </select>
                </div>

                <PositionField name="primary_position" label="Primary position" />
                <PositionField
                  name="secondary_position"
                  label="Secondary position"
                />

                <TextField name="jersey_option_1" label="Jersey number option #1" />
                <TextField name="jersey_option_2" label="Jersey number option #2" />
                <TextField name="jersey_option_3" label="Jersey number option #3" />

                <div className="field">
                  <label htmlFor="ra-played_fce_2025">Did you play FCE in 2025?</label>
                  <select
                    id="ra-played_fce_2025"
                    name="played_fce_2025"
                    defaultValue=""
                  >
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <TextField name="hat_size" label="Hat size" placeholder={`e.g. 7 1/4`} />
              </div>
            </>
          )}

          {state?.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}

          <button type="submit" className="btn" disabled={pending}>
            {pending
              ? "Submitting…"
              : choice === "no"
                ? "Submit response"
                : "Accept my spot"}
          </button>
        </>
      )}

      {choice === null && state?.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
