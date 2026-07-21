import Link from "next/link";
import { getSession } from "@/lib/session";

const SECTIONS = [
  { href: "/payment-tracker", label: "Payment Tracker", icon: "💳", desc: "Dues, invoices, and payments" },
  { href: "/budgets", label: "Budgets", icon: "📊", desc: "Plan and monitor team budgets" },
  { href: "/schedules", label: "Schedules", icon: "🗓️", desc: "Practices, games, and events" },
  { href: "/contact-info", label: "Contact Info", icon: "📇", desc: "Players, families, and staff" },
  { href: "/yard-tournaments", label: "Yard Tournaments", icon: "🏆", desc: "Brackets and results" },
  { href: "/inventory", label: "Inventory", icon: "📦", desc: "Equipment and gear" },
];

export default async function HomeplatePage() {
  const session = await getSession();
  const name = session?.fullName || session?.username || "";

  return (
    <div className="home">
      <section className="panel">
        <div className="panel-head">
          <h1>Welcome{name ? `, ${name}` : ""}.</h1>
          <p>{session?.companyName} home base.</p>
        </div>
        <div className="meta">
          <div className="item">
            <div className="k">Company</div>
            <div className="v">{session?.companyName}</div>
          </div>
          <div className="item">
            <div className="k">Company code</div>
            <div className="v">{session?.companyCode}</div>
          </div>
          <div className="item">
            <div className="k">Username</div>
            <div className="v">{session?.username}</div>
          </div>
          <div className="item">
            <div className="k">Role</div>
            <div className="v">{session?.role}</div>
          </div>
        </div>
      </section>

      <section className="home-grid">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="home-card">
            <div className="home-card-icon" aria-hidden="true">
              {s.icon}
            </div>
            <div className="home-card-label">{s.label}</div>
            <div className="home-card-desc">{s.desc}</div>
          </Link>
        ))}
      </section>
    </div>
  );
}
