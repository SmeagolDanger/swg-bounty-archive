import { BOARD_LABELS } from "@/lib/constants";
import type { EncounterHunterStats } from "@/lib/data";
import type { Embed } from "./interactions";

// Pure embed builders for the slash commands. Everything here is formatting:
// no database access, so the output is unit-testable against fixtures.
//
// Layout approach: Discord embeds cannot align proportional text, so tabular
// content is rendered inside ```ansi code blocks with fixed-width columns and
// colour escapes. Desktop renders the colours; mobile shows the same aligned
// text in plain grey. Rows stay ≤ 56 characters so they never wrap.

export const COLORS = { feed: 0xd4a017, dossier: 0x3b82f6, warning: 0xb45309 } as const;
const BRAND = "Outer Rim Ledger";
const FOOTER = `${BRAND} · data from SWG Legends`;

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
  faction?: string | null;
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
export interface OfficerSalute { faction_name?: string | null; rank_name?: string | null; rank_index?: number | null; profession?: string | null }

export interface DossierData {
  participant: ParticipantRow;
  history: HistoryRow[];
  encounters: FeedRow[];
  rivalries: RivalryRow[];
  hunterSummary: HunterSummary | null;
  targetSummary: TargetSummary | null;
  officerSalute?: OfficerSalute | null;
}

export interface FeedFilters { q?: string; outcome?: "KILL" | "FAILED"; minCredits?: number }

// ---------------------------------------------------------------- formatting

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const num = (value: number | string | null | undefined) => integer.format(Number(value ?? 0));
export const credits = (value: number | string | null | undefined) => `${num(value)} cr`;
const isoDay = (value: Date | string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : null;
const clock = (value: Date | string) => new Date(value).toISOString().slice(11, 16);
const rate = (wins: number, total: number) => total ? `${Math.round((wins / total) * 100)}%` : "—";

// Kill/death ratio as the game community quotes it.
export function kd(kills: number, deaths: number): string {
  if (!kills && !deaths) return "—";
  if (!deaths) return "∞";
  return (kills / deaths).toFixed(2);
}

// ANSI palette Discord renders inside ```ansi blocks.
const ESC = `${String.fromCharCode(27)}[`;
export const ansi = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, gray: `${ESC}30m`, red: `${ESC}31m`, green: `${ESC}32m`,
  gold: `${ESC}33m`, blue: `${ESC}34m`, cyan: `${ESC}36m`, white: `${ESC}37m`,
};
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
export const stripAnsi = (text: string) => text.replace(ANSI_PATTERN, "");
// Names come from the source API; keep control characters and backticks
// (which would close the code fence) out of the table.
const plain = (text: string) => Array.from(text).filter((ch) => ch !== "`" && ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("");

export function fit(text: string, width: number): string {
  const clean = plain(text);
  const cut = clean.length > width ? `${clean.slice(0, Math.max(0, width - 1))}…` : clean;
  return cut.padEnd(width);
}
const right = (text: string, width: number) => plain(text).padStart(width);
const paint = (colour: string, text: string) => `${colour}${text}${ansi.reset}`;

// Wraps rows in an ansi fence, dropping trailing rows to honour Discord's
// character limits (4096 description / 1024 field value).
export function ansiBlock(rows: string[], maxChars: number): string {
  const wrap = (lines: string[]) => `\`\`\`ansi\n${lines.join("\n")}\n\`\`\``;
  let kept = rows;
  while (kept.length && wrap(kept).length > maxChars) {
    kept = kept.slice(0, -1);
    const omitted = rows.length - kept.length;
    const note = paint(ansi.gray, `… ${omitted} more`);
    if (wrap([...kept, note]).length <= maxChars) return wrap([...kept, note]);
  }
  return wrap(kept);
}

// ---------------------------------------------------------------- feed

// Mirrors the site's encounter archive columns:
//  UTC    HUNTER         OUTCOME    TARGET           PAYOUT
const NAME = 13;
export function feedTableRow(row: FeedRow): string {
  const kill = row.outcome === "KILL";
  const outcome = kill ? paint(ansi.green, fit("COLLECTED", 9)) : paint(ansi.red, fit("FAILED", 9));
  const payout = kill ? paint(ansi.gold, right(num(row.credits), 9)) : paint(ansi.gray, right("—", 9));
  return `${paint(ansi.gray, clock(row.event_at))}  ${paint(ansi.bold, fit(row.hunter_name, NAME))}  ${outcome}  ${fit(row.target_name, NAME)} ${payout}`;
}
const FEED_HEADER = paint(ansi.gray, "UTC    HUNTER         OUTCOME    TARGET           PAYOUT");

export function feedEmbed(rows: FeedRow[], input: { filters?: FeedFilters; total?: number; siteUrl: string; now?: Date }): Embed {
  const filters = input.filters ?? {};
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.minCredits) params.set("minCredits", String(filters.minCredits));
  const query = params.toString();
  const scope = [
    filters.q ? `“${filters.q}”` : null,
    filters.outcome === "KILL" ? "collected only" : filters.outcome === "FAILED" ? "failed only" : null,
    filters.minCredits ? `≥ ${credits(filters.minCredits)}` : null,
  ].filter(Boolean).join(" · ");

  const kills = rows.filter((row) => row.outcome === "KILL");
  const failures = rows.length - kills.length;
  const paid = kills.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const days = [...new Set(rows.map((row) => isoDay(row.event_at)))];
  const strip = rows.length
    ? [
      `🎯 **${kills.length}** collected`,
      `💨 **${failures}** got away`,
      `💰 **${credits(paid)}** paid out`,
      `📅 ${days.length === 1 ? days[0] : `${days.at(-1)} → ${days[0]}`}`,
    ].join("  ·  ")
    : "The board is quiet — no encounters match those filters.";
  const table = rows.length ? `\n${ansiBlock([FEED_HEADER, ...rows.map(feedTableRow)], 4096 - strip.length - 2)}` : "";

  return {
    author: { name: `${BRAND} · Bounty Board` },
    title: rows.length ? `📡 Live feed · last ${rows.length} contract${rows.length === 1 ? "" : "s"}${scope ? ` · ${scope}` : ""}` : "📡 Live feed",
    url: `${input.siteUrl}/encounters${query ? `?${query}` : ""}`,
    color: COLORS.feed,
    description: `${strip}${table}`,
    footer: { text: [input.total !== undefined ? `${num(input.total)} contracts archived` : null, FOOTER].filter(Boolean).join(" · ") },
    timestamp: rows[0] ? new Date(rows[0].event_at).toISOString() : undefined,
  };
}

