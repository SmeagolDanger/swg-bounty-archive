import { BOARD_LABELS } from "@/lib/constants";
import type { EncounterHunterStats } from "@/lib/data";
import type { Embed } from "./interactions";

// Pure embed builders for the slash commands. Everything here is formatting:
// no database access, so the output is unit-testable against fixtures.
//
// Layout approach: Discord embeds cannot align proportional text, so tabular
// content (encounter rows, rivalry records, the stat card) is rendered inside
// ```ansi code blocks with fixed-width columns and colour escapes. Desktop
// renders the colours; mobile shows the same aligned text in plain grey.
// Rows stay ≤ 56 characters so they never wrap on a default desktop window.

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

// ---------------------------------------------------------------- formatting

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const num = (value: number | string | null | undefined) => integer.format(Number(value ?? 0));
export const credits = (value: number | string | null | undefined) => `${num(value)} cr`;
export const percent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;
const isoDay = (value: Date | string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : null;

// Compact age for table cells: "now", "17m", "13h", "3d". Fixed width keeps
// columns aligned, which Discord's <t:…:R> pills cannot do.
export function age(value: Date | string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.min(999, Math.round(hours / 24))}d`;
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

// Wraps rows in an ansi fence, dropping trailing rows to honour Discord's
// character limits (4096 description / 1024 field value).
export function ansiBlock(rows: string[], maxChars: number): string {
  const wrap = (lines: string[]) => `\`\`\`ansi\n${lines.join("\n")}\n\`\`\``;
  let kept = rows;
  while (kept.length && wrap(kept).length > maxChars) {
    kept = kept.slice(0, -1);
    const omitted = rows.length - kept.length;
    const note = `${ansi.gray}… ${omitted} more${ansi.reset}`;
    if (wrap([...kept, note]).length <= maxChars) return wrap([...kept, note]);
  }
  return wrap(kept);
}

// Win/loss bar: green cells for wins, red for losses.
export function ratioBar(wins: number, losses: number, cells = 10): string {
  const total = Number(wins) + Number(losses);
  if (!total) return `${ansi.gray}${"·".repeat(cells)}${ansi.reset}`;
  const won = Math.round((Number(wins) / total) * cells);
  return `${ansi.green}${"█".repeat(won)}${ansi.red}${"█".repeat(cells - won)}${ansi.reset}`;
}

// ---------------------------------------------------------------- feed rows

//  age  ◆ hunter           ▸ target                credits
const NAME = 16;
export function feedTableRow(row: FeedRow, now: Date): string {
  const kill = row.outcome === "KILL";
  const glyph = kill ? `${ansi.green}◆${ansi.reset}` : `${ansi.red}◇${ansi.reset}`;
  const payout = kill ? `${ansi.gold}${right(num(row.credits), 9)}${ansi.reset}` : `${ansi.gray}${right("—", 9)}${ansi.reset}`;
  return `${ansi.gray}${right(age(row.event_at, now), 4)}${ansi.reset} ${glyph} ${ansi.bold}${fit(row.hunter_name, NAME)}${ansi.reset} ${ansi.gray}▸${ansi.reset} ${fit(row.target_name, NAME)} ${payout}`;
}
const FEED_HEADER = `${ansi.gray} age   hunter           ▸ target              credits${ansi.reset}`;

//  age  ◆ claimed   other                   credits   (from one hunter's view)
export function perspectiveRow(row: FeedRow, name: string, now: Date): string {
  const me = name.toLowerCase();
  const asHunter = row.hunter_name.toLowerCase() === me;
  const other = asHunter ? row.target_name : row.hunter_name;
  const kill = row.outcome === "KILL";
  const won = asHunter ? kill : !kill;
  const verb = asHunter ? (kill ? "claimed" : "failed") : (kill ? "slain by" : "survived");
  const glyph = won ? `${ansi.green}◆${ansi.reset}` : `${ansi.red}◇${ansi.reset}`;
  const payout = kill ? `${asHunter ? ansi.gold : ansi.red}${right(num(row.credits), 9)}${ansi.reset}` : `${ansi.gray}${right("—", 9)}${ansi.reset}`;
  return `${ansi.gray}${right(age(row.event_at, now), 4)}${ansi.reset} ${glyph} ${won ? ansi.green : ansi.red}${fit(verb, 8)}${ansi.reset}  ${ansi.bold}${fit(other, 20)}${ansi.reset} ${payout}`;
}

