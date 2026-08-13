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
