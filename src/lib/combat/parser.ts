// Combat chat-log parser for the live DPS monitor.
//
// The line grammar deliberately matches BeefySan/SWGLogAnalyzer
// (https://github.com/BeefySan/SWGLogAnalyzer) so the streaming monitor and
// the offline analyzer read the same logs identically. Every line carries a
// local HH:MM:SS stamp and NAMED actors — there is no "You" in this format —
// so events are per-actor and the monitor works like a group meter.

export const COMBAT_PARSER_VERSION = "1.1.0";

export type CombatLineEvent = {
  clock: number; // seconds since midnight, from the line's HH:MM:SS stamp
  kind: "damage" | "heal" | "death" | "avoid" | "utility";
  source: string;
  target: string;
  ability: string;
  amount: number;
  flag: string; // '' | 'hit' | 'crit' | 'glance' | 'strikethrough' | 'periodic' | 'dodge' | 'parry'
};

const T_TIME = /^(?:\[\s*Combat\s*\]\s*)?(\d{2}):(\d{2}):(\d{2})\s+/i;

const RX_DMG_WITH =
  /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+(.+?)\s+(?:and\s+(hits|glances|crits|critically\s+hits|critical\s+hits|strikes\s+through|punishing\s+blows))?(?:\s*\((\d+)\s*%(?:\s*evaded)?\))?\s*for\s+(\d+)\s+points/i;
const RX_DMG_BARE =
  /^(.+?)\s+attacks\s+(.+?)(?:\s+and\s+)?(?:(hits|glances|crits|critically\s+hits|critical\s+hits|strikes\s+through|punishing\s+blows))?(?:\s*\((\d+)\s*%(?:\s*evaded)?\))?\s*for\s+(\d+)\s+points/i;
const RX_DMG_GENERIC = /^(.+?)\s+damages\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+(?:with|using)\s+(.+?))?\.?$/i;
const RX_DMG_DOT = /^(.+?)\s+suffers\s+(\d+)\s+points\s+of\s+damage\s+from\s+(.+?)\s+over\s+time/i;
const RX_DMG_HAS_CAUSED_ELEM = /^(.+?)\s+has\s+caused\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+([a-z]+)\s+damage/i;
const RX_DMG_HAS_CAUSED = /^(.+?)\s+has\s+caused\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+damage/i;
const RX_DMG_CAUSED = /^(.+?)\s+causes\s+(.+?)\s+to\s+take\s+(\d+)\s+points\s+of\s+damage/i;
const RX_HEAL = /^(.+?)\s+heals\s+(.+?)\s+for\s+(\d+)\s+points(?:\s+with\s+(.+))?/i;
const RX_DEATH = /^(.+?)\s+is\s+no\s+more\./i;
const RX_PERFORM = /^(.+?)\s+performs\s+(.+?)\.?\s*$/i;

const RX_MISSES_PAREN = /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:with|using)\s+.+?)?\s+(?:and\s+)?misses\s*\((dodge|parry|parries)\)\.?$/i;
const RX_MISSES_BARE = /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:with|using)\s+.+?)?\s+and\s+misses\.?\s*$/i;
// Omega-specific damage-over-time and self-referential lines.
const RX_DMG_TAKEN = /^(.+?)\s+has\s+taken\s+(\d+)\s+points\s+of\s+(?:([a-z]+)\s+)?damage/i;
const RX_DMG_WRACKED = /^(.+?)\s+is\s+wracked\s+with\s+crippling\s+pain\s+for\s+(\d+)\s+points/i;
const RX_DMG_AGONY = /^You\s+are\s+rent\s+by\s+agony\s+sharing\s+(\d+)\s+points/i;
const RX_HEAL_YOU = /^You\s+have\s+healed\s+(.+?)\s+for\s+(\d+)\s+points/i;
const RX_DODGE_PARRY_1 = /^(.+?)\s+attacks\s+(.+?)\s+(?:with|using)\s+.*?(?:,?\s+)?(?:but|and)\s+\2\s+(dodges|parries)\b/i;
const RX_DODGE_PARRY_2 = /^(.+?)\s+attacks\s+(.+?)(?:\s+(?:but|and))\s+\2\s+(dodges|parries)\b/i;
const RX_DODGE_PARRY_3 = /^(.+?)\s+(dodges|parries)\s+(.+?)'?s?\s+attack\b/i;
const RX_DODGE_PARRY_4 = /^(.+?)'?s?\s+attack\s+(?:is|was)\s+(dodged|parried)\s+by\s+(.+?)\b/i;

// Single hits above this are log noise, not gameplay (mirrors the analyzer's
// guard); NPC sources (a/an/the …) are exempt like the reference.
const MAX_REALISTIC_HIT = 60_000;
const looksLikeNPC = (name: string) => /^(?:a|an|the)\s+/i.test(name.trim());

const clean = (value?: string) => (value ?? "").trim();

function hitFlag(kindRaw: string): string {
  const kind = kindRaw.toLowerCase().replace(/\s+/g, " ");
  if (kind === "crits" || kind === "critically hits" || kind === "critical hits") return "crit";
  if (kind === "hits") return "hit";
  if (kind === "glances") return "glance";
  if (kind.startsWith("strikes through")) return "strikethrough";
  return "";
}

