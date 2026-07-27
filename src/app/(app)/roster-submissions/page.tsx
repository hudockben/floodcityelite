import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel } from "../teams/divisions";
import { ensureTeamsSchema } from "../teams/schema";
import {
  ensureRosterSubmissionsSchema,
  formatRosterDate,
  listRosterSubmissions,
  type RosterSubmissionRow,
} from "@/lib/roster-submissions";
import { deleteRosterSubmissionAction } from "./actions";

export const dynamic = "force-dynamic";

function handednessLabel(value: string | null): string | null {
  if (!value) return null;
  const map: Record<string, string> = { L: "Left (L)", R: "Right (R)", S: "Switch (S)" };
  return map[value] ?? value;
}

// The labeled detail fields shown on a submission card, in display order. Empty
// values are dropped so a decline (which carries almost nothing) stays compact.
function detailFields(s: RosterSubmissionRow): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "Email", value: s.email },
    { label: "Grad year", value: s.grad_year != null ? String(s.grad_year) : null },
    { label: "Date of birth", value: s.date_of_birth ? formatRosterDate(s.date_of_birth) : null },
    { label: "Parent's cell", value: s.parent_phone },
    { label: "Secondary cell", value: s.secondary_phone },
    { label: "Height", value: s.height },
    { label: "Weight", value: s.weight != null ? String(s.weight) : null },
    { label: "Bats", value: handednessLabel(s.bats) },
    { label: "Throws", value: handednessLabel(s.throws) },
    { label: "Primary position", value: s.primary_position },
    { label: "Secondary position", value: s.secondary_position },
    { label: "Returning jersey #", value: s.returning_jersey },
    { label: "Jersey option #1", value: s.jersey_option_1 },
    { label: "Jersey option #2", value: s.jersey_option_2 },
    { label: "Jersey option #3", value: s.jersey_option_3 },
    {
      label: "Played FCE in 2025",
      value: s.played_fce_2025 == null ? null : s.played_fce_2025 ? "Yes" : "No",
    },
    { label: "Hat size", value: s.hat_size },
  ];
  return rows.filter((r): r is { label: string; value: string } => r.value != null && r.value !== "");
}

export default async function RosterSubmissionsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let submissions: RosterSubmissionRow[] = [];
  let loadError = false;

  try {
    // Create the tables on first use so the tab works even if the database
    // predates this feature. roster_submissions FKs to teams/players, so ensure
    // those first. Both are idempotent and memoized.
    await ensureTeamsSchema();
    await ensureRosterSubmissionsSchema();
    submissions = await listRosterSubmissions(session.companyId);
  } catch (err) {
    console.error("Roster submissions load error:", err);
    loadError = true;
  }

  if (loadError) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h1>Roster Submissions</h1>
          <p>Accept/decline responses from the public roster form.</p>
        </div>
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <p className="empty-title">Couldn&apos;t load submissions</p>
          <p className="empty-sub">
            The submissions table may still be getting set up. Refresh in a
            moment — if this keeps happening, run <code>npm run db:setup</code>{" "}
            against the database.
          </p>
        </div>
      </section>
    );
  }

  const acceptedCount = submissions.filter((s) => s.accepted).length;
  const declinedCount = submissions.length - acceptedCount;

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Roster Submissions</h1>
        <p>
          Accept/decline responses from the public roster form. When a parent
          accepts, the player is added to the chosen team&apos;s roster
          automatically — the team name below links to it. Delete a response once
          it&apos;s been processed.
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            📝
          </div>
          <p className="empty-title">No submissions yet</p>
          <p className="empty-sub">
            Parents respond from the <strong>Roster Spot</strong> card on the
            sign-in screen. Their responses show up here.
          </p>
        </div>
      ) : (
        <>
          <p className="muted-note subs-summary">
            <strong>{submissions.length}</strong>{" "}
            {submissions.length === 1 ? "response" : "responses"} ·{" "}
            <strong>{acceptedCount}</strong> accepted ·{" "}
            <strong>{declinedCount}</strong> declined
          </p>

          <div className="subs-list">
            {submissions.map((s) => {
              const details = detailFields(s);
              const teamLink =
                s.accepted && s.team_id != null && s.current_division
                  ? `/teams?division=${s.current_division}#team-${s.team_id}`
                  : null;
              const teamName = s.current_team_name ?? s.team_name;

              return (
                <article key={s.id} className="sub-card">
                  <div className="sub-head">
                    <div className="sub-head-main">
                      <span
                        className={`sub-status ${
                          s.accepted ? "sub-status-accepted" : "sub-status-declined"
                        }`}
                      >
                        {s.accepted ? "Accepted" : "Declined"}
                      </span>
                      <span className="sub-name">{s.player_name}</span>
                    </div>
                    <div className="sub-head-side">
                      <span className="sub-meta">
                        {formatRosterDate(s.created_at.slice(0, 10))}
                      </span>
                      <ConfirmButton
                        action={deleteRosterSubmissionAction}
                        hidden={{ id: s.id }}
                        confirmText={`Delete ${s.player_name}'s roster response? (This won't remove the player from the roster.)`}
                        className="row-delete"
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  </div>

                  {s.accepted ? (
                    <p className="sub-team">
                      Roster spot on{" "}
                      {teamLink ? (
                        <Link href={teamLink} className="sub-team-link">
                          {teamName}
                        </Link>
                      ) : (
                        <span className="sub-team-name">
                          {teamName ?? "a team"}
                        </span>
                      )}
                      {s.division ? (
                        <span className="sub-team-div">
                          {" "}
                          · {divisionLabel(s.current_division ?? s.division)}
                        </span>
                      ) : null}
                      {!teamLink && teamName ? (
                        <span className="sub-team-removed"> (team removed)</span>
                      ) : null}
                    </p>
                  ) : null}

                  {details.length > 0 ? (
                    <dl className="sub-grid">
                      {details.map((d) => (
                        <div key={d.label} className="sub-field">
                          <dt className="sub-field-label">{d.label}</dt>
                          <dd className="sub-field-value">{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="sub-empty-detail">No additional details provided.</p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
