import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatCents } from "../budgets/budget";
import AddSectionForm from "./add-section-form";
import PlayerCountForm from "./player-count-form";
import SectionCard from "./section-card";
import { loadFixedCostBasis, type FixedCostBasis } from "./basis";
import type { FixedCostItem, FixedCostSection } from "./fixed-costs";

export const dynamic = "force-dynamic";

const EMPTY_BASIS: FixedCostBasis = {
  totalCents: 0,
  rosterPlayerCount: 0,
  overrideCount: null,
  playerCount: 0,
  perPlayerCents: 0,
  perPlayer: 0,
};

export default async function FixedCostPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let sections: FixedCostSection[] = [];
  let items: FixedCostItem[] = [];
  let basis = EMPTY_BASIS;
  let loadError = false;

  try {
    // loadFixedCostBasis provisions the tables on first use, so the tab works
    // even if the database predates this feature. Idempotent and memoized.
    basis = await loadFixedCostBasis(session.companyId);

    const [sectionRows, itemRows] = await Promise.all([
      sql()`
        SELECT id, name
        FROM fixed_cost_sections
        WHERE company_id = ${session.companyId}
        ORDER BY id
      `,
      sql()`
        SELECT i.id, i.section_id, i.name, i.amount::text AS amount
        FROM fixed_cost_items i
        JOIN fixed_cost_sections s ON s.id = i.section_id
        WHERE s.company_id = ${session.companyId}
        ORDER BY i.id
      `,
    ]);

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
            time — grouped into sections you name. The total split across your
            players is the fixed cost per player, and the{" "}
            <Link className="inline-link" href="/budgets">
              Budgets
            </Link>{" "}
            tab takes it off each team&apos;s tuition to work out how much of
            every player&apos;s payment reaches the team.
          </p>
        </div>

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
              />
              <span className="fx-tile-note">
                {basis.overrideCount == null
                  ? `from the rosters (${basis.rosterPlayerCount} marked paying this season)`
                  : `manual override · rosters have ${basis.rosterPlayerCount} marked paying`}
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

            <AddSectionForm />
          </section>

          {/* Step 2 — the sheet */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">2</span> Fixed costs
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
                <p className="empty-title">No sections yet</p>
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
