import { describe, expect, it } from "vitest";
import { contemporaneousLeaderboardRows, latestLeaderboardRows } from "./leaderboard-history";

describe("leaderboard history selection", () => {
  const history = [
    {
      // Last week's period refetched via PREVIOUS_1 after it ended: stale.
      leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS",
      starts_at: "2026-08-08T22:00:05.000Z",
      ends_at: "2026-08-15T22:00:00.000Z",
      source_fetched_at: "2026-08-16T12:02:19.063Z",
      rank: 5,
      score_raw: "11",
    },
    {
      // Same past period observed while it was live: real history.
      leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS",
      starts_at: "2026-08-08T22:00:05.000Z",
      ends_at: "2026-08-15T22:00:00.000Z",
      source_fetched_at: "2026-08-13T09:15:00.000Z",
      rank: 5,
      score_raw: "11",
    },
    {
      leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS",
      starts_at: "2026-08-15T22:00:05.000Z",
      ends_at: "2026-08-22T22:00:00.000Z",
      source_fetched_at: "2026-08-16T11:49:24.763Z",
      rank: 2,
      score_raw: "8",
    },
    {
      leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS",
      starts_at: "2026-08-15T22:00:05.000Z",
      ends_at: "2026-08-22T22:00:00.000Z",
      source_fetched_at: "2026-08-16T11:39:24.763Z",
      rank: 3,
      score_raw: "7",
    },
    {
      leaderboard_id: "BOUNTY_HUNTER_GROUND_VALUE",
      starts_at: new Date("2026-08-15T22:00:05.000Z"),
      ends_at: new Date("2026-08-22T22:00:00.000Z"),
      source_fetched_at: new Date("2026-08-16T11:44:21.939Z"),
      rank: 5,
      score_raw: "449100",
    },
  ];

  it("prefers the newest period over an older period fetched later", () => {
    const latest = latestLeaderboardRows(history);
    expect(latest.get("BOUNTY_HUNTER_TOTAL_KILLS")).toMatchObject({ rank: 2, score_raw: "8" });
    expect(latest.get("BOUNTY_HUNTER_GROUND_VALUE")).toMatchObject({ rank: 5, score_raw: "449100" });
  });

  it("keeps observations fetched during their own period, drops post-period refetches", () => {
    const rows = contemporaneousLeaderboardRows(history);
    expect(rows).toHaveLength(4);
    // The stale PREVIOUS_1 refetch is gone…
    expect(rows.some((row) => String(row.source_fetched_at) === "2026-08-16T12:02:19.063Z")).toBe(false);
    // …but the genuine observation of that past week survives for the chart.
    expect(rows.some((row) => String(row.source_fetched_at) === "2026-08-13T09:15:00.000Z")).toBe(true);
  });
});
