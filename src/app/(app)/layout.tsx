import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { logoutAction } from "../actions";
import FloodCityLogo from "../logo";
import AppTabs from "./app-tabs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="shell">
      <header className="appbar">
        <Link href="/homeplate" className="appbar-brand">
          <FloodCityLogo className="appbar-logo" />
          <span>FLOOD CITY ELITE</span>
        </Link>

        <div className="appbar-user">
          <div className="who">
            <span className="who-name">{session.fullName || session.username}</span>
            <span className="who-role">
              {session.companyName} · {session.role}
            </span>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="logout-btn">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <AppTabs />

      <main className="content">{children}</main>
    </div>
  );
}
