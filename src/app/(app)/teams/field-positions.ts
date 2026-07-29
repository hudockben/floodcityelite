// ---------------------------------------------------------------------------
// Teams tab — field view (depth chart) mapping
//
// Positions are free text on the roster: the same team can hold "3rd base",
// "3rd", "Short", and "SS". This module normalizes what coaches actually type
// onto the nine fielding spots the diagram draws.
//
// Guiding rule: never silently misplace a player. Anything that isn't a
// confident match is kept and listed beside the field (as typed) instead of
// being guessed onto a spot — a wrong placement would quietly corrupt the
// heavy/thin read the view exists to give. That's also why bare numbers ("6")
// aren't mapped: scorer's notation (6 = SS) and an abbreviated ordinal
// (6th?/"3" for third) can't be told apart from the text alone.
//
// Plain module (no "use server" / "use client") so the server page and the
// client field view can share it.
// ---------------------------------------------------------------------------

/** The nine spots drawn on the diamond. */
export type FieldSpotKey =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export type FieldSpot = {
  key: FieldSpotKey;
  /** Spelled-out name, used for tooltips and screen readers. */
  name: string;
  /** Center of the spot's card, in % of the diagram box (see FIELD_ASPECT). */
  x: number;
  y: number;
};

// The drawing's box. The top 30 units are empty sky above the outfield fence;
// cropping them is what keeps the printed sheet on one page.
const FIELD_W = 400;
const FIELD_H = 350;

/** SVG viewBox for the diagram. */
export const FIELD_VIEWBOX = `0 30 ${FIELD_W} ${FIELD_H}`;

/**
 * Aspect ratio (width / height) of that same box, applied to the element the
 * cards are positioned inside. Cards are placed as percentages of the box, so
 * they land on the drawing at any size — as long as the box keeps this ratio,
 * which is why both come from here rather than being restated in CSS.
 */
export const FIELD_ASPECT = FIELD_W / FIELD_H;

// Ordered so the rendered cards follow the tab order a coach reads in: outfield
// across the top, then middle infield, corners, pitcher, catcher.
//
// Spacing, not surveying. A card is a fixed share of the field's width but
// grows as tall as its roster, so the layout has to hold at any card height:
//   • the corners sit 15% out from the middle infield — wider than a card — so
//     a stacked SS can never reach 3B however deep it gets;
//   • the middle infield plays deep and the pitcher sits just off the mound,
//     which is the vertical room those two cards need.
export const FIELD_SPOTS: FieldSpot[] = [
  { key: "LF", name: "Left field", x: 21.5, y: 31.6 },
  { key: "CF", name: "Center field", x: 50, y: 18.6 },
  { key: "RF", name: "Right field", x: 78.5, y: 31.6 },
  { key: "SS", name: "Shortstop", x: 38.5, y: 42.5 },
  { key: "2B", name: "Second base", x: 61.5, y: 42.5 },
  { key: "3B", name: "Third base", x: 23.5, y: 63.4 },
  { key: "1B", name: "First base", x: 76.5, y: 63.4 },
  { key: "P", name: "Pitcher", x: 50, y: 64.2 },
  { key: "C", name: "Catcher", x: 50, y: 90.9 },
];

// Real positions that don't belong to one spot on the diagram. Listed beside
// the field so a utility player or a generic "OF" still shows up somewhere.
const FLEX_LABELS: Record<string, string> = {
  DH: "DH",
  UTIL: "Utility",
  OF: "Outfield (any)",
  IF: "Infield (any)",
  MIF: "Middle infield",
  CIF: "Corner infield",
};

