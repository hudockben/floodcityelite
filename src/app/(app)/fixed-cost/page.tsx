import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatCents } from "../budgets/budget";
import AddSectionForm from "./add-section-form";
import PlayerCountForm from "./player-count-form";
import SectionCard from "./section-card";
import {
  activeSeasonYear,
  emptyBasis,
  listFixedCostYears,
  loadFixedCostBasis,
  resolveFixedCostYear,
  type FixedCostBasis,
} from "./basis";
import YearBar from "./year-bar";
import type { FixedCostItem, FixedCostSection } from "./fixed-costs";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FixedCostPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const yearRaw = firstParam(params.year);
  const requestedYear = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let sections: FixedCostSection[] = [];
  let items: FixedCostItem[] = [];
  let years: number[] = [];
  let basis: FixedCostBasis = emptyBasis(
    Number.isFinite(requestedYear) && requestedYear != null
      ? requestedYear
      : new Date().getFullYear(),
  );
  let loadError = false;

  try {
    // listFixedCostYears provisions the tables on first use, so the tab works
    // even if the database predates this feature. Idempotent and memoized.
    years = await listFixedCostYears(session.companyId);
    const year = resolveFixedCostYear(
      Number.isFinite(requestedYear) ? requestedYear : null,
      years,
      await activeSeasonYear(session.companyId),
    );

    const [loadedBasis, sectionRows, itemRows] = await Promise.all([
      loadFixedCostBasis(session.companyId, year),
      sql()`
        SELECT id, name
        FROM fixed_cost_sections
        WHERE company_id = ${session.companyId} AND season_year = ${year}
        ORDER BY id
      `,
      sql()`
        SELECT i.id, i.section_id, i.name, i.amount::text AS amount
        FROM fixed_cost_items i
        JOIN fixed_cost_sections s ON s.id = i.section_id
        WHERE s.company_id = ${session.companyId} AND s.season_year = ${year}
        ORDER BY i.id
      `,
    ]);

    basis = loadedBasis;

    sections = sectionRows as FixedCostSection[];
    items = itemRows as FixedCostItem[];
  } catch (err) {
    console.error("Fixed Cost load error:", err);
    loadError = true;
  }

  // Group the line items so each section card gets only its own.
  const itemsBySection = new Map<number, FixedCostItem[]>();
  for (const item of items) {
    const list = itemsBySection.get(item.section_id);
    if (list) list.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Fixed Cost</h1>
          <p>
            What the program pays for up front — uniforms, insurance, facility
            time — grouped into sections you name, one sheet per season. The
            total split across that season&apos;s players is the fixed cost per
            player, and the{" "}
            <Link className="inline-link" href="/budgets">
              Budgets
            </Link>{" "}
            tab takes it off the tuition of every team in that season, to work
            out how much of each player&apos;s payment reaches their team.
          </p>
        </div>

        {!loadError && years.length > 0 ? (
          <YearBar years={years} current={basis.year} />
        ) : null}

        {!loadError ? (
          <div className="fx-summary">
            <div className="fx-tile">
              <span className="fx-tile-label">Total fixed cost</span>
              <span className="fx-tile-value">{formatCents(basis.totalCents)}</span>
              <span className="fx-tile-note">
                {sections.length} {sections.length === 1 ? "section" : "sections"}
                {" · "}
                {items.length} {items.length === 1 ? "cost" : "costs"}
              </span>
            </div>

            <div className="fx-tile">
              <span className="fx-tile-label">Split across</span>
              <PlayerCountForm
                override={basis.overrideCount}
                rosterCount={basis.rosterPlayerCount}
                year={basis.year}
              />
              <span className="fx-tile-note">
                {basis.overrideCount == null
                  ? `from the ${basis.year} rosters (${basis.rosterPlayerCount} marked paying)`
                  : `manual override · ${basis.year} rosters have ${basis.rosterPlayerCount} marked paying`}
              </span>
            </div>

            <div className="fx-tile fx-tile-result">
              <span className="fx-tile-label">Fixed cost per player</span>
              <span className="fx-tile-value">
                {formatCents(basis.perPlayerCents)}
              </span>
              <span className="fx-tile-note">
                {basis.playerCount > 0
                  ? "comes off every team's tuition on the Budgets tab"
                  : "add players (or set a count) to split the cost"}
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load fixed costs</p>
            <p className="empty-sub">
              The fixed-cost tables may still be getting set up. Refresh in a
              moment — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* Step 1 — name a section */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">1</span> Add a section
              </h2>
              <p>
                Sections are yours to name — however you group the program&apos;s
                spending is how this sheet reads.
              </p>
            </div>

            <AddSectionForm year={basis.year} />
          </section>

          {/* Step 2 — the sheet */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">2</span> {basis.year} fixed costs
              </h2>
              <p>
                Every cost under its section. Subtotals — and what each works out
                to per player — update as you go.
              </p>
            </div>

            {sections.length === 0 ? (
              <div className="empty">
                <div className="empty-icon" aria-hidden="true">
                  🧾
                </div>
                <p className="empty-title">No sections for {basis.year} yet</p>
                <p className="empty-sub">
                  Add one above — something like Uniforms, Insurance, or Facility
                  — then list what it costs.
                </p>
              </div>
            ) : (
              <div className="fx-sections">
                {sections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    items={itemsBySection.get(section.id) ?? []}
                    playerCount={basis.playerCount}
                  />
                ))}

                <div className="fx-grand">
                  <span className="fx-grand-label">Total fixed cost</span>
                  <span className="fx-grand-value">
                    {formatCents(basis.totalCents)}
                  </span>
                  <span className="fx-grand-per">
                    {basis.playerCount > 0
                      ? `${formatCents(basis.perPlayerCents)} per player across ${basis.playerCount} ${
                          basis.playerCount === 1 ? "player" : "players"
                        }`
                      : "no players to split across yet"}
                  </span>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
