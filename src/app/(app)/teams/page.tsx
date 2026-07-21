import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { deleteTeamAction } from "./actions";
import { ensureTeamsSchema } from "./schema";
import AddPlayerForm from "./add-player-form";
import ConfirmButton from "./confirm-button";
import CreateTeamForm from "./create-team-form";
import PlayerRowItem from "./player-row";
import {
  DIVISIONS,
  PLAYER_FIELDS,
  resolveDivision,
  sportLabel,
  type PlayerRow,
  type TeamRow,
} from "./divisions";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));

  let teams: TeamRow[] = [];
  let players: PlayerRow[] = [];
  let loadError = false;

  try {
    // Create the teams/players tables on first use so the tab works even if
    // the database predates this feature. Idempotent and memoized.
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
    console.error("Teams page load error:", err);
    loadError = true;
  }

  const teamOptions = teams.map((t) => ({
    id: t.id,
    name: t.name,
    sport: t.sport,
  }));

  // Group the roster by team so each team can be shown as a collapsible row.
  const playersByTeam = new Map<number, PlayerRow[]>();
  for (const p of players) {
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Teams</h1>
          <p>
            Organize rosters top-down: pick a division, create a team and assign
            its sport, then fill out the roster.
          </p>
        </div>

        {/* Division selector */}
        <nav className="subtabs" aria-label="Division">
          {DIVISIONS.map((d) => {
            const active = d.slug === division.slug;
            return (
              <Link
                key={d.slug}
                href={`/teams?division=${d.slug}`}
                className={`subtab${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {d.label}
              </Link>
            );
          })}
        </nav>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load teams</p>
            <p className="empty-sub">
              The roster tables may still be getting set up. Refresh in a moment
              — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* Step 1 — create a team in this division */}
          <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">1</span> Create a team
          </h2>
          <p>New teams are added to the {division.label} division.</p>
        </div>

        <CreateTeamForm
          division={division.slug}
          defaultSport={division.defaultSport}
        />

        {teams.length > 0 ? (
          <ul className="team-chips">
            {teams.map((t) => (
              <li key={t.id} className="team-chip">
                <span className="team-chip-name">{t.name}</span>
                <span className={`sport-badge sport-${t.sport}`}>
                  {sportLabel(t.sport)}
                </span>
                <span className="team-chip-count">
                  {t.player_count} {t.player_count === 1 ? "player" : "players"}
                </span>
                <ConfirmButton
                  action={deleteTeamAction}
                  hidden={{ teamId: t.id, division: division.slug }}
                  confirmText={`Delete "${t.name}" and its entire roster? This cannot be undone.`}
                  className="chip-delete"
                >
                  Delete
                </ConfirmButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-note">No teams in this division yet.</p>
        )}
      </section>

      {/* Step 2 — add players to a team */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">2</span> Add a player
          </h2>
          <p>Fill in what you have — only the player&apos;s name is required.</p>
        </div>

        <AddPlayerForm division={division.slug} teams={teamOptions} />
      </section>

      {/* Step 3 — the roster */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">3</span> {division.label} roster
          </h2>
          <p>
            {players.length} {players.length === 1 ? "player" : "players"} across{" "}
            {teams.length} {teams.length === 1 ? "team" : "teams"}.
          </p>
        </div>

        {teams.length === 0 ? (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚾
            </div>
            <p className="empty-title">No teams yet</p>
            <p className="empty-sub">
              Create a team and add players to build out this roster.
            </p>
          </div>
        ) : (
          <div className="team-groups">
            {teams.map((t) => {
              const teamPlayers = playersByTeam.get(t.id) ?? [];
              return (
                <details key={t.id} className="team-group">
                  <summary className="team-group-summary">
                    <span className="tg-caret" aria-hidden="true" />
                    <span className="tg-name">{t.name}</span>
                    <span className={`sport-badge sport-${t.sport}`}>
                      {sportLabel(t.sport)}
                    </span>
                    <span className="tg-count">
                      {teamPlayers.length}{" "}
                      {teamPlayers.length === 1 ? "player" : "players"}
                    </span>
                  </summary>

                  {teamPlayers.length === 0 ? (
                    <p className="tg-empty">
                      No players on this team yet — add one in step 2.
                    </p>
                  ) : (
                    <div className="roster-scroll">
                      <table className="roster">
                        <thead>
                          <tr>
                            {PLAYER_FIELDS.map((f) => (
                              <th key={f.key}>{f.label}</th>
                            ))}
                            <th className="col-actions">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamPlayers.map((row) => (
                            <PlayerRowItem
                              key={row.id}
                              player={row}
                              division={division.slug}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
