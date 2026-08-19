import { describe, expect, it } from "vitest";
import { buildSessions, type CombatEventInput } from "./sessions";

const base = Date.parse("2026-08-18T20:00:00Z");
const at = (secondsOffset: number) => new Date(base + secondsOffset * 1_000);

const damage = (offset: number, source: string, target: string, amount: number, flag = "hit", ability = "attack"): CombatEventInput => ({
  kind: "damage", source, target, ability, amount, flag, occurredAt: at(offset),
});

describe("combat sessions", () => {
  it("splits encounters on damage gaps and sessions on long idles", () => {
    const events: CombatEventInput[] = [
      // Encounter 1: krayt, defeated, 10s duration.
      damage(0, "Beefy", "a canyon krayt dragon", 5000, "crit"),
      damage(5, "Shepard", "a canyon krayt dragon", 3000),
      { kind: "heal", source: "Shepard", target: "Beefy", ability: "Bacta", amount: 800, flag: "", occurredAt: at(6) },
      damage(10, "Beefy", "a canyon krayt dragon", 2000),
      { kind: "death", source: "", target: "a canyon krayt dragon", ability: "", amount: 0, flag: "", occurredAt: at(11) },
      // 60s pause -> new encounter, same session; the rat escapes.
      damage(70, "Beefy", "a womp rat", 400),
      damage(75, "Beefy", "a womp rat", 350),
      // 45 minutes later -> a new session entirely.
      damage(2_700 + 75, "Beefy", "a bark mite", 100),
    ];
    const sessions = buildSessions(events);
    expect(sessions).toHaveLength(2);
    // Newest session first.
    expect(sessions[0].encounters[0].title).toBe("A bark mite");
    const first = sessions[1];
    expect(first.encounterCount).toBe(2);
    expect(first.topPlayer).toBe("Beefy");

    const krayt = first.encounters[1]; // oldest encounter is last
    expect(krayt.title).toBe("A canyon krayt dragon");
    expect(krayt.defeated).toBe(true);
    expect(krayt.durationSeconds).toBe(11);
    expect(krayt.totalDamage).toBe(10_000);
    expect(krayt.actors[0]).toMatchObject({ name: "Beefy", damage: 7000, crits: 1, hits: 2 });
    expect(krayt.actors[0].share).toBeCloseTo(0.7);
    expect(krayt.actors[1]).toMatchObject({ name: "Shepard", damage: 3000, healing: 800 });

    const rat = first.encounters[0];
    expect(rat.title).toBe("A womp rat");
    expect(rat.defeated).toBe(false);
  });

  it("merges aliases and credits DoT ticks to their caster", () => {
    const events: CombatEventInput[] = [
      damage(0, "Beefy", "a bark mite", 1000, "", "Fire Blanket"),
      // DoT tick arrives self-sourced by ability name; should credit Beefy.
      damage(3, "Fire Blanket", "a bark mite", 200, "periodic", "Fire Blanket"),
      // Effect-suffix and surname variants collapse into Beefy.
      damage(6, "Beefy EffectMass", "a bark mite", 300),
      damage(9, "Beefy Leering-Creeper", "a bark mite", 500),
    ];
    const sessions = buildSessions(events);
    const actors = sessions[0].encounters[0].actors;
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({ name: "Beefy", damage: 2000 });
  });

  it("keeps unresolvable self-DoT damage out of the player list", () => {
    const events: CombatEventInput[] = [
      { kind: "damage", source: "agony sharing", target: "You", ability: "agony sharing", amount: 500, flag: "periodic", occurredAt: at(0) },
      damage(2, "Beefy", "a womp rat", 100),
    ];
    const sessions = buildSessions(events);
    const encounter = sessions[0].encounters[0];
    expect(encounter.totalDamage).toBe(600);
    expect(encounter.actors.map((a) => a.name)).toEqual(["Beefy"]);
    expect(sessions[0].topPlayer).toBe("Beefy");
  });
});
