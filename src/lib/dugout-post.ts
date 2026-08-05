// ---------------------------------------------------------------------------
// The Dugout — what a post is made of
//
// Plain data with no database import, so the admin's client-side compose form
// can have the categories and the field limits without pulling the Neon driver
// into the browser bundle (the same split `payroll-status.ts` makes).
// `lib/dugout.ts` re-exports all of it, so server callers can keep importing
// everything board-related from one place.
//
// A category is what kind of note this is — the thing a parent scanning the
// board wants to spot without reading every post. The slugs are what we store;
// the labels and marks are what the chip on the post shows.
// ---------------------------------------------------------------------------

/**
 * Longest headline a post may carry. Mirrors the `title` VARCHAR(160) column,
 * so the form's maxLength, the server-side check, and the database agree.
 */
export const DUGOUT_TITLE_MAX = 160;

/**
 * How long a post's body may be. The column is TEXT, so this is a product
 * limit rather than a storage one: a note on a board is a few paragraphs, and
 * an unbounded textarea is an unbounded row.
 */
export const DUGOUT_BODY_MAX = 5000;

export type DugoutCategorySlug =
  | "announcement"
  | "game-day"
  | "practice"
  | "weather"
  | "travel"
  | "gear"
  | "fundraiser";

export type DugoutCategory = {
  slug: DugoutCategorySlug;
  label: string;
  /** Emoji shown on the chip. Decorative — the label carries the meaning. */
  mark: string;
};

// In the order the compose form offers them, which is roughly how often a
// coach reaches for each one.
export const DUGOUT_CATEGORIES: DugoutCategory[] = [
  { slug: "announcement", label: "Announcement", mark: "📣" },
  { slug: "game-day", label: "Game Day", mark: "⚾" },
  { slug: "practice", label: "Practice", mark: "🥎" },
  { slug: "weather", label: "Weather Call", mark: "🌧️" },
  { slug: "travel", label: "Travel", mark: "🚌" },
  { slug: "gear", label: "Gear & Uniforms", mark: "🧢" },
  { slug: "fundraiser", label: "Fundraiser", mark: "💵" },
];

export const DEFAULT_DUGOUT_CATEGORY: DugoutCategorySlug = "announcement";

export function isDugoutCategory(value: string): value is DugoutCategorySlug {
  return DUGOUT_CATEGORIES.some((c) => c.slug === value);
}

/**
 * The category a stored slug names, falling back to Announcement.
 *
 * A row written by a newer version of the app (or edited by hand) must still
 * render — a post on the board with an unknown chip is better than a page that
 * throws while a parent is trying to read a rainout notice.
 */
export function dugoutCategory(slug: string): DugoutCategory {
  return (
    DUGOUT_CATEGORIES.find((c) => c.slug === slug) ?? DUGOUT_CATEGORIES[0]
  );
}
