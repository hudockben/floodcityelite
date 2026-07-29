import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { SPORTS, sportLabel } from "../teams/divisions";
import AddCoachForm from "./add-coach-form";
import CoachDirectory from "./coach-directory";
import { ensureCoachesSchema } from "./schema";
import { resolveSport, type CoachRow, type Sport } from "./coaches";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContactInfoPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const sport = resolveSport(firstParam(params.sport));

  // Both sports are loaded so each tab can show its count; the list is small
  // (one company's college contacts) and the tabs read as a pair.
  let coaches: CoachRow[] = [];
  let loadError = false;

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureCoachesSchema();

    coaches = (await sql()`
      SELECT
        id, sport, school_name, coach_name, coach_title, division_level,
        conference, cell_phone, email, website, city, state, notes
      FROM college_coaches
      WHERE company_id = ${session.companyId}
      ORDER BY school_name, coach_name NULLS LAST, id
    `) as CoachRow[];
  } catch (err) {
    console.error("Contact Info load error:", err);
    loadError = true;
  }

  const countBySport = new Map<Sport, number>();
  for (const coach of coaches) {
    countBySport.set(coach.sport, (countBySport.get(coach.sport) ?? 0) + 1);
  }
  const forSport = coaches.filter((c) => c.sport === sport);

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Contact Info</h1>
          <p>
            College coach contacts, kept separately for baseball and softball —
            school, coach, cell, email, website, division level, and conference.
          </p>
        </div>

        {/* Sport selector */}
        <nav className="subtabs" aria-label="Sport">
          {SPORTS.map((s) => {
            const active = s.value === sport;
            const count = countBySport.get(s.value) ?? 0;
            return (
              <Link
                key={s.value}
                href={`/contact-info?sport=${s.value}`}
                className={`subtab${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {s.label}
                {count > 0 ? <span className="subtab-count">{count}</span> : null}
              </Link>
            );
          })}
        </nav>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load contacts</p>
            <p className="empty-sub">
              The contacts table may still be getting set up. Refresh in a moment
              — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* Step 1 — add a college contact to this sport's list */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">1</span> Add a {sportLabel(sport)}{" "}
                college contact
              </h2>
              <p>
                Fill in what you have — only the school name is required. The
                contact is added to the {sportLabel(sport)} list.
              </p>
            </div>

            <AddCoachForm sport={sport} />
          </section>

          {/* Step 2 — the sport's contact list */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">2</span> {sportLabel(sport)} college
                coaches
              </h2>
              <p>
                {forSport.length}{" "}
                {forSport.length === 1 ? "school" : "schools"} on the{" "}
                {sportLabel(sport).toLowerCase()} list. Phone, email, and website
                are tap-to-open; use Edit to update a contact.
              </p>
            </div>

            <CoachDirectory sport={sport} coaches={forSport} />
          </section>
        </>
      )}
    </div>
  );
}
