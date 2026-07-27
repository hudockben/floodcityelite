import type { Metadata } from "next";
import Link from "next/link";
import FloodCityLogo from "../logo";
import PayrollForm from "./payroll-form";

export const metadata: Metadata = {
  title: "Payroll — Flood City Elite",
  description: "Employees: submit the hours you worked.",
};

// Public employee payroll form. Reached from the "Payroll" card on the login
// screen — no account needed, so this route is intentionally left out of the
// auth middleware. Submissions land in the admin "Payroll" tab.
export default function PayrollPage() {
  return (
    <main className="page">
      <div className="card">
        <div className="brand">
          <h1 className="logo">
            <FloodCityLogo />
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
