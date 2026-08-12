import { describe, expect, it } from "vitest";
import { deriveActivityMetrics, deriveRivalryMetrics, rankDelta, scoreDelta } from "./metrics";

describe("derived metrics", () => {
  it("uses only provided encounter facts", () => {
    const metrics = deriveActivityMetrics([
      { outcome: "KILL", credits: 200, opponent: "A" },
      { outcome: "FAILED", credits: 0, opponent: "a" },
      { outcome: "KILL", credits: 400, opponent: "B" },
    ]);
    expect(metrics).toEqual({ encounters: 3, kills: 2, failures: 1, credits: 600, successRate: 2 / 3, averageBounty: 300, uniqueOpponents: 2 });
  });

  it("keeps unavailable comparisons null", () => {
    expect(rankDelta(2, 5)).toBe(3);
    expect(rankDelta(2, null)).toBeNull();
    expect(scoreDelta(12, 9)).toBe(3);
  });

  it("scores both rivalry roles and recognizes a revenge kill", () => {
    const metrics = deriveRivalryMetrics([
      { outcome: "KILL", hunterName: "Nemesis", targetName: "Hunter", credits: 500 },
      { outcome: "KILL", hunterName: "Hunter", targetName: "Nemesis", credits: 700 },
      { outcome: "FAILED", hunterName: "Nemesis", targetName: "Hunter", credits: 0 },
      { outcome: "FAILED", hunterName: "Hunter", targetName: "Nemesis", credits: 0 },
    ], "Hunter");
    expect(metrics).toEqual({ encounters: 4, playerWins: 2, opponentWins: 2, playerClaims: 1, playerSurvivals: 1,
      playerCredits: 700, revengeKills: 1, winRate: 0.5 });
  });
});
