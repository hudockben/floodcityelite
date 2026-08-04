import type { Metadata } from "next";
import type { ReactNode } from "react";
import { currentTenant } from "@/lib/tenant";
import "./globals.css";

// The browser tab belongs to the organization the request resolved to, so a
// Fennell Bros. visitor never sees a Flood City Elite title or favicon.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const { icon, appleIcon } = tenant.brand;

  return {
    title: `${tenant.name} — Member Portal`,
    description: `Sign in to the ${tenant.name} member portal.`,
    // A tenant with no icons of its own gets no `icons` key at all, which leaves
    // Next.js to serve whatever the app directory already provides — that is how
    // Flood City Elite keeps exactly the favicon it has always had.
    ...(icon || appleIcon
      ? {
          icons: {
            ...(icon ? { icon } : {}),
            ...(appleIcon ? { apple: appleIcon } : {}),
          },
        }
      : {}),
  };
}

// Reading the tenant here makes the root layout dynamic. That is expected: every
// page in this portal is request-scoped already, either behind a session or
// behind the middleware that resolves the tenant for the public forms.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await currentTenant();

  return (
    // `data-tenant` is the single hook the stylesheet themes off — see the
    // per-tenant custom-property blocks in globals.css.
    <html lang="en" data-tenant={tenant.theme}>
      <body>{children}</body>
    </html>
  );
}