// ---------------------------------------------------------------- dossier

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

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
export const boardLine = (ranks: Array<{ board: string; rank: number }>) =>
  ranks.map((r) => `${MEDALS[r.rank] ?? "▪"} **#${r.rank}** ${r.board}`).join("   ");

// Guild reputation, earned from the archive-wide K/D once a hunter has a
// handful of contracts under their belt.
export function reputation(kills: number, deaths: number): string {
  const total = kills + deaths;
  if (total < 5) return "🐣 Fresh contract";
  const ratio = deaths ? kills / deaths : Infinity;
  if (ratio >= 3) return "★★★★★ Legend of the Outer Rim";
  if (ratio >= 2) return "★★★★ Feared";
  if (ratio >= 1.25) return "★★★ Seasoned";
  if (ratio >= 0.75) return "★★ Scrappy";
  return "★ Bantha fodder";
}

// Character line: faction rank and profession from the Officers' Salute
// registry when the hunter is enrolled, plus guild and home city.
export function characterLine(p: ParticipantRow, salute: OfficerSalute | null | undefined): string {
  const faction = salute?.faction_name ?? p.faction ?? null;
  const factionIcon = /imperial/i.test(faction ?? "") ? "🛡️" : /rebel/i.test(faction ?? "") ? "⚔️" : null;
  const service = [faction, salute?.rank_name].filter(Boolean).join(" ");
  const parts = [
    service ? `${factionIcon ?? "🎖️"} ${service}` : null,
    salute?.profession ? `🧬 ${salute.profession}` : null,
    p.guild_abbreviation ? `⟨ **${plain(p.guild_abbreviation)}** ⟩` : null,
    p.city_name || p.planet ? `🏠 ${[p.city_name, p.planet].filter(Boolean).map((v) => plain(String(v))).join(", ")}` : null,
  ].filter(Boolean);
  return parts.join("   ");
}

export interface KdWindow { kills: number; deaths: number; contracts: number; credits: number }

// Current-cycle numbers ride on the encounter rows (hunter_stats); the
// archive totals come from the dossier summaries. Deaths follow the site's
// definition: failed contracts plus times killed while targeted.
export function kdWindows(data: DossierData): { cycle: KdWindow | null; overall: KdWindow } {
  const me = data.participant.current_name.toLowerCase();
  const stats = data.encounters.find((row) => row.hunter_name.toLowerCase() === me && row.hunter_stats)?.hunter_stats ?? null;
  const cycle = stats && stats.cycle_starts_at
    ? { kills: Number(stats.cycle_kills), deaths: Number(stats.cycle_deaths), contracts: Number(stats.cycle_encounters), credits: Number(stats.cycle_credits) }
    : null;
  const h = data.hunterSummary;
  const overall = {
    kills: Number(h?.wins ?? 0),
    deaths: Number(h?.losses ?? 0) + Number(data.targetSummary?.killed ?? 0),
    contracts: Number(h?.encounters ?? 0),
    credits: Number(h?.credits ?? 0),
  };
  return { cycle, overall };
}

