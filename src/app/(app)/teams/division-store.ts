// ---------------------------------------------------------------------------
// Teams tab — the company's divisions
//
// Divisions used to be three hardcoded slugs. They're company-owned rows now,
// so every page that shows a division selector, filter, or label loads the list
// through here and passes it down.
//
// Server-only (uses the DB). Imported by server components and server actions,
// never by a client component — a client component takes the list as a prop.
// The `divisions` table itself is created in schema.ts (ensureTeamsSchema),
// which listDivisions ensures before reading.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { ensureTeamsSchema } from "./schema";
import { BUILTIN_DIVISIONS, type Division, type Sport } from "./divisions";

type DivisionRecord = {
  slug: string;
  label: string;
  default_sport: Sport;
};

/**
 * Every division this company runs, in display order.
 *
 * Guarantees a non-empty list: a company that has never had a `divisions` row
 * (any company, until this shipped) is seeded with the built-in three, so the
 * Teams tab looks and behaves exactly as it did. Any division slug already in
 * use by a team or season but missing from the table is adopted too, so no
 * existing team can end up in a division the app won't show.
 */
export async function listDivisions(companyId: number): Promise<Division[]> {
  await ensureTeamsSchema();
  await seedDivisions(companyId);

  const rows = await sql()`
    SELECT slug, label, default_sport
    FROM divisions
    WHERE company_id = ${companyId}
    ORDER BY sort_order, label, id
  `;

  return (rows as DivisionRecord[]).map((r) => ({
    slug: r.slug,
    label: r.label,
    defaultSport: r.default_sport,
  }));
}

/**
 * listDivisions, but it never throws: a database error falls back to the
 * built-in divisions.
 *
 * For the print views, whose job is to render a document even when a query
 * behind it failed — the report's own "couldn't load" note is what tells the
 * reader something went wrong, not a 500 in place of the page.
 */
export async function listDivisionsSafe(companyId: number): Promise<Division[]> {
  try {
    return await listDivisions(companyId);
  } catch (err) {
    console.error("listDivisions error:", err);
    return BUILTIN_DIVISIONS;
  }
}

/** Whether a slug is one of this company's divisions. */
export async function divisionExists(
  companyId: number,
  slug: string,
): Promise<boolean> {
  // Callers are server actions that may run before anything has touched the
  // schema this cold start; the ensure is memoized, so this is near-free.
  await ensureTeamsSchema();
  const rows = await sql()`
    SELECT 1 FROM divisions
    WHERE company_id = ${companyId} AND slug = ${slug}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Give a company with no divisions yet the built-in three, so every company
 * that predates this feature keeps the exact division list it had — teams and
 * seasons already point at these slugs, and now there are rows behind them.
 *
 * The emptiness check is one indexed query and the common path stops there, so
 * this costs a single round trip per page load once a company is seeded.
 *
 * Seeding only when the table is *empty* matters: a company that deliberately
 * removes a division it doesn't run must not have it reappear on the next page
 * load. Removal refuses to take the last division, so a seeded company never
 * falls back to empty and never gets re-seeded.
 */
async function seedDivisions(companyId: number): Promise<void> {
  const db = sql();

  const existing = await db`
    SELECT 1 FROM divisions WHERE company_id = ${companyId} LIMIT 1
  `;
  if (existing.length > 0) return;

  for (const [i, d] of BUILTIN_DIVISIONS.entries()) {
    await db`
      INSERT INTO divisions (company_id, slug, label, default_sport, sort_order)
      VALUES (${companyId}, ${d.slug}, ${d.label}, ${d.defaultSport}, ${i})
      ON CONFLICT (company_id, slug) DO NOTHING
    `;
  }
}
