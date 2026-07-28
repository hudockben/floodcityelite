import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { deleteTeamAction } from "./actions";
import { ensureTeamsSchema } from "./schema";
import AddPlayerForm from "./add-player-form";
import BulkUploadForm from "./bulk-upload-form";
import ConfirmButton from "./confirm-button";
import CreateTeamForm from "./create-team-form";
import ExpandOnHash from "./expand-on-hash";
import NewSeasonForm from "./new-season-form";
import PlayerRowItem from "./player-row";
import SeasonBar from "./season-bar";
import { resolveSeason, seasonLabel, type Season } from "./seasons";
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
  searchParams: Promise<{ division?: string | string[]; year?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const yearRaw = firstParam(params.year);
  const yearParam = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let teams: TeamRow[] = [];
  let players: PlayerRow[] = [];
  let companyHasTeams = false;
  let seasons: Season[] = [];
  let season: Season | null = null;
  let loadError = false;

  try {
    // Create the teams/players tables on first use so the tab works even if
    // the database predates this feature. Idempotent and memoized.
    await ensureTeamsSchema();

    // Pick the season to show (the ?year=, else the active/latest one) and load
    // the divisions's seasons for the year picker. Teams — and therefore their
    // rosters — are scoped to this one season.
    const resolved = await resolveSeason(
      session.companyId,
      division.slug,
      yearParam,
    );
    season = resolved.current;
    seasons = resolved.seasons;
    const seasonId = resolved.current.id;

    const [teamRows, playerRows, companyTeamRows] = await Promise.all([
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
          p.jersey_number,
          p.hat_size,
          p.high_school,
          p.parent_phone,
          p.parent_email,
          p.parent_name,
          p.closest_facility,
          p.is_paying
        FROM players p
        JOIN teams t ON t.id = p.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.season_id = ${seasonId}
        ORDER BY t.name, p.player_name
      `,
      sql()`
        SELECT EXISTS(
          SELECT 1 FROM teams WHERE company_id = ${session.companyId}
        ) AS has
      `,
    ]);

    teams = teamRows as TeamRow[];
    players = playerRows as PlayerRow[];
    companyHasTeams = Boolean((companyTeamRows[0] as { has?: boolean })?.has);
  } catch (err) {
    console.error("Teams page load error:", err);
    loadError = true;
  }

  // Prefill the "Start new season" year with the year after the latest season.
  const nextYear =
    (seasons.length
      ? Math.max(...seasons.map((s) => s.year))
      : new Date().getFullYear()) + 1;

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
      <ExpandOnHash />
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

        {/* Season (year) selector for this division, plus "start new season". */}
        {season ? (
          <SeasonBar
            basePath="/teams"
            division={division.slug}
            seasons={seasons}
            current={season}
          >
            <NewSeasonForm
              division={division.slug}
              sourceSeasonId={season.id}
              nextYear={nextYear}
            />
          </SeasonBar>
        ) : null}
      </section>

      {loadError || !season ? (
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
          <p>New teams are added to the {seasonLabel(season)} season.</p>
        </div>

        <CreateTeamForm
          division={division.slug}
          defaultSport={division.defaultSport}
          seasonId={season.id}
        />

        {teams.length > 0 ? (
          <details className="team-manage">
            <summary className="team-manage-summary">
              <span className="tg-caret" aria-hidden="true" />
              <span className="team-manage-title">
                Manage teams in this division
              </span>
              <span className="team-manage-count">
                {teams.length} {teams.length === 1 ? "team" : "teams"}
              </span>
            </summary>
            <p className="team-manage-hint">
              Rosters are shown in the {division.label} roster below. Use Delete
              here to remove a team and all of its players.
            </p>
            <ul className="team-chips">
              {teams.map((t) => (
                <li key={t.id} className="team-chip">
                  <span className="team-chip-name">{t.name}</span>
                  <span className={`sport-badge sport-${t.sport}`}>
                    {sportLabel(t.sport)}
                  </span>
                  <span className="team-chip-count">
                    {t.player_count}{" "}
                    {t.player_count === 1 ? "player" : "players"}
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
          </details>
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

        <BulkUploadForm
          division={division.slug}
          seasonYear={season.year}
          teams={teamOptions}
          companyHasTeams={companyHasTeams}
        />
      </section>

      {/* Step 3 — the roster */}
      <section className="panel">
        <div className="panel-head panel-head-row">
          <div>
            <h2 className="step-title">
              <span className="step-num">3</span> {season.year} {division.label}{" "}
              roster
            </h2>
            <p>
              {players.length} {players.length === 1 ? "player" : "players"}{" "}
              across {teams.length} {teams.length === 1 ? "team" : "teams"}.
            </p>
          </div>
          {teams.length > 0 ? (
            <a
              className="btn-secondary print-all-btn"
              href={`/teams/print?division=${division.slug}&year=${season.year}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              🖨 Print all / Save PDF
            </a>
          ) : null}
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
                <details key={t.id} id={`team-${t.id}`} className="team-group">
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

                  {teamPlayers.length > 0 ? (
                    <div className="tg-print-row">
                      <a
                        className="team-print-link"
                        href={`/teams/print?division=${division.slug}&team=${t.id}&year=${season.year}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        🖨 Print / Save PDF
                      </a>
                    </div>
                  ) : null}

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
                              <Fragment key={f.key}>
                                <th>{f.label}</th>
                                {f.key === "player_name" ? (
                                  <th className="col-paying">Paying</th>
                                ) : null}
                              </Fragment>
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
