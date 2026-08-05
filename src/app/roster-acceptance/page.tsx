import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "../logo";
import { ensureTeamsSchema } from "../(app)/teams/schema";
import {
  ensureRosterSubmissionsSchema,
  getRosterCompanyId,
  listRosterTeamOptions,
  type RosterTeamOption,
} from "@/lib/roster-submissions";
import { currentTenant, tenantIsAmbiguous } from "@/lib/tenant";
import OrganizationPicker from "../organization-picker";
import RosterAcceptanceForm from "./roster-form";

// A parent is accepting a spot with a particular organization, so the tab title
// and description have to name that one. Which it is depends on the request, so
// the metadata is generated per request rather than fixed at build time.
export async function generateMetadata(): Promise<Metadata> {
  // See the payroll form: with no organization identified, naming one in the
  // tab title would be a guess presented as fact.
  if (await tenantIsAmbiguous()) return { title: "Roster Spot" };

  const tenant = await currentTenant();
  return {
    title: `Roster Spot — ${tenant.name}`,
    description: `Accept or decline your ${tenant.name} roster spot.`,
  };
}

export const dynamic = "force-dynamic";

// Public roster-acceptance form. Reached from the "Roster Spot" card on the
// login screen — no account needed, so this route is intentionally left out of
// the auth middleware. Responses land in the admin "Roster Submissions" tab, and
// an acceptance also adds the player to the chosen team's roster.
export default async function RosterAcceptancePage() {
  // Resolved here rather than inside the form because the form is a client
  // component: it can't ask which organization the request belongs to, so the
  // name is handed down for the copy that addresses the parent by it.
  const tenant = await currentTenant();

  // This form carries a child's name, date of birth, school, and both parents'
  // phone numbers, and an acceptance writes them straight onto a roster. If
  // nothing about the request says which organization it is for, that data must
  // not be filed by guesswork — ask first.
  const ambiguous = await tenantIsAmbiguous();
  if (ambiguous) {
    return (
      <main className="page">
        <div className="card">
          {/* No lockup: this page is asking which club this is for, and a logo
              above the question would answer it for them. */}
          <div className="brand">
            <p className="tagline">Roster Spot</p>
          </div>

          <OrganizationPicker title="Which club is this for?" />

          <p className="card-foot">
            <Link href="/" className="card-foot-link">
              ← Back to sign in
            </Link>
          </p>
        </div>
      </main>
    );
  }

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
            <BrandLogo />
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

        <RosterAcceptanceForm teams={teams} orgName={tenant.name} />

        <p className="card-foot">
          <Link href="/" className="card-foot-link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
