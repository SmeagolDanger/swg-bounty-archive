export const BOUNTY_BOARD_IDS = [
  "BOUNTY_HUNTER_GROUND_VALUE",
  "BOUNTY_HUNTER_SPACE_VALUE",
  "BOUNTY_HUNTER_UNIQUE_KILLS",
  "BOUNTY_HUNTER_TOTAL_KILLS",
] as const;

export const PERIODS = ["CURRENT", "PREVIOUS_1", "PREVIOUS_2"] as const;
export const SUBJECTS = ["player", "guild", "city"] as const;
export const PARSER_VERSION = "1.2.0";

export function swgBaseUrl(): string {
  return (process.env.SWG_BASE_URL ?? "https://swglegends.com").replace(/\/$/, "");
}
