// Flood City Elite brand mark — the "Flood City Elite · Baseball + Softball"
// wordmark, served from /public so the login screen and the app header can
// share one asset. It's a landscape wordmark (not a square badge); sizing lives
// in globals.css (.brand .logo and .appbar-logo), so callers just pass the
// matching className.
export default function FloodCityLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src="/logo.webp"
      alt="Flood City Elite — Baseball + Softball"
      width={1200}
      height={725}
    />
  );
}