// ---------------------------------------------------------------- feed embed

export function feedEmbed(rows: FeedRow[], input: { filters?: FeedFilters; total?: number; siteUrl: string; now?: Date }): Embed {
  const now = input.now ?? new Date();
  const filters = input.filters ?? {};
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.minCredits) params.set("minCredits", String(filters.minCredits));
  const query = params.toString();
  const scope = [
    filters.q ? `“${filters.q}”` : null,
    filters.outcome === "KILL" ? "claims only" : filters.outcome === "FAILED" ? "failures only" : null,
    filters.minCredits ? `≥ ${credits(filters.minCredits)}` : null,
  ].filter(Boolean).join(" · ");

  const kills = rows.filter((row) => row.outcome === "KILL");
  const failures = rows.length - kills.length;
  const paid = kills.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const oldest = rows.at(-1);
  const strip = rows.length
    ? [
      `🎯 **${kills.length}** claim${kills.length === 1 ? "" : "s"}`,
      `💨 **${failures}** failure${failures === 1 ? "" : "s"}`,
      `💰 **${credits(paid)}** paid`,
      oldest ? `⏱ last **${age(oldest.event_at, now)}**` : null,
    ].filter(Boolean).join("  ·  ")
    : "No archived encounters match those filters.";
  const table = rows.length ? `\n${ansiBlock([FEED_HEADER, ...rows.map((row) => feedTableRow(row, now))], 4096 - strip.length - 2)}` : "";

  return {
    author: { name: `${BRAND} · Bounty feed` },
    title: rows.length ? `Latest ${rows.length} encounter${rows.length === 1 ? "" : "s"}${scope ? ` · ${scope}` : ""}` : "Bounty feed",
    url: `${input.siteUrl}/encounters${query ? `?${query}` : ""}`,
    color: COLORS.feed,
    description: `${strip}${table}`,
    footer: { text: [input.total !== undefined ? `${num(input.total)} encounters archived` : null, FOOTER].filter(Boolean).join(" · ") },
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

const label = (text: string) => `${ansi.gray}${fit(text, 11)}${ansi.reset}`;
const strong = (text: string) => `${ansi.bold}${ansi.white}${text}${ansi.reset}`;
const dim = (text: string) => `${ansi.gray}${text}${ansi.reset}`;
const wl = (wins: number | string, losses: number | string) => `${ansi.green}${wins}W${ansi.reset} ${ansi.red}${losses}L${ansi.reset}`;

// The stat card: aligned rows summarising both encounter roles.
export function statCard(hunter: HunterSummary | null, target: TargetSummary | null): string[] {
  const rows: string[] = [];
  if (hunter && Number(hunter.encounters) > 0) {
    rows.push(`${label("CLAIM RATE")} ${strong(right(percent(hunter.win_rate), 4))}  ${ratioBar(hunter.wins, hunter.losses, 20)}  ${wl(hunter.wins, hunter.losses)}`);
    rows.push(`${label("COLLECTED")} ${ansi.gold}${strong(credits(hunter.credits))}  ${dim(`avg ${num(hunter.average_bounty)} · best ${num(hunter.highest_bounty)}`)}`);
    rows.push(`${label("ACTIVITY")} ${strong(String(hunter.unique_targets))} ${dim("targets")}  ${strong(String(hunter.active_days))} ${dim("active days")}  ${strong(String(hunter.encounters))} ${dim("contracts")}`);
  } else {
    rows.push(`${label("CLAIM RATE")} ${dim("no hunter-role contracts archived")}`);
  }
  if (target && Number(target.encounters) > 0) {
    rows.push(`${label("HUNTED")} ${strong(right(`${target.encounters}×`, 4))}  ${ratioBar(target.survived, target.killed, 20)}  ${ansi.green}${target.survived} alive${ansi.reset} ${ansi.red}${target.killed} slain${ansi.reset}`);
  }
  return rows;
}

export function rivalryRow(r: RivalryRow): string {
  const revenge = Number(r.revenge_kills) ? `  ${ansi.gold}↩ ${r.revenge_kills} revenge${ansi.reset}` : "";
  return `${ansi.bold}${fit(r.opponent, 18)}${ansi.reset} ${ratioBar(r.wins, r.losses)} ${ansi.green}${right(`${r.wins}W`, 3)}${ansi.reset} ${ansi.red}${right(`${r.losses}L`, 3)}${ansi.reset}${revenge}`;
}

export function hunterDossierEmbed(data: DossierData, input: { siteUrl: string; now?: Date }): Embed {
  const now = input.now ?? new Date();
  const p = data.participant;
  const hunter = data.hunterSummary;
  const identity = [
    p.guild_abbreviation ? `⟨ **${p.guild_abbreviation}** ⟩` : null,
    p.city_name ? `🏙 ${p.city_name}` : null,
    p.planet ? `🪐 ${p.planet}` : null,
    p.first_seen_at ? `📅 since ${isoDay(p.first_seen_at)}` : null,
  ].filter(Boolean).join("   ");
  const card = ansiBlock(statCard(hunter, data.targetSummary), 4096 - identity.length - 2);

  const fields: NonNullable<Embed["fields"]> = [];
  const ranks = currentBoardRanks(data.history, now);
  if (ranks.length) fields.push({ name: "Current cycle boards", value: boardLine(ranks) });

  const rivalries = data.rivalries.filter((r) => Number(r.encounters) >= 2).slice(0, 5);
  if (rivalries.length) fields.push({ name: "Rivalry files", value: ansiBlock(rivalries.map(rivalryRow), 1024) });

  const recent = data.encounters.slice(0, 6);
  if (recent.length) fields.push({ name: "Recent encounters", value: ansiBlock(recent.map((row) => perspectiveRow(row, p.current_name, now)), 1024) });

  const lastActive = isoDay(hunter?.last_active_at ?? p.last_seen_at);
  return {
    author: { name: `${BRAND} · Hunter dossier` },
    title: p.current_name,
    url: `${input.siteUrl}/hunter/${p.id}`,
    color: COLORS.dossier,
    description: `${identity}${identity ? "\n" : ""}${card}`,
    fields,
    footer: { text: `Last active ${lastActive ?? "unknown"} · ${FOOTER}` },
  };
}

// Hunters who appear only in the encounter log (never on a board) have no
// participant row; the per-encounter hunter_stats still describe them.
export function hunterLiteEmbed(name: string, rows: FeedRow[], input: { siteUrl: string; now?: Date }): Embed {
  const now = input.now ?? new Date();
  const stats = rows.find((row) => row.hunter_name.toLowerCase() === name.toLowerCase())?.hunter_stats ?? null;
  const card = stats
    ? ansiBlock([
      `${label("ARCHIVE")} ${ratioBar(stats.overall_kills, stats.overall_failures, 20)}  ${wl(stats.overall_kills, stats.overall_failures)}  ${dim(`${stats.overall_deaths} deaths`)}`,
      `${label("COLLECTED")} ${ansi.gold}${strong(credits(stats.overall_credits))}`,
      `${label("THIS CYCLE")} ${wl(stats.cycle_kills, stats.cycle_failures)}  ${ansi.gold}${credits(stats.cycle_credits)}${ansi.reset}`,
    ], 3000)
    : "";
  const fields: NonNullable<Embed["fields"]> = [];
  if (rows.length) fields.push({ name: "Recent encounters", value: ansiBlock(rows.slice(0, 6).map((row) => perspectiveRow(row, name, now)), 1024) });
  return {
    author: { name: `${BRAND} · Hunter dossier` },
    title: name,
    url: `${input.siteUrl}/encounters?q=${encodeURIComponent(name)}`,
    color: COLORS.dossier,
    description: `📜 Not yet observed on a public leaderboard; record derived from the encounter archive.\n${card}`,
    fields,
    footer: { text: FOOTER },
  };
}

const escapeMarkdown = (text: string) => plain(text).replace(/([*_~|\\])/g, "\\$1");

export function notFoundEmbed(name: string, suggestions: string[]): Embed {
  return {
    author: { name: `${BRAND} · Hunter dossier` },
    title: "No hunter found",
    color: COLORS.warning,
    description: `Nothing in the archive matches **${escapeMarkdown(name)}**.${suggestions.length ? `\n\nDid you mean: ${suggestions.map((s) => `**${escapeMarkdown(s)}**`).join(", ")}?` : ""}`,
    footer: { text: FOOTER },
  };
}
