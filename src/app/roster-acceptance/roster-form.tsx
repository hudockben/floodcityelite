"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { Division } from "@/app/(app)/teams/divisions";

const initialState: RosterFormState = {};

// On a server error the action echoes the submitted values back (state.values);
// this context hands them to the field components so each re-fills itself as
// `defaultValue`, surviving React 19's post-submit auto-reset of the form.
const EchoContext = createContext<Record<string, string>>({});

// A plain labeled text-style input used across the accept branch. Every accept
// field is required, so `required` defaults to true (a caller can opt out).
function TextField({
  name,
  label,
  type = "text",
  placeholder,
  inputMode,
  required = true,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "tel" | "email";
  required?: boolean;
  max?: number;
}) {
  const echo = useContext(EchoContext);
  return (
    <div className="field">
      <label htmlFor={`ra-${name}`}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={`ra-${name}`}
        name={name}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        required={required}
        defaultValue={echo[name] ?? ""}
        {...(type === "number" ? { min: 0 } : {})}
        {...(max != null ? { max } : {})}
      />
    </div>
  );
}

// A position input backed by the shared datalist of common positions (free text
// still allowed). Required by default like the other accept fields.
function PositionField({ name, label }: { name: string; label: string }) {
  const echo = useContext(EchoContext);
  return (
    <div className="field">
      <label htmlFor={`ra-${name}`}>{label} *</label>
      <input
        id={`ra-${name}`}
        name={name}
        type="text"
        list="ra-position-options"
        placeholder="e.g. SS"
        autoComplete="off"
        required
        defaultValue={echo[name] ?? ""}
      />
    </div>
  );
}

