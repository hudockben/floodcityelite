import Link from "next/link";

// The season-year picker for the Fixed Cost tab. Same pills as the Teams and
// Budgets season bars, minus the division: a year's fixed costs are the
// program's, so one sheet per year feeds every division's budgets for that year.
export default function YearBar({
  years,
  current,
}: {
  years: number[];
  current: number;
}) {
  return (
    <div className="season-bar">
      <span className="season-bar-label">Season</span>
      <nav className="season-pills" aria-label="Season">
        {years.map((year) => {
          const active = year === current;
          return (
            <Link
              key={year}
              href={`/fixed-cost?year=${year}`}
              className={`season-pill${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {year}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
