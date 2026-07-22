// Flood City Elite brand mark — a text wordmark used as the logo on the login
// screen and the app header. Rendered as styled text (no image); the shared
// look lives in globals.css (.wordmark) and each placement sets only its own
// size via the passed className (.logo, .appbar-logo).
export default function FloodCityLogo({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"}>
      Flood City Elite
    </span>
  );
}
