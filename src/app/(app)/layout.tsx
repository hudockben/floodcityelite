import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { logoutAction } from "../actions";
import AppTabs from "./app-tabs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="shell">
      <header className="appbar">
        <Link href="/homeplate" className="appbar-brand">
          <DropMark />
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

function DropMark() {
  return (
    <svg
      className="appbar-logo"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="appdrop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path
        d="M32 4C32 4 12 26 12 40a20 20 0 0 0 40 0C52 26 32 4 32 4Z"
        fill="url(#appdrop)"
      />
      <path
        d="M32 13C32 13 20 27 20 38"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
