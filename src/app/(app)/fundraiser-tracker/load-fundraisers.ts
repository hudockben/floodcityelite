// ---------------------------------------------------------------------------
// Fundraiser Tracker — reading the log
//
// Server-only (it reaches for the database), and shared by the three places
// that render the same rows: the tab itself, the CSV/Excel download, and the
// printed report. One query means the file and the printout can't come out in a
// different order — or hold different columns — than the table on screen.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import type {
  FundraiserEntryRow,
  FundraiserOption,
  PlayerOption,
  TeamOption,
} from "./fundraisers";
import { ensureFundraisersSchema } from "./schema";

/** The fundraisers (campaigns/events) this company has created. */
async function listFundraisers(
  companyId: number,
): Promise<FundraiserOption[]> {
  return (await sql()`
    SELECT
      id,
      name,
      goal::text        AS goal,
      event_date::text  AS event_date
    FROM fundraisers
    WHERE company_id = ${companyId}
    ORDER BY event_date NULLS LAST, name, id
  `) as FundraiserOption[];
}

/**
 * Every entry logged against this company's fundraisers, oldest first — the
 * order the tab's running Total column accumulates in, and the order all three
 * surfaces read them in. See `ledgerRows`.
 */
async function listFundraiserEntries(
  companyId: number,
): Promise<FundraiserEntryRow[]> {
  return (await sql()`
    SELECT
      fe.id,
      fe.raised_on::text AS raised_on,
      fe.amount::text    AS amount,
      f.id               AS fundraiser_id,
      f.name             AS fundraiser_name,
      t.id               AS team_id,
      t.name             AS team_name,
      t.division,
      pl.id              AS player_id,
      pl.player_name
    FROM fundraiser_entries fe
    JOIN fundraisers f  ON f.id = fe.fundraiser_id
    JOIN teams t        ON t.id = fe.team_id
    LEFT JOIN players pl ON pl.id = fe.player_id
    WHERE t.company_id = ${companyId}
    ORDER BY fe.raised_on, fe.id
  `) as FundraiserEntryRow[];
}

/** The teams and players behind the tab's Division → Team → Player selects. */
async function listTeams(companyId: number): Promise<TeamOption[]> {
  return (await sql()`
    SELECT id, name, division
    FROM teams
    WHERE company_id = ${companyId}
    ORDER BY name
  `) as TeamOption[];
}

async function listPlayers(companyId: number): Promise<PlayerOption[]> {
  return (await sql()`
    SELECT pl.id, pl.team_id, pl.player_name
    FROM players pl
    JOIN teams t ON t.id = pl.team_id
    WHERE t.company_id = ${companyId}
    ORDER BY pl.player_name
  `) as PlayerOption[];
}

export type FundraiserData = {
  teams: TeamOption[];
  players: PlayerOption[];
  fundraisers: FundraiserOption[];
  entries: FundraiserEntryRow[];
};

/** Everything the tab renders, in one round trip. */
export async function loadFundraiserData(
  companyId: number,
): Promise<FundraiserData> {
  // Create the fundraiser tables on first use so the tab works even if the
  // database predates this feature. Idempotent and memoized.
  await ensureFundraisersSchema();

  const [teams, players, fundraisers, entries] = await Promise.all([
    listTeams(companyId),
    listPlayers(companyId),
    listFundraisers(companyId),
    listFundraiserEntries(companyId),
  ]);

  return { teams, players, fundraisers, entries };
}

/** Just the entries, for the CSV/Excel download. */
export async function loadFundraiserEntries(
  companyId: number,
): Promise<FundraiserEntryRow[]> {
  await ensureFundraisersSchema();
  return listFundraiserEntries(companyId);
}

/**
 * What the printed report needs: the entries and the fundraisers they were
 * raised toward, for the per-fundraiser summary.
 */
export async function loadFundraiserReport(companyId: number): Promise<{
  fundraisers: FundraiserOption[];
  entries: FundraiserEntryRow[];
}> {
  await ensureFundraisersSchema();

  const [fundraisers, entries] = await Promise.all([
    listFundraisers(companyId),
    listFundraiserEntries(companyId),
  ]);

  return { fundraisers, entries };
}