// Spellings coaches actually type, normalized to letters+digits only (see
// `normalize`), mapped to a diagram spot or a flex group above.
const ALIASES: Record<string, string> = {
  // Pitcher
  p: "P",
  pitcher: "P",
  pitchers: "P",
  pitching: "P",
  rhp: "P",
  lhp: "P",
  sp: "P",
  rp: "P",
  startingpitcher: "P",
  reliefpitcher: "P",
  closer: "P",
  // Catcher
  c: "C",
  catcher: "C",
  catchers: "C",
  catching: "C",
  // First base
  "1b": "1B",
  b1: "1B",
  first: "1B",
  firstbase: "1B",
  firstbaseman: "1B",
  "1st": "1B",
  "1stbase": "1B",
  "1stbaseman": "1B",
  // Second base
  "2b": "2B",
  b2: "2B",
  second: "2B",
  secondbase: "2B",
  secondbaseman: "2B",
  "2nd": "2B",
  "2ndbase": "2B",
  "2ndbaseman": "2B",
  // Third base
  "3b": "3B",
  b3: "3B",
  third: "3B",
  thirdbase: "3B",
  thirdbaseman: "3B",
  "3rd": "3B",
  "3rdbase": "3B",
  "3rdbaseman": "3B",
  hotcorner: "3B",
  // Shortstop
  ss: "SS",
  short: "SS",
  shortstop: "SS",
  shortstops: "SS",
  // Outfield
  lf: "LF",
  left: "LF",
  leftfield: "LF",
  leftfielder: "LF",
  leftoutfield: "LF",
  cf: "CF",
  center: "CF",
  centre: "CF",
  centerfield: "CF",
  centrefield: "CF",
  centerfielder: "CF",
  centrefielder: "CF",
  centeroutfield: "CF",
  rf: "RF",
  right: "RF",
  rightfield: "RF",
  rightfielder: "RF",
  rightoutfield: "RF",
  // Flex — real answers, just not one spot on the diagram
  dh: "DH",
  designatedhitter: "DH",
  eh: "DH",
  extrahitter: "DH",
  util: "UTIL",
  utility: "UTIL",
  utilityplayer: "UTIL",
  flex: "UTIL",
  anywhere: "UTIL",
  of: "OF",
  outfield: "OF",
  outfielder: "OF",
  outfields: "OF",
  if: "IF",
  infield: "IF",
  infielder: "IF",
  mi: "MIF",
  mif: "MIF",
  middleinfield: "MIF",
  middleinfielder: "MIF",
  ci: "CIF",
  cif: "CIF",
  cornerinfield: "CIF",
  cornerinfielder: "CIF",
};

const SPOT_KEYS = new Set<string>(FIELD_SPOTS.map((s) => s.key));

/** Strip everything but letters and digits so "1st Base" and "1B" both match. */
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type PositionMatch =
  /** Placed on the diamond. */
  | { kind: "spot"; spot: FieldSpotKey }
  /** A real position with no single spot (DH, utility, generic outfield). */
  | { kind: "flex"; group: string; label: string }
  /** Not recognized — shown beside the field exactly as it was typed. */
  | { kind: "unknown"; group: string; label: string };

/** Resolve one free-text position. Null when the field is blank. */
export function resolvePosition(
  raw: string | null | undefined,
): PositionMatch | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const hit = ALIASES[normalize(text)];
  if (hit && SPOT_KEYS.has(hit)) return { kind: "spot", spot: hit as FieldSpotKey };
  if (hit) return { kind: "flex", group: hit, label: FLEX_LABELS[hit] ?? hit };

  // Unrecognized: group by the normalized text so "Rover" and "rover" land
  // together, but show the coach what was actually typed.
  return { kind: "unknown", group: `?${normalize(text)}`, label: text };
}

/** The roster columns the field view needs — deliberately not the whole row. */
export type FieldPlayer = {
  id: number;
  player_name: string;
  jersey_number: string | null;
  primary_position: string | null;
  secondary_position: string | null;
};

export type PlayerRole = "primary" | "secondary";

export type SpotEntry = { player: FieldPlayer; role: PlayerRole };

export type OffFieldGroup = {
  group: string;
  label: string;
  entries: SpotEntry[];
};

