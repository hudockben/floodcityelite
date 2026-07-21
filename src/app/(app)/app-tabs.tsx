"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/homeplate", label: "Homeplate" },
  { href: "/payment-tracker", label: "Payment Tracker" },
  { href: "/budgets", label: "Budgets" },
  { href: "/schedules", label: "Schedules" },
  { href: "/contact-info", label: "Contact Info" },
  { href: "/yard-tournaments", label: "Yard Tournaments" },
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
