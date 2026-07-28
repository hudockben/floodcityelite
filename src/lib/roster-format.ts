// ---------------------------------------------------------------------------
// Roster date formatting — a pure, dependency-free helper.
//
// Lives apart from `roster-submissions.ts` (which imports the Neon client) so
// that client components — e.g. the interactive Roster Submissions list — can
// format dates without pulling the database client into the browser bundle.
// ---------------------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a "YYYY-MM-DD" date without going through a Date object, which would
// otherwise shift the day across time zones. Mirrors the payroll formatter.
export function formatRosterDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const monthIndex = Number(m) - 1;
  if (!y || !MONTHS[monthIndex] || !d) return iso;
  return `${MONTHS[monthIndex]} ${Number(d)}, ${y}`;
}
