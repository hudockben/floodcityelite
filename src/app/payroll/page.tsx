import type { Metadata } from "next";
import Link from "next/link";
import { getPayrollCompanyId } from "@/lib/payroll";
import { listDivisionsSafe } from "@/app/(app)/teams/division-store";
import { BUILTIN_DIVISIONS, type Division } from "@/app/(app)/teams/divisions";
import FloodCityLogo from "../logo";
import PayrollForm from "./payroll-form";

export const metadata: Metadata = {
  title: "Payroll — Flood City Elite",
  description: "Employees: submit the hours you worked.",
};

// Public employee payroll form. Reached from the "Payroll" card on the login
// screen — no account needed, so this route is intentionally left out of the
// auth middleware. Submissions land in the admin "Payroll" tab.
//
// Dynamic because the Division dropdown offers the program's own divisions,
// which are rows now rather than a constant. This page has no session to read a
// company from, so it uses the same single-company lookup the submit action
// does — and falls back to the built-in divisions rather than failing to render
// a form an employee is trying to fill in.
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  let divisions: Division[] = BUILTIN_DIVISIONS;
  try {
    const companyId = await getPayrollCompanyId();
    if (companyId != null) divisions = await listDivisionsSafe(companyId);
  } catch (err) {
    console.error("Payroll divisions load error:", err);
  }

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

        <PayrollForm divisions={divisions} />

        <p className="card-foot">
          <Link href="/" className="card-foot-link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
