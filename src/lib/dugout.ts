// ---------------------------------------------------------------------------
// The Dugout — shared schema, data access, types, and formatters
//
// The Dugout is the parents' message board: staff post, families read. Two
// sides use this module, and the split between them is the whole point of the
// feature:
//
//   • the public board at /dugout (no login) reads *published* posts back;
//   • the admin "Dugout" tab writes them — composing, editing, pinning,
//     unpublishing, deleting.
//
// Nothing here writes on behalf of a visitor. Every write takes the company id
// off the signed-in admin's session (see the tab's actions), while the public
// read resolves its company from the tenant the request landed on — so the only
// way onto the board is through a staff login.
//
// A *post* is a title, a body, a category (see dugout-post.ts), and an
// optional division: null means the whole program, a division slug means it is
// aimed at that division's families. `is_pinned` holds a post at the top of the
// board (the note taped to the dugout wall); `is_published` is what separates a
// draft from something parents can see.
//
// Plain server-side module (uses the Neon client). Imported by the public page
// and by the protected admin page/actions.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

// The categories and the field limits live in lib/dugout-post.ts — plain data
// with no database import, so the admin's client-side form can have them
// without the Neon driver coming with them. Re-exported so server callers have
// one import.
export {
  DEFAULT_DUGOUT_CATEGORY,
  DUGOUT_BODY_MAX,
  DUGOUT_CATEGORIES,
  DUGOUT_TITLE_MAX,
  dugoutCategory,
  isDugoutCategory,
} from "./dugout-post";
export type { DugoutCategory, DugoutCategorySlug } from "./dugout-post";

// A saved post. `created_at` / `updated_at` arrive as timestamp strings;
// `edited` is computed in the query so the board can say a post was changed
// after it went up without comparing timestamps in two places.
export type DugoutPostRow = {
  id: number;
  title: string;
  body: string;
  category: string;
  division: string | null; // a teams division slug, or null = whole program
  is_pinned: boolean;
  is_published: boolean;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  edited: boolean;
};

// What the compose form collects. The action validates first; this module just
// persists what it is given.
export type DugoutPostInput = {
  companyId: number;
  title: string;
  body: string;
  category: string;
  division: string | null;
  isPinned: boolean;
  isPublished: boolean;
  authorName: string | null;
};

// Ensure the `dugout_posts` table exists before it is read or written. Like the
// other tabs' schema helpers this lets the feature work on a database that
// predates it without a separate migration step. The DDL mirrors db/schema.sql
// and db/setup.mjs and is idempotent.
//
// Memoized per server instance *per organization*: the DDL runs once per cold
// start for each tenant. It has to be keyed by tenant code, because each
// organization has its own database and `sql()` points at whichever one the
// request resolved to. A single shared promise would provision only the
// organization that happened to warm the instance and hand every later request
// from the other one an already-resolved promise, so its database would never
// see the table — an intermittent "relation does not exist" that depends on who
// hit the instance first. A failed provision drops that organization's entry so
// a later request retries, leaving the other's intact.
const ensured = new Map<string, Promise<void>>();

export async function ensureDugoutSchema(): Promise<void> {
  const { code } = await currentTenant();
  let pending = ensured.get(code);
  if (!pending) {
    pending = provision().catch((err) => {
      ensured.delete(code);
      throw err;
    });
    ensured.set(code, pending);
  }
  return pending;
}

async function provision(): Promise<void> {
  const db = sql();

  // One note on the parents' message board, written by staff. Only the title
  // and body are required. `division` is a teams division slug (or null for a
  // program-wide notice), `is_pinned` holds it at the top of the board, and
  // `is_published` is what parents can see — an unpublished post is a draft.
  // Belongs to a company so the board is scoped like the rest of the app.
  await db`
    CREATE TABLE IF NOT EXISTS dugout_posts (
      id            SERIAL        PRIMARY KEY,
      company_id    INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title         VARCHAR(160)  NOT NULL,
      body          TEXT          NOT NULL,
      category      VARCHAR(24)   NOT NULL DEFAULT 'announcement',
      division      VARCHAR(32),
      is_pinned     BOOLEAN       NOT NULL DEFAULT false,
      is_published  BOOLEAN       NOT NULL DEFAULT true,
      author_name   VARCHAR(160),
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_dugout_posts_company_id ON dugout_posts (company_id)`;
}

/**
 * The company id the public board reads against. That page has no session, so
 * the organization is the tenant the request resolved to (its hostname, its
 * `?c=` link, or the tenant cookie) — see lib/tenant.
 *
 * Each organization has its own database, so `sql()` is already pointed at
 * theirs and this is really "the company row in *this* database"; matching on
 * the tenant's code keeps it exact rather than assuming the database holds
 * exactly one company. Returns null when that row does not exist yet (before
 * db:setup has been run against the database).
 */