export type FieldChart = {
  /** Every diagram spot, in FIELD_SPOTS order, primaries listed first. */
  spots: { spot: FieldSpot; entries: SpotEntry[] }[];
  /** Positions that don't map to a spot (flex groups first, then unknowns). */
  offField: OffFieldGroup[];
  /** Players with no position filled in at all. */
  unlisted: FieldPlayer[];
};

/**
 * Depth of one spot:
 *   none   — nobody listed there at all
 *   backup — only players who list it as their secondary
 *   ok     — at least one primary, three or fewer players total
 *   deep   — four or more players listed there
 */
export type DepthLevel = "none" | "backup" | "ok" | "deep";

export function depthLevel(entries: SpotEntry[]): DepthLevel {
  if (entries.length === 0) return "none";
  if (!entries.some((e) => e.role === "primary")) return "backup";
  return entries.length >= 4 ? "deep" : "ok";
}

/**
 * Build the whole chart for a team. Each player is placed once per distinct
 * position they list — a player whose primary and secondary resolve to the same
 * spot is counted there once (as a primary), not twice.
 */
export function buildFieldChart(players: FieldPlayer[]): FieldChart {
  const bySpot = new Map<FieldSpotKey, SpotEntry[]>();
  const offField = new Map<string, OffFieldGroup>();
  const unlisted: FieldPlayer[] = [];

  const place = (player: FieldPlayer, match: PositionMatch, role: PlayerRole) => {
    if (match.kind === "spot") {
      const list = bySpot.get(match.spot);
      if (list) list.push({ player, role });
      else bySpot.set(match.spot, [{ player, role }]);
      return;
    }
    const existing = offField.get(match.group);
    if (existing) existing.entries.push({ player, role });
    else
      offField.set(match.group, {
        group: match.group,
        label: match.label,
        entries: [{ player, role }],
      });
  };

  for (const player of players) {
    const primary = resolvePosition(player.primary_position);
    const secondary = resolvePosition(player.secondary_position);

    if (!primary && !secondary) {
      unlisted.push(player);
      continue;
    }

    if (primary) place(player, primary, "primary");
    // Skip a secondary that repeats the primary — one player, one slot.
    if (secondary && !sameTarget(primary, secondary)) {
      place(player, secondary, "secondary");
    }
  }

  const spots = FIELD_SPOTS.map((spot) => ({
    spot,
    // Primaries first, then backups; each group keeps the roster's name order.
    entries: (bySpot.get(spot.key) ?? []).sort(
      (a, b) => roleRank(a.role) - roleRank(b.role),
    ),
  }));

  // Flex groups (DH, utility, generic OF/IF) ahead of anything unrecognized.
  const offFieldList = [...offField.values()].sort((a, b) => {
    const aUnknown = a.group.startsWith("?");
    const bUnknown = b.group.startsWith("?");
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
  for (const group of offFieldList) {
    group.entries.sort((a, b) => roleRank(a.role) - roleRank(b.role));
  }

  return { spots, offField: offFieldList, unlisted };
}

/**
 * Shorten a name to fit a position card: "Kolton Hammond" -> "K. Hammond",
 * "Abdiel Ortiz-Rivera Jr" -> "A. Ortiz-Rivera Jr". A one-word name is left
 * alone. The card's tooltip still carries the full name.
 */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName.trim();
  const [first, ...rest] = parts;
  return `${first[0].toUpperCase()}. ${rest.join(" ")}`;
}

function roleRank(role: PlayerRole): number {
  return role === "primary" ? 0 : 1;
}

function sameTarget(a: PositionMatch | null, b: PositionMatch): boolean {
  if (!a) return false;
  if (a.kind === "spot" && b.kind === "spot") return a.spot === b.spot;
  if (a.kind === "spot" || b.kind === "spot") return false;
  return a.group === b.group;
}
