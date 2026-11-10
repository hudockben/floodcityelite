// ---------------------------------------------------------------------------
// Fixed cost — the split across teams, loaded from the database
//
// Server-only (uses the DB). The Fixed Cost tab renders one season year's
// breakdown; the Budgets tab, its print view, and Homeplate only need the rule
// that turns a team's tuition into its fixed cost per player for the year
// they're showing, so they call loadFixedCostRule.
//
// Fixed costs are kept per *year* rather than per season row: a season is one
// division's run, but rent, insurance and software are paid once for the whole
// program, so a year's sheet feeds every division's budgets for that year.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { amountToCents, resolvePayingCount } from "../budgets/budget";
import { ensureBudgetsSchema } from "../budgets/schema";
import type { DivisionSlug } from "../teams/divisions";
import {
  DEFAULT_SPLIT_METHOD,
  NO_FIXED_COST,
  isSplitMethod,
  perPlayerCents,
  resolvePlayerCount,
  tuitionContributionCents,
  type FixedCostRule,
  type SplitMethod,
} from "./fixed-costs";
import { ensureFixedCostSchema } from "./schema";

/** One of the year's teams, as the split sees it. */
export type FixedCostTeam = {
  id: number;
  name: string;
  division: DivisionSlug;
  /**
   * The paying players the team's budget runs on: the Budgets tab's override
   * when set, otherwise the roster's players marked Paying.
   */
  payingCount: number;
  /** Tuition per player from the team's budget, in cents; 0 when not entered. */
  tuitionCents: number;
  /**
   * The team's budget overrides its portion to team budget by hand, so no
   * fixed cost is taken off its tuition whichever way the total is split.
   */
  manualPortion: boolean;
};

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
  /** Equal per player: totalCents / playerCount, rounded to the cent. */
  perPlayerCents: number;
  /** How the year's total is split across its teams. */
  method: SplitMethod;
  /**
   * Share of tuition: every team's paying players × tuition per player, summed
   * — the tuition the total is spread over — in integer cents.
   */
  tuitionBaseCents: number;
  /** The year's teams, every division, for the team-by-team breakdown. */
  teams: FixedCostTeam[];
  /** The figures above, reduced to what the budget math needs. */
  rule: FixedCostRule;
};

export function emptyBasis(year: number): FixedCostBasis {
  return {
    year,
    totalCents: 0,
    rosterPlayerCount: 0,
    overrideCount: null,
    playerCount: 0,
    perPlayerCents: 0,
    method: DEFAULT_SPLIT_METHOD,
    tuitionBaseCents: 0,
    teams: [],
    rule: NO_FIXED_COST,
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

type TeamRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  paying_count: number;
  paying_players: number | null;
  tuition_per_player: string | null;
  manual_portion: boolean;
};

export async function loadFixedCostBasis(
  companyId: number,
  year: number,
): Promise<FixedCostBasis> {
  // The team list reads team_budgets, which hangs off teams — so the fixed-cost
  // tables (which provision teams first) go before the budgets table. Both are
  // idempotent and memoized.
  await ensureFixedCostSchema();
  await ensureBudgetsSchema();

  const [settingRows, teamRows] = await Promise.all([
    // The year's fixed-cost total, the roster count to divide it across, and
    // that year's settings: the count override and how the total is split.
    sql()`
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
          AS override_count,
        (SELECT split_method FROM fixed_cost_settings
          WHERE company_id = ${companyId} AND season_year = ${year})
          AS split_method
    `,
    // Every team in one of the year's seasons, with the budget inputs the split
    // needs. The paying count is resolved below with the Budgets tab's own rule
    // so the tuition base is built from exactly the figures each card shows.
    sql()`
      SELECT
        t.id,
        t.name,
        t.division,
        (SELECT count(*) FROM players p
           WHERE p.team_id = t.id AND p.is_paying)::int AS paying_count,
        b.paying_players,
        b.tuition_per_player::text                     AS tuition_per_player,
        (b.portion_to_team_budget IS NOT NULL)         AS manual_portion
      FROM teams t
      JOIN seasons s ON s.id = t.season_id
      LEFT JOIN team_budgets b ON b.team_id = t.id
      WHERE t.company_id = ${companyId} AND s.year = ${year}
      ORDER BY t.name, t.id
    `,
  ]);

  const row = settingRows[0] as
    | {
        total: string | null;
        roster_count: number;
        override_count: number | null;
        split_method: string | null;
      }
    | undefined;
  if (!row) return emptyBasis(year);

  const totalCents = amountToCents(row.total);
  const rosterPlayerCount = Number(row.roster_count) || 0;
  const overrideCount =
    row.override_count == null ? null : Number(row.override_count);
  const playerCount = resolvePlayerCount(overrideCount, rosterPlayerCount);
  const perPlayer = perPlayerCents(totalCents, playerCount);
  const method = isSplitMethod(row.split_method)
    ? row.split_method
    : DEFAULT_SPLIT_METHOD;

  const teams: FixedCostTeam[] = (teamRows as TeamRow[]).map((r) => ({
    id: Number(r.id),
    name: r.name,
    division: r.division,
    payingCount: resolvePayingCount(
      r.paying_players == null ? null : Number(r.paying_players),
      Number(r.paying_count) || 0,
    ),
    tuitionCents: amountToCents(r.tuition_per_player),
    manualPortion: Boolean(r.manual_portion),
  }));

  const tuitionBaseCents = teams.reduce(
    (sum, t) => sum + tuitionContributionCents(t.payingCount, t.tuitionCents),
    0,
  );

  return {
    year,
    totalCents,
    rosterPlayerCount,
    overrideCount,
    playerCount,
    perPlayerCents: perPlayer,
    method,
    tuitionBaseCents,
    teams,
    rule: {
      method,
      totalCents,
      perPlayerCents: perPlayer,
      tuitionBaseCents,
    },
  };
}

/**
 * Just the rule for one year, and never throws: the Budgets tab, its print
 * view, and Homeplate all read this, and a fixed-cost problem shouldn't take
 * those pages down. On failure they fall back to "no fixed costs", which leaves
 * each team's portion equal to its tuition — the behaviour from before this tab
 * existed.
 */
export async function loadFixedCostRule(
  companyId: number,
  year: number,
): Promise<FixedCostRule> {
  try {
    return (await loadFixedCostBasis(companyId, year)).rule;
  } catch (err) {
    console.error("Fixed cost load error:", err);
    return NO_FIXED_COST;
  }
}