export async function getDugoutCompanyId(): Promise<number | null> {
  const tenant = await currentTenant();
  const rows = await sql()`
    SELECT id FROM companies WHERE code = ${tenant.code} LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].id as number) : null;
}

// Both queries below order the board the same way — pinned first, then newest —
// so a coach editing it sees it as a parent will.

/**
 * What parents see: published posts only, optionally narrowed to one division.
 *
 * A division filter keeps program-wide posts (division IS NULL) as well as that
 * division's — a rainout notice for the whole club is not something to hide
 * from a family who filtered down to their own team's division.
 */
export async function listPublishedDugoutPosts(
  companyId: number,
  division: string | null,
): Promise<DugoutPostRow[]> {
  const rows = await sql()`
    SELECT
      id,
      title,
      body,
      category,
      division,
      is_pinned,
      is_published,
      author_name,
      created_at::text AS created_at,
      updated_at::text AS updated_at,
      (updated_at > created_at + interval '1 minute') AS edited
    FROM dugout_posts
    WHERE company_id = ${companyId}
      AND is_published
      AND (${division}::text IS NULL OR division IS NULL OR division = ${division}::text)
    ORDER BY is_pinned DESC, created_at DESC, id DESC
  `;
  return rows as DugoutPostRow[];
}

/** Every post, drafts included — the admin tab's view of the board. */
export async function listDugoutPosts(
  companyId: number,
): Promise<DugoutPostRow[]> {
  const rows = await sql()`
    SELECT
      id,
      title,
      body,
      category,
      division,
      is_pinned,
      is_published,
      author_name,
      created_at::text AS created_at,
      updated_at::text AS updated_at,
      (updated_at > created_at + interval '1 minute') AS edited
    FROM dugout_posts
    WHERE company_id = ${companyId}
    ORDER BY is_pinned DESC, created_at DESC, id DESC
  `;
  return rows as DugoutPostRow[];
}

// Put a new post on the board.
export async function insertDugoutPost(input: DugoutPostInput): Promise<void> {
  await sql()`
    INSERT INTO dugout_posts
      (company_id, title, body, category, division, is_pinned, is_published, author_name)
    VALUES (
      ${input.companyId},
      ${input.title},
      ${input.body},
      ${input.category},
      ${input.division},
      ${input.isPinned},
      ${input.isPublished},
      ${input.authorName}
    )
  `;
}

// Edit a post. Scoped to the company so one organization cannot touch another's
// board. `updated_at` moves, which is what puts the "edited" note on the card;
// `created_at` does not, so the board keeps its order when a typo is fixed.
export async function updateDugoutPost(
  companyId: number,
  id: number,
  fields: {
    title: string;
    body: string;
    category: string;
    division: string | null;
    isPinned: boolean;
    isPublished: boolean;
  },
): Promise<void> {
  await sql()`
    UPDATE dugout_posts
    SET title = ${fields.title},
        body = ${fields.body},
        category = ${fields.category},
        division = ${fields.division},
        is_pinned = ${fields.isPinned},
        is_published = ${fields.isPublished},
        updated_at = now()
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// Pin a post to the top of the board, or take it back down. Deliberately not
// routed through `updateDugoutPost`: this is a one-click toggle, and it must
// not touch `updated_at` — pinning a three-week-old notice is not an edit of
// it, and stamping one would tell every parent it had changed.
export async function setDugoutPostPinned(
  companyId: number,
  id: number,
  pinned: boolean,
): Promise<void> {
  await sql()`
    UPDATE dugout_posts
    SET is_pinned = ${pinned}
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// Publish a draft, or pull a post back off the board. Same reasoning as
// pinning: it changes who can see the post, not what it says.
export async function setDugoutPostPublished(
  companyId: number,
  id: number,
  published: boolean,
): Promise<void> {
  await sql()`
    UPDATE dugout_posts
    SET is_published = ${published}
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// Take a post off the board for good, scoped to the company.
export async function deleteDugoutPost(
  companyId: number,
  id: number,
): Promise<void> {
  await sql()`
    DELETE FROM dugout_posts
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// --- formatters ------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The date a post went up, as "Aug 5, 2026".
 *
 * Takes the leading date off the timestamp rather than going through a Date
 * object, which would otherwise shift the day across time zones — the same
 * treatment the payroll dates get.
 */
export function formatDugoutDate(timestamp: string | null | undefined): string {
  if (!timestamp) return "—";
  const [y, m, d] = timestamp.slice(0, 10).split("-");
  const monthIndex = Number(m) - 1;
  if (!y || !MONTHS[monthIndex] || !d) return timestamp.slice(0, 10);
  return `${MONTHS[monthIndex]} ${Number(d)}, ${y}`;
}
