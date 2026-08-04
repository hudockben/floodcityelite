import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { currentTenant } from "@/lib/tenant";
import { TENANT_QUERY_PARAM } from "@/lib/tenants";
import LoginForm from "./login-form";
import BrandLogo from "./logo";

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/homeplate");

  const tenant = await currentTenant();
  // Payroll and roster acceptance are login-free, so a visitor arriving there has
  // no session to say which organization they belong to. Naming the tenant in the
  // link keeps them on the same one whose sign-in screen they started from.
  const tenantQuery = `?${TENANT_QUERY_PARAM}=${tenant.code}`;

  return (
    <main className="page">
      <div className="login-layout">
        <div className="brand">
          <h1 className="logo">
            <BrandLogo />
          </h1>
          <p className="tagline">{tenant.brand.tagline}</p>
        </div>

        <div className="divisions">
          {/* Admin division — the existing staff/coach login. */}
          <section className="card division-card" aria-labelledby="div-admin">
            <div className="division-head">
              <span className="division-icon" aria-hidden="true">
                🔑
              </span>
              <div>
                <h2 id="div-admin" className="division-title">
                  Admin
                </h2>
                <p className="division-sub">Staff &amp; coaches — sign in</p>
              </div>
            </div>

            <LoginForm />
          </section>

          {/* Payroll division — a public form employees fill out. */}
          <section className="card division-card" aria-labelledby="div-payroll">
            <div className="division-head">
              <span className="division-icon" aria-hidden="true">
                🕒
              </span>
              <div>
                <h2 id="div-payroll" className="division-title">
                  Payroll
                </h2>
                <p className="division-sub">Employees — submit your hours</p>
              </div>
            </div>

            <div className="division-body">
              <p className="division-text">
                No account needed. Log the hours you worked and the office picks
                it up automatically.
              </p>
              <ul className="division-list">
                <li>Your name and role</li>
                <li>The date you worked</li>
                <li>Hours worked</li>
              </ul>
              <Link href={`/payroll${tenantQuery}`} className="btn btn-block">
                Open payroll form
              </Link>
            </div>
          </section>

          {/* Roster Spot division — a public accept/decline form for parents. */}
          <section className="card division-card" aria-labelledby="div-roster">
            <div className="division-head">
              <span className="division-icon" aria-hidden="true">
                ✅
              </span>
              <div>
                <h2 id="div-roster" className="division-title">
                  Roster Spot
                </h2>
                <p className="division-sub">Parents — accept your spot</p>
              </div>
            </div>

            <div className="division-body">
              <p className="division-text">
                Made a team? Let us know if the player is accepting or declining
                the roster spot. Accepting adds them straight to the roster.
              </p>
              <ul className="division-list">
                <li>Accept or decline</li>
                <li>Player &amp; parent details</li>
                <li>Team, positions, jersey &amp; more</li>
              </ul>
              <Link
                href={`/roster-acceptance${tenantQuery}`}
                className="btn btn-block"
              >
                Open acceptance form
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
