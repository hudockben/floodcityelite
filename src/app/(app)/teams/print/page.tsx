import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  PLAYER_FIELDS,
  resolveDivision,
  sportLabel,
  type PlayerRow,
  type TeamRow,
} from "../divisions";
import { ensureTeamsSchema } from "../schema";
import PrintControls from "./print-controls";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Deterministic "Month D, YYYY" for the generated-on line and dates of birth
// (UTC, no locale) so the printed sheet reads the same everywhere.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function todayLabel(): string {
  const d = new Date();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "2010-05-14" -> "May 14, 2010". Empty/invalid -> em dash. */
function formatDob(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Proportional print widths for the roster columns (percent of the landscape
// sheet), keyed by roster field. Wide free-text fields (name, email, school)
// get a larger share so their values wrap in a line or two instead of being
// shredded, while short fields (grad year, height, weight, positions) stay
// narrow. Sums to 100.
const COL_WIDTHS: Record<string, string> = {
  player_name: "12%",
  grad_year: "5%",
  date_of_birth: "8%",
  height: "5%",
  weight: "5%",
  primary_position: "6%",
  secondary_position: "6%",
  high_school: "11%",
  parent_phone: "9%",
  parent_email: "13%",
  parent_name: "10%",
  closest_facility: "10%",
};

/** Format a single roster cell, matching the on-screen roster values but with
 *  friendlier dates. Empty values collapse to an em dash. */
function cellValue(field: (typeof PLAYER_FIELDS)[number], player: PlayerRow): string {
  const value = player[field.key as keyof PlayerRow];
  if (value == null || value === "") return "—";
  if (field.type === "date") return formatDob(String(value));
  return String(value);
}

export default async function TeamsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[]; team?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const teamParam = firstParam(params.team);
  const teamId = teamParam ? Number.parseInt(teamParam, 10) : null;

  let teams: TeamRow[] = [];
  let players: PlayerRow[] = [];
  let loadError = false;

  try {
    await ensureTeamsSchema();

    const [teamRows, playerRows] = await Promise.all([
      sql()`
        SELECT
          t.id,
          t.name,
          t.division,
          t.sport,
          (SELECT count(*) FROM players p WHERE p.team_id = t.id)::int AS player_count
        FROM teams t
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name
      `,
      sql()`
        SELECT
          p.id,
          p.team_id,
          t.name AS team_name,
          p.player_name,
          p.grad_year,
          p.date_of_birth::text AS date_of_birth,
          p.height,
          p.weight,
          p.primary_position,
          p.secondary_position,
          p.high_school,
          p.parent_phone,
          p.parent_email,
          p.parent_name,
          p.closest_facility
        FROM players p
        JOIN teams t ON t.id = p.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name, p.player_name
      `,
    ]);

    teams = teamRows as TeamRow[];
    players = playerRows as PlayerRow[];
  } catch (err) {
    console.error("Teams print load error:", err);
    loadError = true;
  }

  // Narrow to a single team when ?team= is supplied (per-team print).
  if (teamId != null && Number.isFinite(teamId)) {
    teams = teams.filter((t) => t.id === teamId);
  }

  const playersByTeam = new Map<number, PlayerRow[]>();
  for (const p of players) {
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }

  const backHref = `/teams?division=${division.slug}`;
  const scopeLabel =
    teams.length === 1 && teamId != null ? teams[0].name : division.label;

  return (
    <div className="print-view">
      {/* Rosters are wide (name plus eleven columns), so print them landscape
          for legible, un-cramped columns. Scoped to this route only. */}
      <style>{"@media print { @page { size: letter landscape; margin: 0.4in; } }"}</style>

      <PrintControls backHref={backHref} />

      <article className="print-doc print-doc-wide">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Team Roster</h1>
            <p className="print-doc-scope">{scopeLabel}</p>
          </div>
          <p className="print-doc-meta">
            Generated {todayLabel()}
            <br />
            {session.companyName}
          </p>
        </header>

        {loadError ? (
          <p className="print-note">
            Couldn&apos;t load the roster. Please return to the Teams tab and try
            again.
          </p>
        ) : teams.length === 0 ? (
          <p className="print-note">No teams to report in {division.label}.</p>
        ) : (
          teams.map((t) => {
            const teamPlayers = playersByTeam.get(t.id) ?? [];
            return (
              <section className="print-team" key={t.id}>
                <div className="print-team-head">
                  <h2 className="print-team-name">{t.name}</h2>
                  <span className="print-badge">{sportLabel(t.sport)}</span>
                  <span className="print-team-count">
                    {teamPlayers.length}{" "}
                    {teamPlayers.length === 1 ? "player" : "players"}
                  </span>
                </div>

                {teamPlayers.length === 0 ? (
                  <p className="print-note small">
                    No players on this team yet.
                  </p>
                ) : (
                  <table className="print-roster">
                    <colgroup>
                      {PLAYER_FIELDS.map((f) => (
                        <col key={f.key} style={{ width: COL_WIDTHS[f.key] }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {PLAYER_FIELDS.map((f) => (
                          <th key={f.key}>{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamPlayers.map((p) => (
                        <tr key={p.id}>
                          {PLAYER_FIELDS.map((f) => (
                            <td
                              key={f.key}
                              className={
                                f.key === "player_name" ? "col-name" : undefined
                              }
                            >
                              {cellValue(f, p)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })
        )}
      </article>
    </div>
  );
}
