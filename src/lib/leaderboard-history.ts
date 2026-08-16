export type LeaderboardHistoryRow = Record<string, unknown>;

function instant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function isNewer(candidate: LeaderboardHistoryRow, current: LeaderboardHistoryRow): boolean {
  const candidatePeriod = instant(candidate.starts_at);
  const currentPeriod = instant(current.starts_at);
  if (candidatePeriod !== currentPeriod) return candidatePeriod > currentPeriod;
  return instant(candidate.source_fetched_at) > instant(current.source_fetched_at);
}

/**
 * Select the newest weekly period observed for every board. Historical
 * periods can be fetched after CURRENT in the same ingestion run, so fetch
 * time alone cannot identify the latest standings.
 */
export function latestLeaderboardRows<T extends LeaderboardHistoryRow>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const board = String(row.leaderboard_id ?? "");
    if (!board) continue;
    const current = latest.get(board);
    if (!current || isNewer(row, current)) latest.set(board, row);
  }
  return latest;
}

/**
 * Keep observations made while their own weekly period was live. Ended
 * periods keep being refetched (PREVIOUS_1/2) long after they close, which
 * would plot last week's standings on this week's dates; observations that
 * were CURRENT when fetched chart the real multi-week trend.
 */
export function contemporaneousLeaderboardRows<T extends LeaderboardHistoryRow>(rows: T[]): T[] {
  return rows.filter((row) => {
    const fetched = instant(row.source_fetched_at);
    return fetched >= instant(row.starts_at) && (row.ends_at == null || fetched < instant(row.ends_at));
  });
}
