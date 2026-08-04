import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "../logo";
import PayrollForm from "./payroll-form";
import { currentTenant } from "@/lib/tenant";

// The tab title names the organization the hours are being filed with, so an
// employee who arrived on a Fennell Bros. link is never shown a Flood City
// Elite title. Static metadata can't do that — which organization this is
// depends on the request — so it's generated per request.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  return {
    title: `Payroll — ${tenant.name}`,
    description: "Employees: submit the hours you worked.",
  };
}

// Public employee payroll form. Reached from the "Payroll" card on the login
// screen — no account needed, so this route is intentionally left out of the
// auth middleware. Submissions land in the admin "Payroll" tab of whichever
// organization the request resolved to; the brand lockup above the form is what
// tells the employee which one that is.
export default function PayrollPage() {
  return (
    <main className="page">
      <div className="card">
        <div className="brand">
          <h1 className="logo">
            <BrandLogo />
          </h1>
          <p className="tagline">Payroll</p>
        </div>

        <div className="card-intro">
          <h2 className="card-intro-title">Submit your hours</h2>
          <p className="card-intro-sub">
            Employees only. Log the hours you worked and the office will pick it
            up — no login required.
          </p>
        </div>

        <PayrollForm />

        <p className="card-foot">
          <Link href="/" className="card-foot-link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
