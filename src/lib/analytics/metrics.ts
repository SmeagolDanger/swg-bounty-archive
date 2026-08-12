export interface ActivityMetrics {
  encounters: number;
  kills: number;
  failures: number;
  credits: number;
  successRate: number | null;
  averageBounty: number | null;
  uniqueOpponents: number;
}

export interface EncounterMetricInput {
  outcome: "KILL" | "FAILED";
  credits: number;
  opponent: string;
}

export function deriveActivityMetrics(rows: EncounterMetricInput[]): ActivityMetrics {
  const kills = rows.filter((row) => row.outcome === "KILL");
  const credits = kills.reduce((sum, row) => sum + row.credits, 0);
  return {
    encounters: rows.length,
    kills: kills.length,
    failures: rows.length - kills.length,
    credits,
    successRate: rows.length ? kills.length / rows.length : null,
    averageBounty: kills.length ? credits / kills.length : null,
    uniqueOpponents: new Set(rows.map((row) => row.opponent.toLocaleLowerCase())).size,
  };
}

export interface RivalryMetricInput {
  outcome: "KILL" | "FAILED";
  hunterName: string;
  targetName: string;
  credits: number;
}

export function deriveRivalryMetrics(rows: RivalryMetricInput[], playerName: string) {
  const playerKey = playerName.toLocaleLowerCase();
  let playerWins = 0;
  let opponentWins = 0;
  let playerClaims = 0;
  let playerSurvivals = 0;
  let playerCredits = 0;
  let revengeKills = 0;
  let previousKiller: string | null = null;
  for (const row of rows) {
    const hunterKey = row.hunterName.toLocaleLowerCase();
    const targetKey = row.targetName.toLocaleLowerCase();
    const winnerKey = row.outcome === "KILL" ? hunterKey : targetKey;
    if (winnerKey === playerKey) playerWins += 1;
    else opponentWins += 1;
    if (row.outcome === "KILL") {
      if (hunterKey === playerKey) {
        playerClaims += 1;
        playerCredits += row.credits;
        if (previousKiller === targetKey) revengeKills += 1;
      }
      previousKiller = hunterKey;
    } else if (targetKey === playerKey) playerSurvivals += 1;
  }
  return { encounters: rows.length, playerWins, opponentWins, playerClaims, playerSurvivals, playerCredits, revengeKills,
    winRate: rows.length ? playerWins / rows.length : null };
}

export function rankDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return previous - current;
}

export function scoreDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}
