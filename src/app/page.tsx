import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./login-form";
import FloodCityLogo from "./logo";

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/homeplate");

  return (
    <main className="page">
      <div className="card">
        <div className="brand">
          <FloodCityLogo className="logo" />
          <h1>FLOOD CITY ELITE</h1>
          <p className="tagline">Member Portal</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
