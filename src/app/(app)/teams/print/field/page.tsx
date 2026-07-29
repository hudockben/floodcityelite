import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  FieldDepthSummary,
  FieldDiagram,
  FieldExtras,
  FieldLegend,
} from "../../field-diagram";
import { buildFieldChart, type FieldPlayer } from "../../field-positions";
import { resolveDivision, sportLabel, type TeamRow } from "../../divisions";
import { ensureTeamsSchema } from "../../schema";
import { resolveSeason, type Season } from "../../seasons";
import PrintControls from "../print-controls";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Deterministic "Month D, YYYY" (UTC, no locale) for the generated-on line, so
// the printed sheet reads the same everywhere. Mirrors ../page.tsx.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function todayLabel(): string {
  const d = new Date();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

type FieldPlayerRow = FieldPlayer & { team_id: number };

// The printable depth chart — the same diagram the "View Field" modal shows,
// laid out for paper. Reached from that modal's "Print / Save PDF" link, which
// always passes ?team=; without it, every team in the division's season prints,
// one field per page.
export default async function FieldPrintPage({
  searchParams,
}: {
  searchParams: Promise<{
    division?: string | string[];
    team?: string | string[];
    year?: string | string[];
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const teamParam = firstParam(params.team);
  const teamId = teamParam ? Number.parseInt(teamParam, 10) : null;
  const yearRaw = firstParam(params.year);
  const yearParam = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let teams: TeamRow[] = [];
  let players: FieldPlayerRow[] = [];
  let season: Season | null = null;
  let loadError = false;

  try {
    await ensureTeamsSchema();

    const resolved = await resolveSeason(
      session.companyId,
      division.slug,
      yearParam,
    );
    season = resolved.current;
    const seasonId = resolved.current.id;

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
          AND t.season_id = ${seasonId}
        ORDER BY t.name
      `,
      // Only the columns the chart maps — the print sheet has no use for the
      // parents' contact details.
      sql()`
        SELECT
          p.id,
          p.team_id,
          p.player_name,
          p.jersey_number,
          p.primary_position,
          p.secondary_position
        FROM players p
        JOIN teams t ON t.id = p.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.season_id = ${seasonId}
        ORDER BY t.name, p.player_name
      `,
    ]);

    teams = teamRows as TeamRow[];
    players = playerRows as FieldPlayerRow[];
  } catch (err) {
    console.error("Field print load error:", err);
    loadError = true;
  }

  // Narrow to a single team when ?team= is supplied (the modal always does).
  if (teamId != null && Number.isFinite(teamId)) {
    teams = teams.filter((t) => t.id === teamId);
  }

  const playersByTeam = new Map<number, FieldPlayerRow[]>();
  for (const p of players) {
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }

  const backHref = season
    ? `/teams?division=${division.slug}&year=${season.year}`
    : `/teams?division=${division.slug}`;
  const divisionScope = season
    ? `${season.year} ${division.label}`
    : division.label;

  return (
    <div className="print-view">
      {/* The diamond is nearly square, so it prints portrait — unlike the
          roster sheet, which is wide. Scoped to this route only. */}
      <style>{"@media print { @page { size: letter portrait; margin: 0.4in; } }"}</style>

      <PrintControls backHref={backHref} />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Field / Depth Chart</h1>
            <p className="print-doc-scope">
              {teams.length === 1 && teamId != null
                ? teams[0].name
                : divisionScope}
            </p>
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
            const chart = buildFieldChart(teamPlayers);
            return (
              <section className="print-team print-field" key={t.id}>
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
                  <>
                    <FieldDepthSummary chart={chart} />
                    <FieldDiagram chart={chart} />
                    <FieldLegend />
                    <FieldExtras chart={chart} />
                  </>
                )}
              </section>
            );
          })
        )}
      </article>
    </div>
  );
}
