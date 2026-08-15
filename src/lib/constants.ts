export const BOARD_LABELS: Record<string, string> = {
  BOUNTY_HUNTER_GROUND_VALUE: "Ground Value",
  BOUNTY_HUNTER_SPACE_VALUE: "Space Value",
  BOUNTY_HUNTER_UNIQUE_KILLS: "Unique Kills",
  BOUNTY_HUNTER_TOTAL_KILLS: "Total Kills",
};

export const GCW_BOARD_LABELS: Record<string, string> = {
  GCW_IMPERIAL: "Imperial GCW",
  GCW_REBEL: "Rebel GCW",
};

export const GCW_BOARD_FACTIONS: Record<string, string> = {
  GCW_IMPERIAL: "Imperial",
  GCW_REBEL: "Rebel",
};

export const ALL_BOARD_LABELS: Record<string, string> = {
  ...BOARD_LABELS,
  ...GCW_BOARD_LABELS,
};
