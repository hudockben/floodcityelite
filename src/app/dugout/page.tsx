import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "../logo";
import OrganizationPicker from "../organization-picker";
import { currentTenant, isTenantLocked, tenantIsAmbiguous } from "@/lib/tenant";
import { TENANT_QUERY_PARAM } from "@/lib/tenants";
import { DIVISIONS, divisionLabel, isDivisionSlug } from "@/app/(app)/teams/divisions";
import {
  dugoutCategory,
  ensureDugoutSchema,
  formatDugoutDate,
  getDugoutCompanyId,
  listPublishedDugoutPosts,
  type DugoutPostRow,
} from "@/lib/dugout";

export const dynamic = "force-dynamic";

// The tab title names the organization whose board this is, so a parent who
// arrived on a Fennell Bros. link is never shown a Flood City Elite title.
// Static metadata cannot do that — which organization this is depends on the
// request — so it is generated per request.
export async function generateMetadata(): Promise<Metadata> {
  // Nothing identified the organization, so there is no name to put here that
  // would not be a guess.
  if (await tenantIsAmbiguous()) return { title: "The Dugout" };

  const tenant = await currentTenant();
  return {
    title: `The Dugout — ${tenant.name}`,
    description: "Team news and announcements from the coaching staff.",
  };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The public message board. Reached from the "The Dugout" card on the sign-in
// screen — no account needed, so this route is intentionally left out of the
// auth middleware. It is read-only: everything on it was written by a
// signed-in staff member through the admin "Dugout" tab, and there is nothing
// here a visitor can post, edit, or remove.
export default async function DugoutPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[] }>;
}) {
  // The board belongs to one organization. If nothing about this request says
  // which, ask rather than defaulting — a parent reading another club's notices
  // would have no way to tell they were the wrong club's.
  const ambiguous = await tenantIsAmbiguous();

  // Keep the organization named on every link this page renders. A parent who
  // arrived on a `?c=` link must stay on that organization when they filter by
  // division; dropping the parameter would send the next request to whichever
  // organization a bare one resolves to. On a deployment or domain of its own
  // the address already says which club this is, so the parameter is left off.
  const locked = await isTenantLocked();
  const tenant = await currentTenant();
  const tenantParam = locked ? "" : `${TENANT_QUERY_PARAM}=${tenant.code}`;

  const params = await searchParams;
  const divisionParam = firstParam(params.division) ?? "";
  const division = isDivisionSlug(divisionParam) ? divisionParam : null;

  let posts: DugoutPostRow[] = [];
  let loadError = false;

  if (!ambiguous) {
    try {
      // Create the table on first use so the board works even if the database
      // predates this feature. Idempotent and memoized.
      await ensureDugoutSchema();

      const companyId = await getDugoutCompanyId();
      // No company row yet (the database has not been set up). An empty board
      // is the honest thing to show — there is nothing to read either way.
      posts = companyId == null
        ? []
        : await listPublishedDugoutPosts(companyId, division);
    } catch (err) {
      console.error("Dugout load error:", err);
      loadError = true;
    }
  }

  return (
    <main className="page dugout-page">
      <div className="card dugout-card">
        <div className="brand">
          {/* No lockup while we are still asking which organization this is —
              a logo over the question answers it for the visitor. */}
          {ambiguous ? null : (
            <h1 className="logo">
              <BrandLogo />
            </h1>
          )}
          <p className="tagline">The Dugout</p>
        </div>

        {ambiguous ? (
          <OrganizationPicker title="Whose dugout are you looking for?" />
        ) : (
          <>
            <div className="card-intro">
              <h2 className="card-intro-title">Team news &amp; announcements</h2>
              <p className="card-intro-sub">
                Posted by the coaching staff — game-day notes, weather calls,
                travel, and reminders. Read-only: no login needed, and nothing
                to fill out.
              </p>
            </div>

            <nav className="dugout-filters" aria-label="Filter by division">
              <Link
                href={`/dugout${tenantParam ? `?${tenantParam}` : ""}`}
                className={`dugout-filter${division == null ? " active" : ""}`}
                aria-current={division == null ? "page" : undefined}
              >
                Everything
              </Link>
              {DIVISIONS.map((d) => {
                const active = division === d.slug;
                return (
                  <Link
                    key={d.slug}
                    href={`/dugout?division=${d.slug}${tenantParam ? `&${tenantParam}` : ""}`}
                    className={`dugout-filter${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {d.label}
                  </Link>
                );
              })}
            </nav>

            {loadError ? (
              <div className="empty">
                <div className="empty-icon" aria-hidden="true">
                  ⚠️
                </div>
                <p className="empty-title">Couldn&apos;t load the board</p>
                <p className="empty-sub">
                  Give it a moment and refresh. If it keeps happening, let the
                  office know.
                </p>
              </div>
            ) : posts.length === 0 ? (
              <div className="empty">
                <div className="empty-icon" aria-hidden="true">
                  ⚾
                </div>
                <p className="empty-title">Nothing on the board yet</p>
                <p className="empty-sub">
                  {division
                    ? `No ${divisionLabel(division)} notices are posted right now. Check back before first pitch.`
                    : "The staff hasn't posted anything yet. Check back before first pitch."}
                </p>
              </div>
            ) : (
              <ol className="dugout-posts">
                {posts.map((post) => (
                  <DugoutPost key={post.id} post={post} />
                ))}
              </ol>
            )}
          </>
        )}

        <p className="card-foot">
          <Link href="/" className="card-foot-link">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

// One note on the board. The body is rendered as plain text (the stylesheet
// keeps the line breaks a coach typed) — never as markup, so nothing typed into
// the admin form can put HTML on a page parents read.
function DugoutPost({ post }: { post: DugoutPostRow }) {
  const category = dugoutCategory(post.category);

  return (
    <li className={`dugout-post${post.is_pinned ? " is-pinned" : ""}`}>
      <div className="dugout-post-tags">
        {post.is_pinned ? (
          <span className="dugout-tag dugout-tag-pinned">
            <span aria-hidden="true">📌</span> Pinned
          </span>
        ) : null}
        <span className="dugout-tag">
          <span aria-hidden="true">{category.mark}</span> {category.label}
        </span>
        <span className="dugout-tag dugout-tag-scope">
          {post.division ? divisionLabel(post.division) : "Whole program"}
        </span>
      </div>

      <h3 className="dugout-post-title">{post.title}</h3>

      <p className="dugout-post-meta">
        {formatDugoutDate(post.created_at)}
        {post.author_name ? ` · ${post.author_name}` : ""}
        {post.edited ? " · edited" : ""}
      </p>

      <p className="dugout-post-body">{post.body}</p>
    </li>
  );
}
