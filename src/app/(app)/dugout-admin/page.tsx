import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isTenantLocked } from "@/lib/tenant";
import { TENANT_QUERY_PARAM } from "@/lib/tenants";
import {
  ensureDugoutSchema,
  formatDugoutDate,
  listDugoutPosts,
  type DugoutPostRow,
} from "@/lib/dugout";
import ComposeForm from "./compose-form";
import PostCard from "./post-card";

export const dynamic = "force-dynamic";

// The staff side of The Dugout. Parents read the board at /dugout with no
// account; this is the only way anything gets onto it, and it sits behind the
// same session guard as the rest of the member area (see middleware.ts).
export default async function DugoutAdminPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let posts: DugoutPostRow[] = [];
  let loadError = false;

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureDugoutSchema();
    posts = await listDugoutPosts(session.companyId);
  } catch (err) {
    console.error("Dugout load error:", err);
    loadError = true;
  }

  // The link to hand parents. On a shared deployment it names the organization,
  // the same way the public form links on the sign-in screen do; behind a domain
  // of its own the address already says which club this is.
  const boardHref = (await isTenantLocked())
    ? "/dugout"
    : `/dugout?${TENANT_QUERY_PARAM}=${session.companyCode}`;

  const published = posts.filter((p) => p.is_published).length;
  const drafts = posts.length - published;

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>The Dugout</h1>
        <p>
          The message board parents read from the sign-in screen. Anything
          posted here is public to anyone with the link, and only signed-in
          staff can put it there — parents have no way to reply or post. Pin the
          note everyone needs to see first, keep a half-written one as a draft
          until it&apos;s ready, and delete it once it&apos;s stale.{" "}
          <a
            className="card-foot-link"
            href={boardHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the board as a parent sees it ↗
          </a>
        </p>
      </div>

      <div className="dugout-admin">
        <div className="dugout-admin-compose">
          <h2 className="step-title">Post a note</h2>
          <ComposeForm />
        </div>

        <div className="dugout-admin-board">
          <h2 className="step-title">
            On the board
            {posts.length > 0 ? (
              <span className="dugout-count">
                {published} posted{drafts > 0 ? ` · ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}
              </span>
            ) : null}
          </h2>

          {loadError ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true">
                ⚠️
              </div>
              <p className="empty-title">Couldn&apos;t load the board</p>
              <p className="empty-sub">
                The board table may still be getting set up. Refresh in a moment
                — if this keeps happening, run <code>npm run db:setup</code>{" "}
                against the database.
              </p>
            </div>
          ) : posts.length === 0 ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true">
                ⚾
              </div>
              <p className="empty-title">The board is empty</p>
              <p className="empty-sub">
                Post the first note and it shows up on the parents&apos; board
                right away.
              </p>
            </div>
          ) : (
            <ol className="dugout-posts">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={{
                    id: post.id,
                    title: post.title,
                    body: post.body,
                    category: post.category,
                    division: post.division,
                    is_pinned: post.is_pinned,
                    is_published: post.is_published,
                    author_name: post.author_name,
                    posted_on: formatDugoutDate(post.created_at),
                    edited: post.edited,
                  }}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
