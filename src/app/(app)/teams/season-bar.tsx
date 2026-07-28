import Link from "next/link";
import { type DivisionSlug } from "./divisions";
import { type Season } from "./seasons";

// The year picker shown under the division tabs on the Teams, Schedules, and
// Budgets tabs. Each pill switches the ?year= for the current division; the
// active pill is the season being viewed. `basePath` is the tab's route (e.g.
// "/teams") and `children` is an optional slot for the "New season" control,
// which only the Teams tab renders.
export default function SeasonBar({
  basePath,
  division,
  seasons,
  current,
  children,
}: {
  basePath: string;
  division: DivisionSlug;
  seasons: Season[];
  current: Season;
  children?: React.ReactNode;
}) {
  return (
    <div className="season-bar">
      <span className="season-bar-label">Season</span>
      <nav className="season-pills" aria-label="Season">
        {seasons.map((s) => {
          const active = s.id === current.id;
          return (
            <Link
              key={s.id}
              href={`${basePath}?division=${division}&year=${s.year}`}
              className={`season-pill${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {s.year}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
