// ---------------------------------------------------------------------------
// Teams tab — seasons
//
// A season is one division's run in a given year (Spring/Summer Baseball 2026,
// Softball 2027, …). Each division rolls over on its own calendar, so a season
// is keyed by (company, division, year). A team belongs to exactly one season
// via teams.season_id, and rosters/schedules/budgets inherit it through the
// team. These server helpers resolve which season a page shows and list a
// division's seasons for the year picker.
//
// Server-only (uses the DB). Imported by server components and server actions,
// never by a client component. The season table itself is created in schema.ts
// (ensureTeamsSchema), which every caller ensures before these run.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import {
  divisionLabel,
  type Division,
  type DivisionSlug,
} from "./divisions";

export type Season = {
  id: number;
  division: DivisionSlug;
  year: number;
  label: string | null;
  is_active: boolean;
};

// Friendly name for a season: a custom label when one is set, otherwise the
// year plus the division (e.g. "2026 Spring/Summer Baseball").
export function seasonLabel(
  s: Pick<Season, "year" | "label" | "division">,
  divisions: Division[],
): string {
  const custom = s.label?.trim();
  return custom ? custom : `${s.year} ${divisionLabel(s.division, divisions)}`;
}

// All of a division's seasons, newest year first (drives the year picker).
export async function listSeasons(
  companyId: number,
  division: DivisionSlug,
): Promise<Season[]> {
  const rows = await sql()`
    SELECT id, division, year, label, is_active
    FROM seasons
    WHERE company_id = ${companyId} AND division = ${division}
    ORDER BY year DESC
  `;
  return rows as Season[];
}

// Resolve which season a page should show for a division: the ?year= match if
// one is given and exists, otherwise the active season, otherwise the most
// recent. Guarantees at least one season exists — a division that has never had
// one (e.g. a brand-new company) gets the current calendar year created and
// made active. Returns the chosen season plus the full list so the caller can
// render the picker in one round trip.
export async function resolveSeason(
  companyId: number,
  division: DivisionSlug,
  yearParam?: number | null,
): Promise<{ current: Season; seasons: Season[] }> {
  let seasons = await listSeasons(companyId, division);

  if (seasons.length === 0) {
    const year = new Date().getFullYear();
    await sql()`
      INSERT INTO seasons (company_id, division, year, is_active)
      VALUES (${companyId}, ${division}, ${year}, true)
      ON CONFLICT (company_id, division, year) DO NOTHING
    `;
    seasons = await listSeasons(companyId, division);
  }

  const wanted =
    yearParam != null ? seasons.find((s) => s.year === yearParam) : undefined;
  const current = wanted ?? seasons.find((s) => s.is_active) ?? seasons[0];
  return { current, seasons };
}
