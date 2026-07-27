"use client";

import { useEffect } from "react";

// When the Teams tab is reached with a "#team-<id>" hash — e.g. from the team
// link in the Roster Submissions tab — open that team's collapsible group and
// scroll it into view. Without this a collapsed <details> would hide the roster
// the link is pointing at.
export default function ExpandOnHash() {
  useEffect(() => {
    const openTarget = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#team-")) return;
      const el = document.getElementById(hash.slice(1));
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);

  return null;
}
