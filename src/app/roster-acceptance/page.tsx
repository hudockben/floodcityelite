import type { Metadata } from "next";
import Link from "next/link";
import FloodCityLogo from "../logo";
import { ensureTeamsSchema } from "../(app)/teams/schema";
import {
  ensureRosterSubmissionsSchema,
  getRosterCompanyId,
  listRosterTeamOptions,
  type RosterTeamOption,
} from "@/lib/roster-submissions";
import RosterAcceptanceForm from "./roster-form";

export const metadata: Metadata = {
  title: "Roster Spot — Flood City Elite",
  description: "Accept or decline your Flood City Elite roster spot.",
};

export const dynamic = "force-dynamic";

// Public roster-acceptance form. Reached from the "Roster Spot" card on the
// login screen — no account needed, so this route is intentionally left out of
// the auth middleware. Responses land in the admin "Roster Submissions" tab, and
// an acceptance also adds the player to the chosen team's roster.
export default async function RosterAcceptancePage() {
  let teams: RosterTeamOption[] = [];

  try {
    // Create the tables on first use so the form works even if the database
    // predates this feature. Both are idempotent and memoized.
    await ensureTeamsSchema();
    await ensureRosterSubmissionsSchema();

    const companyId = await getRosterCompanyId();
    if (companyId != null) {
      teams = await listRosterTeamOptions(companyId);
    }
  } catch (err) {
    // A load error just leaves the team dropdown empty; the form still renders.
    console.error("Roster acceptance page load error:", err);
  }

  return (
    <main className="page">
      <div className="card card-wide">
        <div className="brand">
          <h1 className="logo">
            <FloodCityLogo />
          </h1>
          <p className="tagline">Roster Spot</p>
        </div>

        <div className="card-intro">
          <h2 className="card-intro-title">Accept your roster spot</h2>
          <p className="card-intro-sub">
            Congratulations! Let us know whether the player is accepting a spot
            on the team. If you&apos;re accepting, fill in the player&apos;s
            details and we&apos;ll add them to the roster — no login required.
          </p>
        </div>

        <RosterAcceptanceForm teams={teams} />

        <p className="card-foot">
          <Link href="/" className="card-foot-link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
