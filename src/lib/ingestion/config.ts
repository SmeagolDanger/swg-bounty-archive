export const BOUNTY_BOARD_IDS = [
  "BOUNTY_HUNTER_GROUND_VALUE",
  "BOUNTY_HUNTER_SPACE_VALUE",
  "BOUNTY_HUNTER_UNIQUE_KILLS",
  "BOUNTY_HUNTER_TOTAL_KILLS",
] as const;

// Galactic Civil War standings share the same leaderboard machinery: both
// boards expose player/guild/city subjects, PERCENT value type, and weekly
// periods. scoreRaw is a percent string (e.g. "7.85…%"), archived verbatim.
export const GCW_BOARD_IDS = ["GCW_IMPERIAL", "GCW_REBEL"] as const;

export const TRACKED_BOARD_IDS = [...BOUNTY_BOARD_IDS, ...GCW_BOARD_IDS] as const;

export const TRACKED_BOARD_CATEGORIES = ["Bounty Hunter", "GCW"] as const;

// Officers' Salute registry factions (GET /api/game/gcw-officers?faction=…).
export const GCW_FACTIONS = ["IMPERIAL", "REBEL"] as const;

export const PERIODS = ["CURRENT", "PREVIOUS_1", "PREVIOUS_2"] as const;
export const SUBJECTS = ["player", "guild", "city"] as const;
export const PARSER_VERSION = "1.4.0";

export function swgBaseUrl(): string {
  return (process.env.SWG_BASE_URL ?? "https://swglegends.com").replace(/\/$/, "");
}
