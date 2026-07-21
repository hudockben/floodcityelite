import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { logoutAction } from "../actions";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <main className="page">
      <div className="dash">
        <div className="dash-card">
          <div className="dash-header">
            <div>
              <h1>Welcome{session.fullName ? `, ${session.fullName}` : ""}.</h1>
              <p className="sub">{session.companyName} member portal</p>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="logout-btn">
                Sign out
              </button>
            </form>
          </div>

          <div className="meta">
            <div className="item">
              <div className="k">Company</div>
              <div className="v">{session.companyName}</div>
            </div>
            <div className="item">
              <div className="k">Company code</div>
              <div className="v">{session.companyCode}</div>
            </div>
            <div className="item">
              <div className="k">Username</div>
              <div className="v">{session.username}</div>
            </div>
            <div className="item">
              <div className="k">Role</div>
              <div className="v">{session.role}</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
