"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import ExportButtons from "../export-buttons";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel } from "../teams/divisions";
import {
  deleteFundraiserAction,
  deleteFundraiserEntryAction,
} from "./actions";
import CreateFundraiser from "./create-fundraiser";
import EntryDraftRow, { type DraftInitial } from "./entry-draft-row";
import FundraiserSearch, { type PlayerMatch } from "./fundraiser-search";
import {
  TEAM_LEVEL_LABEL,
  formatDate,
  formatMoney,
  ledgerRows,
  raisedByFundraiser,
  sumEntryCents,
  type FundraiserEntryRow,
  type FundraiserOption,
  type PlayerOption,
  type TeamOption,
} from "./fundraisers";

// A draft (unsaved) row. `initial` is set when the row is seeded from the
// search bar so its Division/Team/Player start filled in.
type Draft = { id: number; initial?: DraftInitial };

// Date, Division, Team, Player, Fundraiser, Amount, Total, Actions.
const COL_COUNT = 8;

export default function FundraiserTracker({
  teams,
  players,
  fundraisers,
  entries,
}: {
  teams: TeamOption[];
  players: PlayerOption[];
  fundraisers: FundraiserOption[];
  entries: FundraiserEntryRow[];
}) {
  // Draft (unsaved) rows added by "Add Entry" or the search bar, each with a
  // stable key.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextDraftId = useRef(1);

  function addDraft(initial?: DraftInitial) {
    setDrafts((cur) => [...cur, { id: nextDraftId.current++, initial }]);
  }

  function removeDraft(id: number) {
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }

  // Picking a player from the search bar seeds a pre-filled draft row so only
  // the fundraiser and amount are left to enter.
  function handlePick(match: PlayerMatch) {
    addDraft({
      division: match.team.division,
      teamId: String(match.team.id),
      playerId: String(match.player.id),
    });
  }

  // The Total column accumulates across saved entries in display order, so the
  // last row's running total equals the grand total raised. Ordering and
  // accumulation come from `ledgerRows`, which the download and the printed
  // report use too — so none of the three can total the same rows differently.
  const savedRows = ledgerRows(entries);
  const grandTotalCents = sumEntryCents(entries);

  // Sum each fundraiser's raised amount so its card can show progress.
  const raised = raisedByFundraiser(entries);

  const hasTeams = teams.length > 0;
  const hasFundraisers = fundraisers.length > 0;

  // The spreadsheet download. No query beyond the format: nothing on this tab
  // narrows the table, so the file is always the whole log. The PDF is a page
  // rather than a file — the browser's own print dialog saves it.
  const exportHref = (format: "csv" | "xlsx") =>
    `/fundraiser-tracker/export?format=${format}`;

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Fundraiser Tracker</h1>
          <p>
            Create fundraisers, then log how much was raised toward each one —
            by an individual player or a whole team. Totals build up per
            fundraiser and overall.
          </p>
        </div>
      </section>

      {/* Step 1 — create and manage fundraisers */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">1</span> Fundraisers
          </h2>
          <p>
            Name a fundraiser and optionally set a goal and date. You&apos;ll
            pick one of these when logging what a player raised.
          </p>
        </div>

        <CreateFundraiser />

        {fundraisers.length === 0 ? (
          <p className="muted-note">
            No fundraisers yet — create one above to start tracking.
          </p>
        ) : (
          <ul className="fund-list">
            {fundraisers.map((f) => {
              const raisedAmt = (raised.get(f.id) ?? 0) / 100;
              const goalNum =
                f.goal != null && f.goal !== "" ? Number(f.goal) : null;
              const pct =
                goalNum && goalNum > 0
                  ? Math.min(100, Math.round((raisedAmt / goalNum) * 100))
                  : null;
              return (
                <li key={f.id} className="fund-item">
                  <div className="fund-item-head">
                    <span className="fund-item-name">{f.name}</span>
                    <ConfirmButton
                      action={deleteFundraiserAction}
                      hidden={{ fundraiserId: f.id }}
                      confirmText={`Delete "${f.name}" and all of its logged entries?`}
                      className="row-delete"
                    >
                      Remove
                    </ConfirmButton>
                  </div>

                  {f.event_date ? (
                    <div className="fund-item-date">
                      {formatDate(f.event_date)}
                    </div>
                  ) : null}

                  <div className="fund-item-raised">
                    <span className="fund-raised-amt">
                      {formatMoney(raisedAmt)}
                    </span>
                    <span className="fund-raised-goal">
                      {goalNum != null
                        ? ` of ${formatMoney(goalNum)} goal`
                        : " raised"}
                    </span>
                  </div>

                  {pct != null ? (
                    <div
                      className="fund-progress"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${f.name} progress`}
                    >
                      <div
                        className="fund-progress-bar"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Step 2 — log what each player raised */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">2</span> Log fundraising
          </h2>
          <p>
            Pick the division and team, then a player or the whole team, choose
            which fundraiser, and enter the amount raised. The Total column
            accumulates every dollar, and a CSV, Excel or PDF download carries
            the whole log with it.
          </p>
        </div>

        {!hasTeams ? (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              💰
            </div>
            <p className="empty-title">No teams yet</p>
            <p className="empty-sub">
              Head to the{" "}
              <Link className="inline-link" href="/teams">
                Teams
              </Link>{" "}
              tab to create a team and add players, then come back here to log
              fundraising.
            </p>
          </div>
        ) : (
          <>
            {/* The search field adds to the log; the downloads take it away
                with you. Nothing on this tab filters the table, so a download
                always carries every entry below it. */}
            <div className="fund-toolbar">
              <FundraiserSearch
                teams={teams}
                players={players}
                onPick={handlePick}
              />

              {entries.length > 0 ? (
                <ExportButtons
                  href={exportHref}
                  pdfHref="/fundraiser-tracker/print"
                  count={entries.length}
                  nounPlural="entries"
                />
              ) : null}
            </div>

            <div className="pay-scroll">
              <table className="pay-table fund-table">
                <colgroup>
                  <col className="fc-date" />
                  <col className="fc-div" />
                  <col className="fc-team" />
                  <col className="fc-player" />
                  <col className="fc-fund" />
                  <col className="fc-amount" />
                  <col className="fc-total" />
                  <col className="fc-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Division</th>
                    <th>Team Name</th>
                    <th>Player Name</th>
                    <th>Fundraiser</th>
                    <th className="pay-num">Amount</th>
                    <th className="pay-num">Total</th>
                    <th className="col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {savedRows.length === 0 && drafts.length === 0 ? (
                    <tr>
                      <td colSpan={COL_COUNT} className="pay-empty">
                        No fundraising logged yet — click “Add Entry” to log one.
                      </td>
                    </tr>
                  ) : null}

                  {savedRows.map(({ entry, runningTotalCents }) => (
                    <tr key={entry.id}>
                      <td className="pay-nowrap">{formatDate(entry.raised_on)}</td>
                      <td
                        className="pay-trunc"
                        title={divisionLabel(entry.division)}
                      >
                        {divisionLabel(entry.division)}
                      </td>
                      <td className="pay-trunc" title={entry.team_name}>
                        {entry.team_name}
                      </td>
                      <td
                        className="col-name pay-trunc"
                        title={entry.player_name ?? TEAM_LEVEL_LABEL}
                      >
                        {entry.player_name ?? (
                          <span className="fund-team-level">
                            {TEAM_LEVEL_LABEL}
                          </span>
                        )}
                      </td>
                      <td className="pay-trunc" title={entry.fundraiser_name}>
                        <span className="fund-badge">{entry.fundraiser_name}</span>
                      </td>
                      <td className="pay-num">{formatMoney(entry.amount)}</td>
                      <td className="pay-num pay-running">
                        {formatMoney(runningTotalCents / 100)}
                      </td>
                      <td className="col-actions">
                        <ConfirmButton
                          action={deleteFundraiserEntryAction}
                          hidden={{ entryId: entry.id }}
                          confirmText={`Remove this ${formatMoney(
                            entry.amount,
                          )} entry for ${entry.player_name ?? entry.team_name}?`}
                          className="row-delete"
                        >
                          Remove
                        </ConfirmButton>
                      </td>
                    </tr>
                  ))}

                  {drafts.map((draft) => (
                    <EntryDraftRow
                      key={draft.id}
                      id={draft.id}
                      teams={teams}
                      players={players}
                      fundraisers={fundraisers}
                      initial={draft.initial}
                      onRemove={removeDraft}
                      onSaved={removeDraft}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="pay-total-row">
                    <td colSpan={6} className="pay-total-label">
                      Total raised
                    </td>
                    <td className="pay-num pay-grand">
                      {formatMoney(grandTotalCents / 100)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="pay-actions">
              <button
                type="button"
                className="btn-add-payment"
                onClick={() => addDraft()}
                disabled={!hasFundraisers}
              >
                <span aria-hidden="true">+</span> Add Entry
              </button>
              {hasFundraisers ? (
                <span className="pay-count">
                  {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
                  {formatMoney(grandTotalCents / 100)} raised
                </span>
              ) : (
                <span className="pay-count">
                  Create a fundraiser above before logging entries.
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