// The public roster-acceptance form. The parent first chooses Yes (accepting) or
// No (declining). Either way they pick the division and team the offer was for,
// so the office can see who declined which spot; accepting also reveals the full
// player + parent detail and, on submit, pushes the player onto that team's
// roster.
export default function RosterAcceptanceForm({
  teams,
  divisions,
}: {
  teams: RosterTeamOption[];
  /** The program's divisions, so the Division dropdown names them properly. */
  divisions: Division[];
}) {
  const [state, formAction, pending] = useActionState(
    submitRosterAcceptanceAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // null = no choice yet; "yes" = accepting; "no" = declining.
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);

  // Every <select> on the form is CONTROLLED, and deliberately so. React 19
  // resets a `<form action>` after each submit, and an uncontrolled <select>
  // ignores a changed `defaultValue` on re-render — unlike an <input>, whose
  // value attribute React does keep in sync. Left uncontrolled, a select would
  // therefore blank out on a server error while its React state stayed put
  // (e.g. an empty Division above a Team list still filtered to the division
  // the parent picked). Driving them from state, and restoring that state from
  // the echo below, keeps the whole form intact through an error.
  //
  // The chosen division narrows the team dropdown to that division's teams.
  // Both are asked on accept AND decline, and survive a yes/no toggle.
  const [division, setDivision] = useState("");
  const [teamId, setTeamId] = useState("");
  const [bats, setBats] = useState("");
  const [throwsWith, setThrowsWith] = useState("");
  // The "Did you play in 2026?" answer gates the jersey inputs: "yes" (returning
  // player) shows a single returning number; "no" (new player) shows three
  // ranked options. "" = not answered yet, so neither is shown.
  const [played, setPlayed] = useState<"" | "yes" | "no">("");

  // Controlling the selects isn't enough on its own: React 19's post-submit
  // reset reverts each one to its first non-disabled <option> behind React's
  // back, and React won't rewrite a controlled node whose `value` prop hasn't
  // changed — so the DOM would sit there disagreeing with our state (a Division
  // reading "Spring/Summer Baseball" over a team list still filtered to
  // Softball). Bumping this key on every action result remounts the selects, so
  // React builds fresh nodes and writes the current state value into each.
  const [selectKey, setSelectKey] = useState(0);

  useEffect(() => {
    // Nothing has been submitted yet (the initial state) — leave the form alone.
    if (!state?.ok && !state?.values) return;

    // On a successful submit, reset the form and clear the choice and every
    // select so the next parent starts fresh. The success banner (driven by
    // `state.ok`) stays until the next submit.
    if (state.ok) {
      formRef.current?.reset();
      setChoice(null);
      setDivision("");
      setTeamId("");
      setBats("");
      setThrowsWith("");
      setPlayed("");
    } else if (state.values) {
      // On an error, re-fill the selects from the echoed values — belt and
      // braces, since the state that drives them survives the reset anyway
      // (this is what restores them if the form is ever remounted outright).
      // The text inputs re-fill themselves through `defaultValue`.
      const echo = state.values;
      setDivision(echo.division ?? "");
      setTeamId(echo.teamId ?? "");
      setBats(echo.bats ?? "");
      setThrowsWith(echo.throws ?? "");
      const answer = echo.played_fce_2026;
      setPlayed(answer === "yes" || answer === "no" ? answer : "");
    }

    // Remount the selects so the values above are written into fresh DOM nodes,
    // undoing React 19's reset (see selectKey).
    setSelectKey((k) => k + 1);
  }, [state]);

  // Division + team are mandatory — except for a decline when there's nothing to
  // pick from. The team list renders empty both when no teams are set up yet and
  // when the page's load failed (it swallows the error), and a parent turning a
  // spot down shouldn't be blocked by our side being down. An ACCEPT still
  // requires a team either way: without one there's no roster to join. The
  // server applies the same rule (it re-checks that the list is really empty).
  const teamRequired = choice === "yes" || teams.length > 0;

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
    <EchoContext.Provider value={state.values ?? {}}>
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
              defaultChecked={state.values?.accepted === "yes"}
              onChange={() => {
                setChoice("yes");
                setPlayed("");
              }}
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
              defaultChecked={state.values?.accepted === "no"}
              onChange={() => {
                setChoice("no");
                setPlayed("");
              }}
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
              defaultValue={state.values?.player_name ?? ""}
            />
          </div>

          {choice === "no" ? (
            <p className="decline-note">
              Sorry to hear the player won&apos;t be joining us this season.
              Please tell us which team&apos;s spot you&apos;re turning down so
              the coaching staff knows which roster to reopen. Thank you for
              trying out with Flood City Elite — we wish you the best of luck!
            </p>
          ) : null}

          {/* Division + team — required on accept AND decline, so a declined
              offer still records which spot was turned down. Division first: it
              narrows the team list below to that division. */}
          <div className="field">
            <label htmlFor="ra-division">
              Division{teamRequired ? " *" : ""}
            </label>
            <select
              key={selectKey}
              id="ra-division"
              name="division"
              value={division}
              onChange={(e) => {
                setDivision(e.target.value);
                // The team list below is about to change; drop any team picked
                // under the previous division.
                setTeamId("");
              }}
              required={teamRequired}
            >
              <option value="" disabled>
                Choose a division…
              </option>
              {teamsByDivision.map(([div]) => (
                <option key={div} value={div}>
                  {divisionLabel(div, divisions)}
                </option>
              ))}
            </select>
            {teams.length === 0 ? (
              <p className="field-hint">
                {choice === "no"
                  ? "No teams are listed right now — go ahead and submit and we'll match your response up on our end."
                  : "No teams are set up yet — please check back soon."}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="ra-teamId">
              {choice === "no" ? "Team you're declining" : "Team"}
              {teamRequired ? " *" : ""}
            </label>
            <select
              key={selectKey}
              id="ra-teamId"
              name="teamId"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required={teamRequired}
              disabled={!division}
            >
              <option value="">
                {division ? "Choose the team…" : "Pick a division first"}
              </option>
              {(teamsByDivision.find(([d]) => d === division)?.[1] ?? []).map(
                (t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {sportLabel(t.sport)}
                  </option>
                ),
              )}
            </select>
          </div>

          {choice === "yes" ? (
            <>
              <div className="player-grid">
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  inputMode="email"
                  placeholder="parent@example.com"
                />
                <TextField
                  name="grad_year"
                  label="Grad year"
                  type="number"
                  placeholder="2027"
                  max={2100}
                />
                <TextField
                  name="high_school"
                  label="High school"
                  placeholder="e.g. Central High School"
                />
                <TextField name="date_of_birth" label="Date of birth" type="date" />
                <TextField
                  name="parent_name"
                  label="Parent's name"
                  placeholder="Parent or guardian's full name"
                />
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
                  max={400}
                />

                <div className="field">
                  <label htmlFor="ra-bats">Bats (L/R) *</label>
                  <select
                    key={selectKey}
                    id="ra-bats"
                    name="bats"
                    value={bats}
                    onChange={(e) => setBats(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    <option value="L">Left (L)</option>
                    <option value="R">Right (R)</option>
                    <option value="S">Switch (S)</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="ra-throws">Throws (L/R) *</label>
                  <select
                    key={selectKey}
                    id="ra-throws"
                    name="throws"
                    value={throwsWith}
                    onChange={(e) => setThrowsWith(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    <option value="L">Left (L)</option>
                    <option value="R">Right (R)</option>
                  </select>
                </div>

                <PositionField name="primary_position" label="Primary position" />
                <PositionField
                  name="secondary_position"
                  label="Secondary position"
                />

                <TextField name="hat_size" label="Hat size" placeholder="e.g. Small, Medium, Large" />
              </div>

              {/* Jersey number — gated by whether the player is returning. */}
              <div className="field">
                <label htmlFor="ra-played_fce_2026">
                  Did you play in 2026? *
                </label>
                <select
                  key={selectKey}
                  id="ra-played_fce_2026"
                  name="played_fce_2026"
                  value={played}
                  onChange={(e) =>
                    setPlayed(e.target.value as "" | "yes" | "no")
                  }
                  required
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  <option value="yes">Yes — returning player</option>
                  <option value="no">No — new player</option>
                </select>
              </div>

              {played === "yes" ? (
                <TextField
                  name="returning_jersey"
                  label="Returning player jersey number"
                  placeholder="Number from last season"
                />
              ) : null}

              {played === "no" ? (
                <>
                  <p className="field-hint">
                    List three jersey numbers in order of preference — we&apos;ll
                    assign the first one that isn&apos;t already taken on the team.
                  </p>
                  <div className="player-grid">
                    <TextField
                      name="jersey_option_1"
                      label="Jersey number option #1"
                      placeholder="e.g. 7"
                    />
                    <TextField
                      name="jersey_option_2"
                      label="Jersey number option #2"
                      placeholder="e.g. 12"
                    />
                    <TextField
                      name="jersey_option_3"
                      label="Jersey number option #3"
                      placeholder="e.g. 21"
                    />
                  </div>
                </>
              ) : null}
            </>
          ) : null}

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
    </EchoContext.Provider>
  );
}
