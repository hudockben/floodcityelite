import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ensureTeamsSchema } from "../teams/schema";
import {
  ensureRosterSubmissionsSchema,
  listRosterSubmissions,
  type RosterSubmissionRow,
} from "@/lib/roster-submissions";
import { deleteRosterSubmissionAction } from "./actions";
import SubmissionsList from "./submissions-list";

export const dynamic = "force-dynamic";

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

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Roster Submissions</h1>
        <p>
          Accept/decline responses from the public roster form. Every response
          records the team the spot was for, so a decline shows which roster just
          opened back up. When a parent accepts, the player is added to that
          team&apos;s roster automatically — the team name below links to it.
          Delete a response once it&apos;s been processed, or download what
          you&apos;re looking at as a CSV or Excel file.
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
        <SubmissionsList
          submissions={submissions}
          deleteAction={deleteRosterSubmissionAction}
        />
      )}
    </section>
  );
}
