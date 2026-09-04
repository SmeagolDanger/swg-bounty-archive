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
  hunter_stats?: { cycle_starts_at?: string | null; cycle_ends_at?: string | null; cycle_encounters?: number; cycle_kills?: number; cycle_credits?: number } | null;
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

export type OverlayPeriod = "recent" | "today" | "cycle";
export type OverlayTileIcon = "aim" | "list" | "star" | "trophy";
export interface OverlayTile { icon: OverlayTileIcon; label: string; value: string; tone?: "good" | "gold" }

export interface OverlayViewModel {
  rows: OverlayRow[];
  omitted: number;
  tiles: OverlayTile[];
  emptyNote: string;
}

export interface OverlayStats {
  todayClaimed: number;
  cycleContracts: number | null;
  cycleBest: string | null;
  recordBest: string | null;
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

  // Best claim inside the current cycle, from the recent encounter window the
  // dossier carries (its most recent 100 rows — plenty for one weekly cycle).
  const cycleStart = stats?.cycle_starts_at ? new Date(stats.cycle_starts_at).getTime() : null;
  const cycleEnd = stats?.cycle_ends_at ? new Date(stats.cycle_ends_at).getTime() : null;
  const cycleBest = cycleStart === null ? 0 : Math.max(0, ...dossier.encounters
    .filter((row) => row.outcome === "KILL" && row.hunter_name.toLowerCase() === name)
    .filter((row) => {
      const at = new Date(row.event_at).getTime();
      return at >= cycleStart && (cycleEnd === null || at < cycleEnd);
    })
    .map((row) => Number(row.credits ?? 0)));

  return {
    todayClaimed,
    cycleContracts: stats?.cycle_encounters ?? null,
    cycleBest: formatCredits(cycleBest),
    recordBest: formatCredits(dossier.hunterSummary?.highest_bounty),
  };
}

const cycleWindow = (dossier: OverlayDossier) => {
  const name = dossier.participant.current_name.toLowerCase();
  const stats = dossier.encounters.find((row) => row.hunter_name.toLowerCase() === name && row.hunter_stats)?.hunter_stats ?? null;
  if (!stats?.cycle_starts_at) return null;
  return {
    start: new Date(stats.cycle_starts_at).getTime(),
    end: stats.cycle_ends_at ? new Date(stats.cycle_ends_at).getTime() : null,
    stats,
  };
};

const inWindow = (row: OverlayEncounter, start: number, end: number | null) => {
  const at = new Date(row.event_at).getTime();
  return at >= start && (end === null || at < end);
};

// One panel view: the encounter rows for the chosen window plus the footer
// tiles that describe that window. "recent" is the rolling default; "today"
// and "cycle" show the full window (up to the row limit, with a remainder).
export function overlayView(dossier: OverlayDossier, period: OverlayPeriod, limit: number, now: Date): OverlayViewModel {
  const name = dossier.participant.current_name;
  const key = name.toLowerCase();
  const gold = (value: string | null) => value ? `${value} cr` : "—";

  let windowRows: OverlayEncounter[];
  let tiles: OverlayTile[];
  let emptyNote: string;

  if (period === "today") {
    windowRows = dossier.encounters.filter((row) => sameLocalDay(new Date(row.event_at), now));
    const mine = windowRows.filter((row) => row.hunter_name.toLowerCase() === key);
    const claims = mine.filter((row) => row.outcome === "KILL");
    const paid = claims.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
    const best = Math.max(0, ...claims.map((row) => Number(row.credits ?? 0)));
    tiles = [
      { icon: "aim", label: "Claimed", value: String(claims.length), tone: "good" },
      { icon: "list", label: "Failed", value: String(mine.length - claims.length) },
      { icon: "star", label: "Credits", value: gold(formatCredits(paid)), tone: "gold" },
      { icon: "trophy", label: "Best", value: gold(formatCredits(best)), tone: "gold" },
    ];
    emptyNote = "No contracts today — the ledger is watching.";
  } else if (period === "cycle") {
    const cycle = cycleWindow(dossier);
    windowRows = cycle ? dossier.encounters.filter((row) => inWindow(row, cycle.start, cycle.end)) : [];
    const claims = windowRows.filter((row) => row.outcome === "KILL" && row.hunter_name.toLowerCase() === key);
    const best = Math.max(0, ...claims.map((row) => Number(row.credits ?? 0)));
    tiles = [
      { icon: "list", label: "Contracts", value: String(cycle?.stats.cycle_encounters ?? 0) },
      { icon: "aim", label: "Claimed", value: String(cycle?.stats.cycle_kills ?? 0), tone: "good" },
      { icon: "star", label: "Credits", value: gold(formatCredits(cycle?.stats.cycle_credits)), tone: "gold" },
      { icon: "trophy", label: "Cycle best", value: gold(formatCredits(best)), tone: "gold" },
    ];
    emptyNote = "No contracts this cycle yet.";
  } else {
    windowRows = dossier.encounters;
    const stats = overlayStats(dossier, now);
    tiles = [
      { icon: "aim", label: "Today", value: `${stats.todayClaimed} claimed`, tone: "good" },
      { icon: "list", label: "Contracts", value: String(stats.cycleContracts ?? "—") },
      { icon: "star", label: "Cycle best", value: gold(stats.cycleBest), tone: "gold" },
      { icon: "trophy", label: "Record", value: gold(stats.recordBest), tone: "gold" },
    ];
    emptyNote = "No archived contracts for this hunter yet.";
  }

  const capped = Math.max(1, Math.min(20, limit));
  const shown = windowRows.slice(0, capped);
  return {
    rows: overlayRows({ ...dossier, encounters: shown }, capped, now),
    // "recent" is a rolling view, not a bounded window; a remainder count
    // only means something for today/cycle.
    omitted: period === "recent" ? 0 : windowRows.length - shown.length,
    tiles,
    emptyNote,
  };
}
