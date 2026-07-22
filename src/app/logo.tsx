// Flood City Elite brand mark — the "Flood City Baseball" emblem, served from
// /public so the login screen and the app header can share one asset. Sizing
// and the rounded-badge treatment live in globals.css (.brand .logo and
// .appbar-logo), so callers just pass the matching className.
export default function FloodCityLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src="/logo.webp"
      alt="Flood City Elite"
      width={819}
      height={819}
    />
  );
}
