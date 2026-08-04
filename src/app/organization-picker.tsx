import Link from "next/link";
import { TENANT_QUERY_PARAM, configuredTenants } from "@/lib/tenants";

// Shown on the login-free forms in place of the form itself, when the request
// carried nothing to say which organization it belongs to and this deployment
// serves more than one (see `tenantIsAmbiguous`). Rather than guess and file a
// submission under the wrong organization, ask — one link per organization,
// each carrying `?c=<code>` so everything after this point knows.
//
// In a correctly configured deployment this never renders: each organization
// has its own address, or its links carry the parameter already. It is what a
// missed hostname looks like instead of a misfiled roster form.
export default function OrganizationPicker({ title }: { title: string }) {
  const organizations = configuredTenants();

  // Laid out with the existing card and form classes rather than new ones —
  // it is the same stack of a heading, a line of explanation, and full-width
  // buttons that the rest of these cards already use.
  return (
    <>
      <div className="card-intro">
        <h2 className="card-intro-title">{title}</h2>
        <p className="card-intro-sub">
          Choose your organization to continue. If you reached this page from a
          link, go back and use the one your club sent you.
        </p>
      </div>

      <div className="form">
        {organizations.map((tenant) => (
          <Link
            key={tenant.code}
            href={`?${TENANT_QUERY_PARAM}=${tenant.code}`}
            className="btn btn-block"
          >
            {tenant.name}
          </Link>
        ))}
      </div>
    </>
  );
}