export function parseCombatLine(raw: string): CombatLineEvent | null {
  const time = T_TIME.exec(raw);
  if (!time) return null;
  const clock = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
  const rest = raw.slice(time[0].length).trim();
  let m: RegExpExecArray | null;

  if ((m = RX_DEATH.exec(rest))) {
    return { clock, kind: "death", source: "", target: clean(m[1]), ability: "", amount: 0, flag: "" };
  }
  if ((m = RX_MISSES_PAREN.exec(rest))) {
    const flag = m[3].toLowerCase().startsWith("dodg") ? "dodge" : "parry";
    return { clock, kind: "avoid", source: clean(m[1]), target: clean(m[2]), ability: "", amount: 0, flag };
  }
  if ((m = RX_DODGE_PARRY_1.exec(rest)) ?? (m = RX_DODGE_PARRY_2.exec(rest))) {
    const flag = m[3].toLowerCase() === "dodges" ? "dodge" : "parry";
    return { clock, kind: "avoid", source: clean(m[1]), target: clean(m[2]), ability: "", amount: 0, flag };
  }
  if ((m = RX_DODGE_PARRY_3.exec(rest))) {
    const flag = m[2].toLowerCase() === "dodges" ? "dodge" : "parry";
    return { clock, kind: "avoid", source: clean(m[3]), target: clean(m[1]), ability: "", amount: 0, flag };
  }
  if ((m = RX_DODGE_PARRY_4.exec(rest))) {
    const flag = m[2].toLowerCase() === "dodged" ? "dodge" : "parry";
    return { clock, kind: "avoid", source: clean(m[1]), target: clean(m[3]), ability: "", amount: 0, flag };
  }
  if ((m = RX_MISSES_BARE.exec(rest))) {
    return { clock, kind: "avoid", source: clean(m[1]), target: clean(m[2]), ability: "", amount: 0, flag: "miss" };
  }

  if ((m = RX_DMG_WITH.exec(rest))) {
    const amount = Number(m[6]);
    if (amount > MAX_REALISTIC_HIT && !looksLikeNPC(m[1])) return null;
    return { clock, kind: "damage", source: clean(m[1]), target: clean(m[2]), ability: clean(m[3]), amount, flag: hitFlag(m[4] ?? "") };
  }
  if ((m = RX_DMG_BARE.exec(rest))) {
    const amount = Number(m[5]);
    if (amount > MAX_REALISTIC_HIT && !looksLikeNPC(m[1])) return null;
    return { clock, kind: "damage", source: clean(m[1]), target: clean(m[2]), ability: "attack", amount, flag: hitFlag(m[3] ?? "") };
  }
  if ((m = RX_DMG_GENERIC.exec(rest))) {
    const amount = Number(m[3]);
    if (amount > MAX_REALISTIC_HIT && !looksLikeNPC(m[1])) return null;
    return { clock, kind: "damage", source: clean(m[1]), target: clean(m[2]), ability: clean(m[4]) || "attack", amount, flag: "" };
  }
  if ((m = RX_DMG_DOT.exec(rest))) {
    // The log names only the ability for damage-over-time ticks; the ability
    // stands in as the source so the meter can still attribute the row.
    const amount = Number(m[2]);
    return { clock, kind: "damage", source: clean(m[3]), target: clean(m[1]), ability: clean(m[3]), amount, flag: "periodic" };
  }
  if ((m = RX_DMG_HAS_CAUSED_ELEM.exec(rest)) ?? (m = RX_DMG_HAS_CAUSED.exec(rest)) ?? (m = RX_DMG_CAUSED.exec(rest))) {
    const amount = Number(m[3]);
    if (amount > MAX_REALISTIC_HIT && !looksLikeNPC(m[1])) return null;
    return { clock, kind: "damage", source: clean(m[1]), target: clean(m[2]), ability: "Periodic", amount, flag: "periodic" };
  }
  if ((m = RX_DMG_TAKEN.exec(rest))) {
    // Self-sourced DoT: ability doubles as the source so aggregation can
    // re-credit the tick to whoever applied it.
    const ability = clean(m[3]) || "Periodic";
    return { clock, kind: "damage", source: ability, target: clean(m[1]), ability, amount: Number(m[2]), flag: "periodic" };
  }
  if ((m = RX_DMG_WRACKED.exec(rest))) {
    return { clock, kind: "damage", source: "crippling pain", target: clean(m[1]), ability: "crippling pain", amount: Number(m[2]), flag: "periodic" };
  }
  if ((m = RX_DMG_AGONY.exec(rest))) {
    return { clock, kind: "damage", source: "agony sharing", target: "You", ability: "agony sharing", amount: Number(m[1]), flag: "periodic" };
  }
  if ((m = RX_HEAL_YOU.exec(rest))) {
    return { clock, kind: "heal", source: "You", target: clean(m[1]), ability: "", amount: Number(m[2]), flag: "" };
  }
  if ((m = RX_HEAL.exec(rest))) {
    return { clock, kind: "heal", source: clean(m[1]), target: clean(m[2]), ability: clean(m[4]), amount: Number(m[3]), flag: "" };
  }
  if ((m = RX_PERFORM.exec(rest))) {
    return { clock, kind: "utility", source: clean(m[1]), target: "", ability: clean(m[2]), amount: 0, flag: "" };
  }
  return null;
}
