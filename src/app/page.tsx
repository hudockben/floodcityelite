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
          {/* The wordmark logo already reads "Flood City Elite"; keep an h1 for
              accessibility/SEO but hide it visually to avoid a doubled title. */}
          <h1 className="sr-only">Flood City Elite</h1>
          <p className="tagline">Member Portal</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
