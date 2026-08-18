// Groups streamed combat events into play sessions and encounters for the
// app's combat history and shareable reports. Aggregation matches the live
// meter (and BeefySan/SWGLogAnalyzer): NPC article canonicalization,
// "<Name> Effect*" / short-name alias merging, and DoT ticks credited to
// the caster who applied the ability.

export interface CombatEventInput {
  kind: string;
  source: string;
  target: string;
  ability: string;
  amount: number;
  flag: string;
  occurredAt: Date;
}

export interface EncounterActor {
  name: string;
  isNpc: boolean;
  damage: number;
  dps: number;
  maxHit: number;
  healing: number;
  share: number; // 0..1 of the encounter's player-side damage
  hits: number;
  crits: number;
}

export interface Encounter {
  start: string;
  end: string;
  durationSeconds: number;
  title: string; // the "boss": whoever took the most damage
  defeated: boolean;
  totalDamage: number;
  groupDps: number;
  deaths: string[];
  actors: EncounterActor[];
}

export interface CombatSession {
  start: string;
  end: string;
  totalDamage: number;
  encounterCount: number;
  topPlayer: string;
  encounters: Encounter[];
}

const ENCOUNTER_GAP_MS = 20_000; // matches the live meter's fight gap
const SESSION_GAP_MS = 30 * 60_000;

const isNpc = (name: string) => /^(?:a|an|the)\s+/i.test(name.trim());

function canonicalNpc(name: string): string {
  const trimmed = name.trim();
  const article = /^(a|an|the)\s+/i.exec(trimmed);
  if (!article) return trimmed;
  const cap = article[1].toLowerCase() === "a" ? "A " : article[1].toLowerCase() === "an" ? "An " : "The ";
  return cap + trimmed.slice(article[0].length);
}

function normalize(events: CombatEventInput[]): CombatEventInput[] {
  const singles = new Map<string, string>();
  for (const event of events) {
    for (const name of [event.source, event.target]) {
      if (name && !isNpc(name) && !name.includes(" ") && !singles.has(name.toLowerCase())) {
        singles.set(name.toLowerCase(), name);
      }
    }
  }
  const mapName = (name: string): string => {
    if (!name) return name;
    if (isNpc(name)) return canonicalNpc(name);
    const parts = name.split(/\s+/);
    if (parts.length === 2 && parts[1].startsWith("Effect")) {
      return singles.get(parts[0].toLowerCase()) ?? parts[0];
    }
    if (parts.length > 1) {
      const canonical = singles.get(parts[0].toLowerCase());
      if (canonical) return canonical;
    }
    return name;
  };

  const lastCaster = new Map<string, string>();
  const lastSource = new Map<string, string>();
  return events.map((event) => {
    let source = mapName(event.source);
    const target = mapName(event.target);
    if (event.kind === "damage") {
      const key = `${event.ability.toLowerCase()}||${target}`;
      const dotSelfSourced = event.flag === "periodic" && (event.source === event.ability || event.source === "Periodic");
      if (dotSelfSourced) {
        source = lastCaster.get(key) ?? lastSource.get(target) ?? source;
      } else {
        if (event.flag !== "periodic") lastSource.set(target, source);
        lastCaster.set(key, source);
      }
    }
    return { ...event, source, target };
  });
}

function buildEncounter(events: CombatEventInput[]): Encounter {
  const start = events[0].occurredAt;
  const end = events[events.length - 1].occurredAt;
  const durationSeconds = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1_000));

  const taken = new Map<string, number>();
  const actors = new Map<string, { damage: number; maxHit: number; healing: number; hits: number; crits: number }>();
  let totalDamage = 0;
  const deaths: string[] = [];

  for (const event of events) {
    if (event.kind === "damage" && event.source) {
      const entry = actors.get(event.source) ?? { damage: 0, maxHit: 0, healing: 0, hits: 0, crits: 0 };
      entry.damage += event.amount;
      entry.maxHit = Math.max(entry.maxHit, event.amount);
      entry.hits += 1;
      if (event.flag === "crit") entry.crits += 1;
      actors.set(event.source, entry);
      totalDamage += event.amount;
      if (event.target) taken.set(event.target, (taken.get(event.target) ?? 0) + event.amount);
    }
    if (event.kind === "heal" && event.source) {
      const entry = actors.get(event.source) ?? { damage: 0, maxHit: 0, healing: 0, hits: 0, crits: 0 };
      entry.healing += event.amount;
      actors.set(event.source, entry);
    }
    if (event.kind === "death" && event.target) deaths.push(event.target);
  }

  // The boss is whoever soaked the most damage — prefer NPCs so a healer
  // topping the taken chart in a rough pull doesn't get billed as the boss.
  const ranked = [...taken.entries()].sort((a, b) => b[1] - a[1]);
  const boss = ranked.find(([name]) => isNpc(name))?.[0] ?? ranked[0]?.[0] ?? "Unknown";
  const defeated = deaths.some((name) => name === boss);

  const actorRows: EncounterActor[] = [...actors.entries()]
    .map(([name, stats]) => ({
      name,
      isNpc: isNpc(name),
      damage: stats.damage,
      dps: stats.damage / durationSeconds,
      maxHit: stats.maxHit,
      healing: stats.healing,
      share: totalDamage > 0 ? stats.damage / totalDamage : 0,
      hits: stats.hits,
      crits: stats.crits,
    }))
    .sort((a, b) => b.damage - a.damage);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    durationSeconds,
    title: boss,
    defeated,
    totalDamage,
    groupDps: totalDamage / durationSeconds,
    deaths,
    actors: actorRows,
  };
}

export function buildSessions(rawEvents: CombatEventInput[]): CombatSession[] {
  const events = normalize(rawEvents).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  // Encounters: clusters where damage never pauses longer than the gap.
  const encounters: Encounter[] = [];
  let cluster: CombatEventInput[] = [];
  let lastDamageAt = 0;
  for (const event of events) {
    if (cluster.length && event.occurredAt.getTime() - lastDamageAt > ENCOUNTER_GAP_MS) {
      if (cluster.some((entry) => entry.kind === "damage")) encounters.push(buildEncounter(cluster));
      cluster = [];
    }
    cluster.push(event);
    if (event.kind === "damage" || cluster.length === 1) lastDamageAt = event.occurredAt.getTime();
  }
  if (cluster.some((entry) => entry.kind === "damage")) encounters.push(buildEncounter(cluster));

  // Sessions: encounters separated by less than the session gap.
  const sessions: CombatSession[] = [];
  let group: Encounter[] = [];
  for (const encounter of encounters) {
    if (group.length && new Date(encounter.start).getTime() - new Date(group[group.length - 1].end).getTime() > SESSION_GAP_MS) {
      sessions.push(finishSession(group));
      group = [];
    }
    group.push(encounter);
  }
  if (group.length) sessions.push(finishSession(group));
  return sessions.reverse(); // newest first
}

function finishSession(encounters: Encounter[]): CombatSession {
  const totals = new Map<string, number>();
  let totalDamage = 0;
  for (const encounter of encounters) {
    totalDamage += encounter.totalDamage;
    for (const actor of encounter.actors) {
      if (!actor.isNpc) totals.set(actor.name, (totals.get(actor.name) ?? 0) + actor.damage);
    }
  }
  const topPlayer = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    start: encounters[0].start,
    end: encounters[encounters.length - 1].end,
    totalDamage,
    encounterCount: encounters.length,
    topPlayer,
    encounters: [...encounters].reverse(), // newest first inside the session
  };
}
