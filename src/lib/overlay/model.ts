// View model for the OBS stream overlay (/overlay). Pure functions from the
// public hunter-dossier JSON to the rows and footer tiles the panel renders,
// so the mapping is unit-testable without a browser or database.

export interface OverlayEncounter {
  id?: string;
  event_at: string;
  outcome: string;
  hunter_name: string;
  target_name: string;
  credits: number | string | null;
  hunter_stats?: { cycle_encounters?: number; cycle_kills?: number; cycle_credits?: number } | null;
}

export interface OverlayDossier {
  participant: { id: string; current_name: string; guild_abbreviation?: string | null };
  encounters: OverlayEncounter[];
  hunterSummary?: { wins?: number; losses?: number; credits?: number; highest_bounty?: number | null } | null;
}

export type OverlayResult = "CLAIMED" | "FAILED" | "ESCAPED" | "SLAIN";

export interface OverlayRow {
  key: string;
  target: string;
  result: OverlayResult;
  payout: string | null;
  time: string;
}

export interface OverlayStats {
  todayClaimed: number;
  cycleContracts: number | null;
  bestPayout: string | null;
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const formatCredits = (value: number | string | null | undefined) => {
  const amount = Number(value ?? 0);
  return amount > 0 ? integer.format(amount) : null;
};

// "just now", "7m ago", "1h ago", "3d ago" — recomputed on every poll tick.
export function relativeAge(eventAt: string | Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(eventAt).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The panel reads from the streamer's perspective: claims and failures as the
// hunter, escapes and deaths as the target.
export function resultFor(row: OverlayEncounter, name: string): { result: OverlayResult; opponent: string } {
  const asHunter = row.hunter_name.toLowerCase() === name.toLowerCase();
  const kill = row.outcome === "KILL";
  if (asHunter) return { result: kill ? "CLAIMED" : "FAILED", opponent: row.target_name };
  return { result: kill ? "SLAIN" : "ESCAPED", opponent: row.hunter_name };
}

export function overlayRows(dossier: OverlayDossier, limit: number, now: Date): OverlayRow[] {
  const name = dossier.participant.current_name;
  return dossier.encounters.slice(0, Math.max(1, Math.min(10, limit))).map((row, index) => {
    const { result, opponent } = resultFor(row, name);
    return {
      key: row.id ?? `${row.event_at}-${index}`,
      target: opponent,
      result,
      payout: formatCredits(row.credits),
      time: relativeAge(row.event_at, now),
    };
  });
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function overlayStats(dossier: OverlayDossier, now: Date): OverlayStats {
  const name = dossier.participant.current_name.toLowerCase();
  const todayClaimed = dossier.encounters.filter((row) =>
    row.outcome === "KILL" && row.hunter_name.toLowerCase() === name && sameLocalDay(new Date(row.event_at), now)).length;
  const stats = dossier.encounters.find((row) => row.hunter_name.toLowerCase() === name && row.hunter_stats)?.hunter_stats ?? null;
  return {
    todayClaimed,
    cycleContracts: stats?.cycle_encounters ?? null,
    bestPayout: formatCredits(dossier.hunterSummary?.highest_bounty),
  };
}
