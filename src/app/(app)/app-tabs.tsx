"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SectionPage = { href: string; label: string };
type Tab = { href: string; label: string; pages?: SectionPage[] };

// The top-level sections.
//
// A tab with `pages` is a group: one label stands in for several pages, and
// those pages get a second row underneath instead of a top-level tab each. The
// row only fits so many words before the last one falls off the edge (see .tab
// in globals.css), so the back-office pages nobody visits daily — payroll,
// fixed cost, the Dugout editor — sit together under Admin rather than each
// spending a slot in the row.
const TABS: Tab[] = [
  { href: "/homeplate", label: "Homeplate" },
  { href: "/teams", label: "Teams" },
  { href: "/roster-submissions", label: "Roster Submissions" },
  { href: "/payment-tracker", label: "Payment Tracker" },
  { href: "/budgets", label: "Budgets" },
  { href: "/schedules", label: "Schedules" },
  { href: "/fundraiser-tracker", label: "Fundraiser Tracker" },
  { href: "/program-camps", label: "Program/Camps" },
  { href: "/contact-info", label: "Contact Info" },
  { href: "/hotels", label: "Hotels" },
  { href: "/inventory", label: "Inventory" },
  {
    // Last in the row: the back office is where you go on purpose, not
    // somewhere you pass through on the way to the day's work.
    // The group's own href is just where the label points — its first page.
    href: "/payroll-admin",
    label: "Admin",
    pages: [
      { href: "/payroll-admin", label: "Payroll" },
      { href: "/fixed-cost", label: "Fixed Cost" },
      { href: "/dugout-admin", label: "Dugout" },
    ],
  },
];

// A route is "on" a page when it is that page or sits underneath it, so
// /payroll-admin/reports still lights Payroll.
function isOn(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// A group is lit whenever any of its pages is.
function isTabActive(pathname: string, tab: Tab): boolean {
  if (tab.pages) return tab.pages.some((p) => isOn(pathname, p.href));
  return isOn(pathname, tab.href);
}

export default function AppTabs() {
  const pathname = usePathname();

  // The group being viewed, if any. Only one row of pages is ever open, and
  // only while you're inside that group.
  const openGroup = TABS.find((t) => t.pages && isTabActive(pathname, t));
  const groupPages = openGroup?.pages ?? [];

  return (
    <>
      <nav className="tabs" aria-label="Sections">
        <div className="tabs-inner">
          {TABS.map((t) => {
            const active = isTabActive(pathname, t);
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

      {openGroup && groupPages.length > 0 ? (
        <nav className="section-tabs" aria-label={`${openGroup.label} pages`}>
          <div className="section-tabs-inner">
            {groupPages.map((p) => {
              const active = isOn(pathname, p.href);
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  className={`section-tab${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </>
  );
}