//               KILLS  DEATHS    K/D  CLAIM      CREDITS
//  THIS CYCLE      12       4   3.00    75%    1,240,000
export const kdRow = (label: string, w: KdWindow | null) => w && (w.contracts || w.deaths)
  ? `${paint(ansi.gray, fit(label, 11))} ${paint(ansi.green, right(num(w.kills), 5))}  ${paint(ansi.red, right(num(w.deaths), 6))}  ${paint(`${ansi.bold}${ansi.white}`, right(kd(w.kills, w.deaths), 5))}  ${right(rate(w.kills, w.contracts), 5)}  ${paint(ansi.gold, right(num(w.credits), 11))}`
  : `${paint(ansi.gray, fit(label, 11))} ${paint(ansi.gray, "no contracts observed this cycle")}`;
const KD_HEADER = paint(ansi.gray, "            KILLS  DEATHS    K/D  CLAIM      CREDITS");
const kdBlock = (cycle: KdWindow | null, overall: KdWindow) => ansiBlock([KD_HEADER, kdRow("THIS CYCLE", cycle), kdRow("ALL TIME", overall)], 1024);

export function hunterDossierEmbed(data: DossierData, input: { siteUrl: string; now?: Date }): Embed {
  const now = input.now ?? new Date();
  const p = data.participant;
  const h = data.hunterSummary;
  const { cycle, overall } = kdWindows(data);
  const character = characterLine(p, data.officerSalute);

  const fields: NonNullable<Embed["fields"]> = [{ name: "Kill / Death record", value: kdBlock(cycle, overall) }];

  const highlights = [
    h?.highest_bounty ? `🏆 Biggest payday **${credits(h.highest_bounty)}**` : null,
    h?.unique_targets ? `🎯 **${num(h.unique_targets)}** unique marks` : null,
    data.targetSummary?.encounters ? `🛡️ Hunted **${num(data.targetSummary.encounters)}×**, escaped **${rate(Number(data.targetSummary.survived), Number(data.targetSummary.encounters))}**` : null,
  ].filter(Boolean);
  if (highlights.length) fields.push({ name: "Highlights", value: highlights.join("\n") });

  const ranks = currentBoardRanks(data.history, now);
  if (ranks.length) fields.push({ name: "This week's boards", value: boardLine(ranks) });

  const nemesis = data.rivalries.filter((r) => Number(r.encounters) >= 2 && Number(r.losses) > 0)
    .sort((a, b) => Number(b.losses) - Number(a.losses) || Number(b.encounters) - Number(a.encounters))[0];
  if (nemesis) {
    const revenge = Number(nemesis.revenge_kills);
    fields.push({ name: "Nemesis", value: `☠️ **${plain(nemesis.opponent)}** — ${nemesis.wins}W ${nemesis.losses}L${revenge ? ` · ${revenge} revenge kill${revenge === 1 ? "" : "s"}` : ""}` });
  }

  const lastActive = isoDay(h?.last_active_at ?? p.last_seen_at);
  return {
    author: { name: `${BRAND} · Guild dossier` },
    title: p.current_name,
    url: `${input.siteUrl}/hunter/${p.id}`,
    color: COLORS.dossier,
    description: `${character ? `${character}\n` : ""}**${reputation(overall.kills, overall.deaths)}**`,
    fields,
    footer: { text: `Last contract ${lastActive ?? "unknown"} · ${FOOTER}` },
  };
}

// Hunters who appear only in the encounter log (never on a board) have no
// participant row; the per-encounter hunter_stats still describe them.
export function hunterLiteEmbed(name: string, rows: FeedRow[], input: { siteUrl: string; now?: Date }): Embed {
  const stats = rows.find((row) => row.hunter_name.toLowerCase() === name.toLowerCase())?.hunter_stats ?? null;
  const cycle = stats?.cycle_starts_at ? { kills: Number(stats.cycle_kills), deaths: Number(stats.cycle_deaths), contracts: Number(stats.cycle_encounters), credits: Number(stats.cycle_credits) } : null;
  const overall = stats ? { kills: Number(stats.overall_kills), deaths: Number(stats.overall_deaths), contracts: Number(stats.overall_encounters), credits: Number(stats.overall_credits) } : null;
  const fields: NonNullable<Embed["fields"]> = [];
  if (overall) fields.push({ name: "Kill / Death record", value: kdBlock(cycle, overall) });
  return {
    author: { name: `${BRAND} · Guild dossier` },
    title: name,
    url: `${input.siteUrl}/encounters?q=${encodeURIComponent(name)}`,
    color: COLORS.dossier,
    description: `📜 Off the boards — known only from the contract log.\n**${overall ? reputation(overall.kills, overall.deaths) : "🐣 Fresh contract"}**`,
    fields,
    footer: { text: FOOTER },
  };
}

const escapeMarkdown = (text: string) => plain(text).replace(/([*_~|\\])/g, "\\$1");

export function notFoundEmbed(name: string, suggestions: string[]): Embed {
  return {
    author: { name: `${BRAND} · Guild dossier` },
    title: "No such hunter on file",
    color: COLORS.warning,
    description: `The Guild has nothing on **${escapeMarkdown(name)}**.${suggestions.length ? `\n\nDid you mean: ${suggestions.map((s) => `**${escapeMarkdown(s)}**`).join(", ")}?` : ""}`,
    footer: { text: FOOTER },
  };
}
