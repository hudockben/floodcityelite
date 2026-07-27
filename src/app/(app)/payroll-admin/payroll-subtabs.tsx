"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The two views of the admin Payroll tab: the raw submissions list and the
// filterable reports view.
const SUBTABS = [
  { href: "/payroll-admin", label: "Submissions" },
  { href: "/payroll-admin/reports", label: "Reports" },
];

export default function PayrollSubtabs() {
  const pathname = usePathname();

  return (
    <nav className="subtabs" aria-label="Payroll views">
      {SUBTABS.map((t) => {
        // Exact match so "Submissions" (the base path) isn't also highlighted
        // while on the reports sub-route.
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`subtab${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
