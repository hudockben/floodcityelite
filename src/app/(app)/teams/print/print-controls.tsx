"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

// Screen-only toolbar for the roster print view. It offers a manual "Print /
// Save as PDF" button and a link back to the Teams tab, and — since the user
// reached this page by asking to print — it opens the browser's print dialog
// once automatically on load. The toolbar is hidden in the actual print output.
export default function PrintControls({ backHref }: { backHref: string }) {
  const printedRef = useRef(false);

  useEffect(() => {
    // Guard against React's double-invoke in development so the dialog only
    // opens once. A short delay lets the document paint before printing.
    if (printedRef.current) return;
    printedRef.current = true;
    const timer = setTimeout(() => window.print(), 350);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="print-toolbar">
      <button type="button" className="btn" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
      <Link href={backHref} className="btn-secondary print-back">
        Back to Teams
      </Link>
    </div>
  );
}
