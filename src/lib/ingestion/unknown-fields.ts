const allowed: Record<string, Set<string>> = {
  catalog: new Set(["boards", "fetchedAt"]),
  board: new Set(["id", "trackerOid", "name", "category", "valueType", "periodStartTime", "periodEndTime"]),
  leaderboard: new Set(["id", "period", "subject", "valueType", "totalScore", "periodStartTime", "periodEndTime", "entries", "fetchedAt"]),
  entry: new Set(["rank", "participantId", "name", "score", "scoreRaw", "guildAbbreviation", "faction", "planet", "cityName"]),
  wins: new Set(["id", "cityWins", "guildWins", "fetchedAt"]),
  win: new Set(["rank", "participantId", "name", "wins", "guildAbbreviation", "faction", "planet"]),
  bounty: new Set(["windowDays", "summary", "hunters", "targets", "survivors", "recent", "fetchedAt"]),
  summary: new Set(["kills", "failures", "encounters", "successRate", "creditsPaid", "averageBounty", "distinctHunters", "distinctTargets", "largestBounty"]),
  encounter: new Set(["timestamp", "outcome", "hunterName", "targetName", "credits"]),
  hunter: new Set(["rank", "name", "kills", "failures", "encounters", "successRate", "creditsEarned"]),
  target: new Set(["rank", "name", "timesKilled", "timesSurvived", "encounters", "survivalRate"]),
};

function objectUnknown(value: unknown, group: keyof typeof allowed, path: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => !allowed[group].has(key)).map((key) => `${path}.${key}`);
}

function arrayUnknown(value: unknown, group: keyof typeof allowed, path: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => objectUnknown(item, group, `${path}[]`));
}

export function findUnknownFields(processor: "catalog" | "leaderboard" | "wins" | "bounty", payload: unknown): string[] {
  const root = payload as Record<string, unknown>;
  if (!root || typeof root !== "object" || Array.isArray(root)) return ["$:non-object"];
  let fields: string[];
  if (processor === "catalog") fields = [...objectUnknown(root, "catalog", "$"), ...arrayUnknown(root.boards, "board", "$.boards")];
  else if (processor === "leaderboard") fields = [...objectUnknown(root, "leaderboard", "$"), ...arrayUnknown(root.entries, "entry", "$.entries")];
  else if (processor === "wins") fields = [...objectUnknown(root, "wins", "$"), ...arrayUnknown(root.cityWins, "win", "$.cityWins"), ...arrayUnknown(root.guildWins, "win", "$.guildWins")];
  else {
    const summary = root.summary as Record<string, unknown> | undefined;
    fields = [
      ...objectUnknown(root, "bounty", "$"), ...objectUnknown(summary, "summary", "$.summary"),
      ...objectUnknown(summary?.largestBounty, "encounter", "$.summary.largestBounty"),
      ...arrayUnknown(root.hunters, "hunter", "$.hunters"), ...arrayUnknown(root.targets, "target", "$.targets"),
      ...arrayUnknown(root.survivors, "target", "$.survivors"), ...arrayUnknown(root.recent, "encounter", "$.recent"),
    ];
  }
  return [...new Set(fields)].sort();
}
