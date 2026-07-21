"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/homeplate", label: "Homeplate" },
  { href: "/teams", label: "Teams" },
  { href: "/payment-tracker", label: "Payment Tracker" },
  { href: "/budgets", label: "Budgets" },
  { href: "/schedules", label: "Schedules" },
  { href: "/fundraiser-tracker", label: "Fundraiser Tracker" },
  { href: "/program-camps", label: "Program/Camps" },
  { href: "/contact-info", label: "Contact Info" },
  { href: "/yard-tournaments", label: "Yard Tournaments" },
  { href: "/hotels", label: "Hotels" },
  { href: "/inventory", label: "Inventory" },
];

export default function AppTabs() {
  const pathname = usePathname();

  return (
    <nav className="tabs" aria-label="Sections">
      <div className="tabs-inner">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
