import { BOARD_LABELS } from "@/lib/constants";
import type { EncounterHunterStats } from "@/lib/data";
import type { Embed } from "./interactions";

// Pure embed builders for the slash commands. Everything here is formatting:
// no database access, so the output is unit-testable against fixtures.

export const COLORS = { feed: 0xd4a017, dossier: 0x3b82f6, warning: 0xb45309 } as const;
const FOOTER = "Outer Rim Ledger · data from SWG Legends";

export interface FeedRow {
  id?: string;
  event_at: Date | string;
  outcome: string;
  hunter_name: string;
  target_name: string;
  credits: number | string | null;
  hunter_stats?: EncounterHunterStats | null;
}

export interface ParticipantRow {
  id: string;
  current_name: string;
  guild_abbreviation?: string | null;
  city_name?: string | null;
  planet?: string | null;
  first_seen_at?: Date | string | null;
  last_seen_at?: Date | string | null;
}

export interface HistoryRow { leaderboard_id: string; starts_at: Date | string; ends_at: Date | string | null; rank: number; score: number | null }
export interface RivalryRow { opponent: string; encounters: number; wins: number; losses: number; revenge_kills: number }
export interface HunterSummary {
  encounters: number; wins: number; losses: number; win_rate: number | null; credits: number;
  average_bounty: number | null; highest_bounty: number | null; unique_targets: number; active_days: number;
  first_active_at: Date | string | null; last_active_at: Date | string | null;
}
export interface TargetSummary { encounters: number; survived: number; killed: number; survival_rate: number | null }

export interface DossierData {
  participant: ParticipantRow;
  history: HistoryRow[];
  encounters: FeedRow[];
  rivalries: RivalryRow[];
  hunterSummary: HunterSummary | null;
  targetSummary: TargetSummary | null;
}

export interface FeedFilters { q?: string; outcome?: "KILL" | "FAILED"; minCredits?: number }

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const credits = (value: number | string | null | undefined) => `${integer.format(Number(value ?? 0))} cr`;
export const percent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;
const unix = (value: Date | string) => Math.floor(new Date(value).getTime() / 1000);
export const relative = (value: Date | string | null | undefined) => value ? `<t:${unix(value)}:R>` : "—";
export const shortDate = (value: Date | string | null | undefined) => value ? `<t:${unix(value)}:d>` : "—";

// Discord caps embed descriptions at 4096 and field values at 1024 characters.
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max - 2);
  return `${text.slice(0, cut > max / 2 ? cut : max - 1)}…`;
}

