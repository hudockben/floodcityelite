import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatCents } from "../budgets/budget";
import AddSectionForm from "./add-section-form";
import PlayerCountForm from "./player-count-form";
import SectionCard from "./section-card";
import SplitMethodForm from "./split-method-form";
import TeamSplit from "./team-split";
import {
  activeSeasonYear,
  emptyBasis,
  listFixedCostYears,
  loadFixedCostBasis,
  resolveFixedCostYear,
  type FixedCostBasis,
} from "./basis";
import YearBar from "./year-bar";
import {
  formatPercent,
  tuitionRate,
  type FixedCostItem,
  type FixedCostSection,
} from "./fixed-costs";

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

  // Share of tuition: one rate for the year, and how many of its teams have a
  // tuition for it to apply to.
  const byTuition = basis.method === "tuition";
  const rate = tuitionRate(basis.totalCents, basis.tuitionBaseCents);
  const pricedTeams = basis.teams.filter((t) => t.tuitionCents > 0).length;
  const unpricedTeams = basis.teams.length - pricedTeams;

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
            What the program pays for whichever team a player is on — rent,
            insurance, software — grouped into sections you name, one sheet per
            season. The total is split across that season&apos;s teams, either
            the same dollars for every player or the same share of every
            team&apos;s tuition, and the{" "}
            <Link className="inline-link" href="/budgets">
              Budgets
            </Link>{" "}
            tab takes each team&apos;s fixed cost per player off its tuition, to
            work out how much of each player&apos;s payment reaches their team.
          </p>
        </div>

        {!loadError && years.length > 0 ? (
          <YearBar years={years} current={basis.year} />
        ) : null}

        {!loadError ? (
          <SplitMethodForm method={basis.method} year={basis.year} />
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

            {byTuition ? (
              <>
                <div className="fx-tile">
                  <span className="fx-tile-label">Split across</span>
                  <span className="fx-tile-value">
                    {formatCents(basis.tuitionBaseCents)}
                  </span>
                  <span className="fx-tile-note">
                    tuition from {pricedTeams} of {basis.teams.length}{" "}
                    {basis.teams.length === 1 ? "team" : "teams"} — paying
                    players × tuition per player
                    {unpricedTeams > 0
                      ? ` · ${unpricedTeams} with no tuition yet carry none of it`
                      : ""}
                  </span>
                </div>

                <div className="fx-tile fx-tile-result">
                  <span className="fx-tile-label">Fixed cost rate</span>
                  <span className="fx-tile-value">
                    {basis.tuitionBaseCents > 0 ? formatPercent(rate) : "—"}
                  </span>
                  <span className="fx-tile-note">
                    {basis.tuitionBaseCents > 0
                      ? "of every team's tuition — comes off on the Budgets tab"
                      : "enter tuition on the Budgets tab to work out the rate"}
                  </span>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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
                to {byTuition ? "as a share of tuition" : "per player"} — update
                as you go.
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
                    method={basis.method}
                    playerCount={basis.playerCount}
                    tuitionBaseCents={basis.tuitionBaseCents}
                  />
                ))}

                <div className="fx-grand">
                  <span className="fx-grand-label">Total fixed cost</span>
                  <span className="fx-grand-value">
                    {formatCents(basis.totalCents)}
                  </span>
                  <span className="fx-grand-per">
                    {byTuition
                      ? basis.tuitionBaseCents > 0
                        ? `${formatPercent(rate)} of ${formatCents(basis.tuitionBaseCents)} tuition`
                        : "no tuition to split across yet"
                      : basis.playerCount > 0
                        ? `${formatCents(basis.perPlayerCents)} per player across ${basis.playerCount} ${
                            basis.playerCount === 1 ? "player" : "players"
                          }`
                        : "no players to split across yet"}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Step 3 — how the total lands on each team */}
          <section className="panel" id="by-team">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">3</span> What each team carries
              </h2>
              <p>
                Every {basis.year} team, both ways of splitting the total. Each
                figure is that team&apos;s fixed cost per player; under it is
                what&apos;s left of the tuition to reach the team budget. The
                highlighted column is the one the Budgets tab uses — switch it
                with <strong>Split</strong> at the top.
              </p>
            </div>

            {basis.teams.length === 0 ? (
              <div className="empty">
                <div className="empty-icon" aria-hidden="true">
                  📋
                </div>
                <p className="empty-title">No teams in {basis.year} yet</p>
                <p className="empty-sub">
                  Teams in any of the year&apos;s seasons show up here with
                  their tuition from the Budgets tab.
                </p>
              </div>
            ) : (
              <TeamSplit
                teams={basis.teams}
                method={basis.method}
                totalCents={basis.totalCents}
                perPlayerCents={basis.perPlayerCents}
                tuitionBaseCents={basis.tuitionBaseCents}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
