import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./login-form";

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="page">
      <div className="card">
        <div className="brand">
          <WaterDropLogo />
          <h1>FLOOD CITY ELITE</h1>
          <p className="tagline">Member Portal</p>
        </div>

        <LoginForm />

        <p className="hint">
          Sign in with company code <code>fce</code>, plus your username and
          password.
        </p>
      </div>
    </main>
  );
}

function WaterDropLogo() {
  return (
    <svg
      className="logo"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path
        d="M32 4C32 4 12 26 12 40a20 20 0 0 0 40 0C52 26 32 4 32 4Z"
        fill="url(#drop)"
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
