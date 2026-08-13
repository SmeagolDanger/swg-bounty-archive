import { describe, expect, it } from "vitest";
import { deriveRivalryMetrics } from "./metrics";

describe("derived metrics", () => {
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
