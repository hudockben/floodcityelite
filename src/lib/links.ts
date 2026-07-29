// ---------------------------------------------------------------------------
// Link helpers for hand-typed contact fields
//
// The contact tables (Contact Info's college coaches, Hotels) take phone
// numbers, emails, and websites as free text, so a cell can hold anything from
// a tidy URL to "ask the front desk". These turn a typed value into an href to
// link it with, or null when there's nothing worth linking — the caller then
// renders the value as plain text.
//
// Plain module: imported by client components, so no server-only code here.
// ---------------------------------------------------------------------------

/**
 * A dialable href for a typed phone number (digits and + only), or null when
 * there's nothing to dial — free text like "ask the office" must not become a
 * `tel:` link to nowhere.
 */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return /\d/.test(digits) ? `tel:${digits}` : null;
}

/**
 * A safe href for a typed website. A bare domain gets https://; anything with
 * a non-http(s) scheme (a `javascript:` URL pasted into the field) returns null
 * so the value renders as plain text instead of becoming a link.
 */
export function websiteHref(website: string): string | null {
  const value = website.trim();
  if (value === "") return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

/** The website as shown in a table cell — no scheme, no trailing slash. */
export function websiteLabel(website: string): string {
  const trimmed = website.trim();
  const stripped = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  // A value that is nothing but a scheme ("https://") strips to empty, which
  // would render as a link with no text — show what was typed instead.
  return stripped === "" ? trimmed : stripped;
}
