// ---------------------------------------------------------------------------
// Fixed cost — the per-player figure, loaded from the database
//
// Server-only (uses the DB). The Fixed Cost tab renders one season year's
// breakdown; the Budgets tab, its print view, and Homeplate only need the one
// number the budget math subtracts from tuition for the year they're showing,
// so they call loadFixedCostPerPlayer.
//
// Fixed costs are kept per *year* rather than per season row: a season is one
// division's run, but insurance and uniforms are bought once for the whole
// program, so a year's sheet feeds every division's budgets for that year.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { amountToCents } from "../budgets/budget";
import { perPlayerCents, resolvePlayerCount } from "./fixed-costs";
import { ensureFixedCostSchema } from "./schema";

export type FixedCostBasis = {
  /** The season year this basis is for. */
  year: number;
  /** Every section's items for that year, summed, in integer cents. */
  totalCents: number;
  /** Players marked "Paying" on the rosters of that year's seasons. */
  rosterPlayerCount: number;
  /** The manual override for that year, or null when the roster count is used. */
  overrideCount: number | null;
  /** The count actually divided by (override ?? roster count). */
  playerCount: number;
  /** totalCents / playerCount, rounded to the cent. */
  perPlayerCents: number;
  /** The same figure in dollars, for the budget math. */
  perPlayer: number;
};

export function emptyBasis(year: number): FixedCostBasis {
  return {
    year,
    totalCents: 0,
    rosterPlayerCount: 0,
    overrideCount: null,
    playerCount: 0,
    perPlayerCents: 0,
    perPlayer: 0,
  };
}

/**
 * The years the Fixed Cost tab offers, newest first: every year the company has
 * a season for, plus every year that already carries fixed costs (so a sheet
 * can't strand itself if its seasons are later removed), plus the current year
 * so there's always somewhere to start.
 */
export async function listFixedCostYears(companyId: number): Promise<number[]> {
  await ensureFixedCostSchema();

  const rows = await sql()`
    SELECT DISTINCT year FROM (
      SELECT year        FROM seasons            WHERE company_id = ${companyId}
      UNION
      SELECT season_year FROM fixed_cost_sections WHERE company_id = ${companyId}
      UNION
      SELECT EXTRACT(YEAR FROM now())::smallint
    ) y
    ORDER BY year DESC
  `;

  return (rows as { year: number }[]).map((r) => Number(r.year));
}

/**
 * Which year to show: the one asked for when it's on offer, otherwise the
 * company's active season year, otherwise the most recent year available.
 */
export function resolveFixedCostYear(
  requested: number | null,
  years: number[],
  activeYear: number | null,
): number {
  if (requested != null && years.includes(requested)) return requested;
  if (activeYear != null && years.includes(activeYear)) return activeYear;
  return years[0] ?? new Date().getFullYear();
}

/** The company's active season year (the newest active one), if any. */
export async function activeSeasonYear(companyId: number): Promise<number | null> {
  const rows = await sql()`
    SELECT max(year) AS year FROM seasons
    WHERE company_id = ${companyId} AND is_active
  `;
  const year = (rows[0] as { year: number | null } | undefined)?.year;
  return year == null ? null : Number(year);
}

export async function loadFixedCostBasis(
  companyId: number,
  year: number,
): Promise<FixedCostBasis> {
  await ensureFixedCostSchema();

  // One round trip: the year's fixed-cost total, the roster count to divide it
  // across, and that year's manual override if one is set.
  const rows = await sql()`
    SELECT
      (SELECT COALESCE(SUM(i.amount), 0)
         FROM fixed_cost_items i
         JOIN fixed_cost_sections s ON s.id = i.section_id
        WHERE s.company_id = ${companyId} AND s.season_year = ${year})::text AS total,
      -- The program's players that year: those marked Paying on a team in one
      -- of the year's seasons, across every division.
      (SELECT count(*)
         FROM players p
         JOIN teams t   ON t.id = p.team_id
         JOIN seasons s ON s.id = t.season_id
        WHERE t.company_id = ${companyId} AND s.year = ${year} AND p.is_paying)::int
        AS roster_count,
      (SELECT player_count FROM fixed_cost_settings
        WHERE company_id = ${companyId} AND season_year = ${year})
        AS override_count
  `;

  const row = rows[0] as
    | { total: string | null; roster_count: number; override_count: number | null }
    | undefined;
  if (!row) return emptyBasis(year);

  const totalCents = amountToCents(row.total);
  const rosterPlayerCount = Number(row.roster_count) || 0;
  const overrideCount =
    row.override_count == null ? null : Number(row.override_count);
  const playerCount = resolvePlayerCount(overrideCount, rosterPlayerCount);
  const perPlayer = perPlayerCents(totalCents, playerCount);

  return {
    year,
    totalCents,
    rosterPlayerCount,
    overrideCount,
    playerCount,
    perPlayerCents: perPlayer,
    perPlayer: perPlayer / 100,
  };
}

/**
 * Just the per-player dollars for one year, and never throws: the Budgets tab,
 * its print view, and Homeplate all read this, and a fixed-cost problem
 * shouldn't take those pages down. On failure they fall back to "no fixed
 * costs", which leaves each team's portion equal to its tuition — the behaviour
 * from before this tab existed.
 */
export async function loadFixedCostPerPlayer(
  companyId: number,
  year: number,
): Promise<number> {
  try {
    return (await loadFixedCostBasis(companyId, year)).perPlayer;
  } catch (err) {
    console.error("Fixed cost load error:", err);
    return 0;
  }
}
