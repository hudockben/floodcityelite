// Flood City Elite mark — a baseball/softball crossed with a bat.
export default function BallBatLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Flood City Elite"
    >
      <defs>
        <linearGradient id="fceBat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2d6ac" />
          <stop offset="0.5" stopColor="#d0a069" />
          <stop offset="1" stopColor="#9c6a3c" />
        </linearGradient>
        <linearGradient id="fceBall" x1="0.2" y1="0.05" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c3d2e4" />
        </linearGradient>
      </defs>

      {/* Bat, angled behind the ball */}
      <g transform="rotate(-40 32 32)">
        <path
          d="M13 30.7 L54 28 A4 4 0 0 1 54 36 L13 33.3 A1.3 1.3 0 0 1 13 30.7 Z"
          fill="url(#fceBat)"
          stroke="#7a5230"
          strokeWidth="0.7"
        />
        <circle cx="11.4" cy="32" r="2.7" fill="url(#fceBat)" stroke="#7a5230" strokeWidth="0.7" />
      </g>

      {/* Ball with two stitched seams */}
      <circle cx="32" cy="33" r="12" fill="url(#fceBall)" stroke="#9fb2c9" strokeWidth="0.8" />
      <path
        d="M25 24 Q31 33 25 42"
        fill="none"
        stroke="#e23b3b"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2.4 2"
      />
      <path
        d="M39 24 Q33 33 39 42"
        fill="none"
        stroke="#e23b3b"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2.4 2"
      />
    </svg>
  );
}
