// ---------------------------------------------------------------------------
// Fixed cost — the per-player figure, loaded from the database
//
// Server-only (uses the DB). The Fixed Cost tab renders the whole breakdown;
// the Budgets tab, its print view, and Homeplate only need the one number the
// budget math subtracts from tuition, so they call loadFixedCostPerPlayer.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { amountToCents } from "../budgets/budget";
import { perPlayerCents, resolvePlayerCount } from "./fixed-costs";
import { ensureFixedCostSchema } from "./schema";

export type FixedCostBasis = {
  /** Every section's items, summed, in integer cents. */
  totalCents: number;
  /** Players marked "Paying" on the active seasons' rosters. */
  rosterPlayerCount: number;
  /** The manual override, or null when the roster count is being used. */
  overrideCount: number | null;
  /** The count actually divided by (override ?? roster count). */
  playerCount: number;
  /** totalCents / playerCount, rounded to the cent. */
  perPlayerCents: number;
  /** The same figure in dollars, for the budget math. */
  perPlayer: number;
};

const EMPTY: FixedCostBasis = {
  totalCents: 0,
  rosterPlayerCount: 0,
  overrideCount: null,
  playerCount: 0,
  perPlayerCents: 0,
  perPlayer: 0,
};

export async function loadFixedCostBasis(
  companyId: number,
): Promise<FixedCostBasis> {
  await ensureFixedCostSchema();

  // One round trip: the fixed-cost total, the roster count to divide it
  // across, and the manual override if one is set.
  const rows = await sql()`
    SELECT
      (SELECT COALESCE(SUM(i.amount), 0)
         FROM fixed_cost_items i
         JOIN fixed_cost_sections s ON s.id = i.section_id
        WHERE s.company_id = ${companyId})::text AS total,
      -- The program's current players: those marked Paying on a team in an
      -- active season. Archived seasons' rosters don't dilute the split.
      (SELECT count(*)
         FROM players p
         JOIN teams t   ON t.id = p.team_id
         JOIN seasons s ON s.id = t.season_id
        WHERE t.company_id = ${companyId} AND s.is_active AND p.is_paying)::int
        AS roster_count,
      (SELECT player_count FROM fixed_cost_settings WHERE company_id = ${companyId})
        AS override_count
  `;

  const row = rows[0] as
    | { total: string | null; roster_count: number; override_count: number | null }
    | undefined;
  if (!row) return EMPTY;

  const totalCents = amountToCents(row.total);
  const rosterPlayerCount = Number(row.roster_count) || 0;
  const overrideCount =
    row.override_count == null ? null : Number(row.override_count);
  const playerCount = resolvePlayerCount(overrideCount, rosterPlayerCount);
  const perPlayer = perPlayerCents(totalCents, playerCount);

  return {
    totalCents,
    rosterPlayerCount,
    overrideCount,
    playerCount,
    perPlayerCents: perPlayer,
    perPlayer: perPlayer / 100,
  };
}

/**
 * Just the per-player dollars, and never throws: the Budgets tab, its print
 * view, and Homeplate all read this, and a fixed-cost problem shouldn't take
 * those pages down. On failure they fall back to "no fixed costs", which leaves
 * each team's portion equal to its tuition — the behaviour from before this tab
 * existed.
 */
export async function loadFixedCostPerPlayer(companyId: number): Promise<number> {
  try {
    return (await loadFixedCostBasis(companyId)).perPlayer;
  } catch (err) {
    console.error("Fixed cost load error:", err);
    return 0;
  }
}