const escape = (name: string) => name.replace(/([*_`~|\\])/g, "\\$1");

export function encounterLine(row: FeedRow, options: { perspective?: string } = {}): string {
  const hunter = escape(row.hunter_name);
  const target = escape(row.target_name);
  const when = relative(row.event_at);
  if (row.outcome === "KILL") return `🎯 **${hunter}** claimed **${target}** · ${credits(row.credits)} · ${when}`;
  const survivor = options.perspective && options.perspective.toLowerCase() === row.target_name.toLowerCase();
  return survivor
    ? `🛡️ **${target}** survived **${hunter}** · ${when}`
    : `💨 **${hunter}** failed against **${target}** · ${when}`;
}

export function feedEmbed(rows: FeedRow[], input: { filters?: FeedFilters; total?: number; siteUrl: string }): Embed {
  const filters = input.filters ?? {};
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.minCredits) params.set("minCredits", String(filters.minCredits));
  const query = params.toString();
  const scope = [
    filters.q ? `name ~ “${filters.q}”` : null,
    filters.outcome === "KILL" ? "claims only" : filters.outcome === "FAILED" ? "failures only" : null,
    filters.minCredits ? `≥ ${credits(filters.minCredits)}` : null,
  ].filter(Boolean).join(" · ");
  const description = rows.length
    ? clamp(rows.map((row) => encounterLine(row)).join("\n"), 4096)
    : "No archived encounters match those filters.";
  return {
    title: rows.length ? `Bounty feed · latest ${rows.length} encounter${rows.length === 1 ? "" : "s"}` : "Bounty feed",
    url: `${input.siteUrl}/encounters${query ? `?${query}` : ""}`,
    color: COLORS.feed,
    description,
    footer: { text: [scope, input.total !== undefined ? `${integer.format(input.total)} archived` : null, FOOTER].filter(Boolean).join(" · ") },
    timestamp: rows[0] ? new Date(rows[0].event_at).toISOString() : undefined,
  };
}

// Current-cycle board standings: the newest observation per bounty board
// whose period has not ended yet.
export function currentBoardRanks(history: HistoryRow[], now = new Date()): Array<{ board: string; rank: number }> {
  const seen = new Map<string, number>();
  for (const row of history) {
    if (!(row.leaderboard_id in BOARD_LABELS) || seen.has(row.leaderboard_id)) continue;
    if (row.ends_at && new Date(row.ends_at).getTime() <= now.getTime()) continue;
    seen.set(row.leaderboard_id, Number(row.rank));
  }
  return Object.keys(BOARD_LABELS).filter((id) => seen.has(id)).map((id) => ({ board: BOARD_LABELS[id], rank: seen.get(id)! }));
}

export function hunterDossierEmbed(data: DossierData, input: { siteUrl: string; now?: Date }): Embed {
  const p = data.participant;
  const hunter = data.hunterSummary;
  const target = data.targetSummary;
  const identity = [
    p.guild_abbreviation ? `Guild **${escape(p.guild_abbreviation)}**` : null,
    p.city_name ? `City ${escape(p.city_name)}` : null,
    p.planet ? p.planet : null,
    p.first_seen_at ? `first seen ${shortDate(p.first_seen_at)}` : null,
  ].filter(Boolean).join(" · ");

  const fields: Embed["fields"] = [];
  if (hunter && Number(hunter.encounters) > 0) {
    fields.push({
      name: "Hunter record",
      inline: true,
      value: [
        `**${hunter.wins}W** / **${hunter.losses}L** (${percent(hunter.win_rate)} claim rate)`,
        `${credits(hunter.credits)} collected`,
        `avg ${credits(hunter.average_bounty)} · best ${credits(hunter.highest_bounty)}`,
        `${hunter.unique_targets} targets · ${hunter.active_days} active days`,
      ].join("\n"),
    });
  } else {
    fields.push({ name: "Hunter record", inline: true, value: "No hunter-role encounters archived." });
  }
  if (target && Number(target.encounters) > 0) {
    fields.push({
      name: "As target",
      inline: true,
      value: [
        `hunted **${target.encounters}×**`,
        `survived ${target.survived} · killed ${target.killed}`,
        `${percent(target.survival_rate)} survival`,
      ].join("\n"),
    });
  }
  const ranks = currentBoardRanks(data.history, input.now);
  if (ranks.length) fields.push({ name: "Current cycle boards", inline: true, value: ranks.map((r) => `#${r.rank} ${r.board}`).join("\n") });

  const rivalries = data.rivalries.filter((r) => Number(r.encounters) >= 2).slice(0, 4);
  if (rivalries.length) {
    fields.push({
      name: "Rivalry files",
      value: clamp(rivalries.map((r) => `**${escape(r.opponent)}** — ${r.wins}W ${r.losses}L${Number(r.revenge_kills) ? ` · ${r.revenge_kills} revenge` : ""}`).join("\n"), 1024),
    });
  }
  const recent = data.encounters.slice(0, 5);
  if (recent.length) {
    fields.push({ name: "Recent encounters", value: clamp(recent.map((row) => encounterLine(row, { perspective: p.current_name })).join("\n"), 1024) });
  }
  const lastActive = hunter?.last_active_at ?? p.last_seen_at;

  return {
    title: `${p.current_name} · Hunter dossier`,
    url: `${input.siteUrl}/hunter/${p.id}`,
    color: COLORS.dossier,
    description: identity || undefined,
    fields,
    footer: { text: `Last active ${lastActive ? new Date(lastActive).toISOString().slice(0, 10) : "unknown"} · ${FOOTER}` },
  };
}

// Hunters who appear only in the encounter log (never on a board) have no
// participant row; the per-encounter hunter_stats still describe them.
export function hunterLiteEmbed(name: string, rows: FeedRow[], input: { siteUrl: string }): Embed {
  const stats = rows.find((row) => row.hunter_name.toLowerCase() === name.toLowerCase())?.hunter_stats ?? null;
  const fields: Embed["fields"] = [];
  if (stats) {
    fields.push({
      name: "Archive record",
      inline: true,
      value: `**${stats.overall_kills}W** / ${stats.overall_failures}L as hunter\n${credits(stats.overall_credits)} collected\n${stats.overall_deaths} deaths overall`,
    });
    fields.push({
      name: "This cycle",
      inline: true,
      value: `${stats.cycle_kills}W / ${stats.cycle_failures}L\n${credits(stats.cycle_credits)}`,
    });
  }
  if (rows.length) fields.push({ name: "Recent encounters", value: clamp(rows.slice(0, 5).map((row) => encounterLine(row, { perspective: name })).join("\n"), 1024) });
  return {
    title: `${name} · Hunter dossier`,
    url: `${input.siteUrl}/encounters?q=${encodeURIComponent(name)}`,
    color: COLORS.dossier,
    description: "Not yet observed on a public leaderboard; record derived from the encounter archive.",
    fields,
    footer: { text: FOOTER },
  };
}

export function notFoundEmbed(name: string, suggestions: string[]): Embed {
  return {
    title: "No hunter found",
    color: COLORS.warning,
    description: `Nothing in the archive matches **${escape(name)}**.${suggestions.length ? `\n\nDid you mean: ${suggestions.map((s) => `**${escape(s)}**`).join(", ")}?` : ""}`,
    footer: { text: FOOTER },
  };
}
