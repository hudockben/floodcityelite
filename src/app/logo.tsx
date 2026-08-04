import { currentTenant } from "@/lib/tenant";
import type { Tenant } from "@/lib/tenants";

// The brand lockup shown on the sign-in screen, the public forms, and the app
// header. Which brand it draws depends on the organization the request belongs
// to (see `currentTenant`): Flood City Elite is a text wordmark, Fennell Bros.
// pairs their script mark with theirs.
//
// The look lives in globals.css — `.brand-lockup` arranges the pieces,
// `.brand-mark` sizes the image, `.wordmark` styles the text — and each
// placement passes only its own size class (`.logo`, `.appbar-logo`).

export function BrandLockup({
  tenant,
  className,
}: {
  tenant: Tenant;
  className?: string;
}) {
  const { mark, wordmark } = tenant.brand;

  return (
    <span className={className ? `brand-lockup ${className}` : "brand-lockup"}>
      {mark ? (
        // Decorative: the wordmark beside it already names the brand, so the
        // image is hidden from screen readers rather than read out twice.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="brand-mark"
          src={mark.src}
          alt=""
          width={mark.width}
          height={mark.height}
          aria-hidden="true"
        />
      ) : null}
      <span className="wordmark">{wordmark}</span>
    </span>
  );
}

export default async function BrandLogo({ className }: { className?: string }) {
  const tenant = await currentTenant();
  return <BrandLockup tenant={tenant} className={className} />;
}
