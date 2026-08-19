import { describe, expect, it } from "vitest";
import { parseCombatLine } from "./parser";

// Line shapes mirror BeefySan/SWGLogAnalyzer's fixtures — the streaming
// monitor must read the same logs the offline analyzer does.
describe("combat parser", () => {
  it("parses attack-with-ability lines including crits and evasion", () => {
    const event = parseCombatLine("[Combat] 21:14:03 Beefy attacks a canyon krayt dragon with Rifle Sniper Shot and crits (25% evaded) for 8342 points");
    expect(event).toMatchObject({
      clock: 21 * 3600 + 14 * 60 + 3,
      kind: "damage",
      source: "Beefy",
      target: "a canyon krayt dragon",
      ability: "Rifle Sniper Shot",
      amount: 8342,
      flag: "crit",
    });
  });

  it("parses bare attack lines", () => {
    const event = parseCombatLine("12:00:01 A womp rat attacks Beefy and hits for 210 points");
    expect(event).toMatchObject({ kind: "damage", source: "A womp rat", target: "Beefy", amount: 210, flag: "hit", ability: "attack" });
  });

  it("parses generic damages lines with trailing ability", () => {
    const event = parseCombatLine("[Combat] 09:30:00 Lurcio damages a sand beetle for 455 points with Force Lightning");
    expect(event).toMatchObject({ kind: "damage", source: "Lurcio", ability: "Force Lightning", amount: 455 });
  });

  it("parses damage-over-time ticks", () => {
    const event = parseCombatLine("[Combat] 09:30:02 A sand beetle suffers 120 points of damage from Fire Blanket over time.");
    expect(event).toMatchObject({ kind: "damage", target: "A sand beetle", source: "Fire Blanket", amount: 120, flag: "periodic" });
  });

  it("parses has-caused elemental damage", () => {
    const event = parseCombatLine("10:00:00 Beefy has caused a bark mite to take 2567 points of cold damage.");
    expect(event).toMatchObject({ kind: "damage", source: "Beefy", target: "a bark mite", amount: 2567, flag: "periodic" });
  });

  it("parses heals with abilities", () => {
    const event = parseCombatLine("[Combat] 18:05:11 Shepard heals Beefy for 3200 points with Bacta Ampule");
    expect(event).toMatchObject({ kind: "heal", source: "Shepard", target: "Beefy", ability: "Bacta Ampule", amount: 3200 });
  });

  it("parses dodges, deaths, and utility performs", () => {
    expect(parseCombatLine("11:11:11 A womp rat attacks Beefy and misses (dodge).")).toMatchObject({ kind: "avoid", flag: "dodge", target: "Beefy" });
    expect(parseCombatLine("[Combat] 11:12:00 A womp rat is no more.")).toMatchObject({ kind: "death", target: "A womp rat" });
    expect(parseCombatLine("11:13:00 Beefy performs Overcharge Shot.")).toMatchObject({ kind: "utility", source: "Beefy", ability: "Overcharge Shot" });
  });

  it("rejects unstamped lines, chatter, and unrealistic player hits", () => {
    expect(parseCombatLine("Beefy attacks a womp rat and hits for 100 points")).toBeNull();
    expect(parseCombatLine("[Combat] 11:11:11 Beefy says hello there")).toBeNull();
    expect(parseCombatLine("11:11:11 Beefy attacks a womp rat and hits for 99999 points")).toBeNull();
  });
});

describe("Omega line shapes from real logs", () => {
  it("parses bare misses", () => {
    expect(parseCombatLine("[Combat]  00:09:05 Suin Chalo attacks RalphieJames using Power Hammer and misses."))
      .toMatchObject({ kind: "avoid", source: "Suin Chalo", target: "RalphieJames", flag: "miss" });
  });

  it("parses has-taken DoT ticks with and without element", () => {
    expect(parseCombatLine("[Combat]  23:08:05 Jurius Noble has taken 1125 points of bleeding damage. (375 absorbed / 0 resisted. )"))
      .toMatchObject({ kind: "damage", target: "Jurius Noble", amount: 1125, ability: "bleeding", flag: "periodic" });
    expect(parseCombatLine("[Combat]  23:08:06 a blacksun boarder has taken 90 points of damage."))
      .toMatchObject({ kind: "damage", target: "a blacksun boarder", amount: 90, flag: "periodic" });
  });

  it("parses wracked, agony, and you-healed lines", () => {
    expect(parseCombatLine("[Combat]  10:00:00 O'dae Alca is wracked with crippling pain for 388 points of damage!"))
      .toMatchObject({ kind: "damage", target: "O'dae Alca", amount: 388, flag: "periodic" });
    expect(parseCombatLine("[Combat]  22:37:29 You are rent by agony sharing 507 points of damage."))
      .toMatchObject({ kind: "damage", target: "You", amount: 507 });
    expect(parseCombatLine("[Combat]  22:37:30 You have healed RalphieJames Otapae for 2000 points of damage."))
      .toMatchObject({ kind: "heal", source: "You", target: "RalphieJames Otapae", amount: 2000 });
  });

  it("still parses the real attack line from production logs", () => {
    expect(parseCombatLine("[Combat]  18:34:38 RalphieJames attacks Nym's guard with Sweep 7: Sai tok Jung Ma and hits for 2821 points (2666 energy and 155 heat). Armor absorbed 1128 points out of 3949."))
      .toMatchObject({ kind: "damage", source: "RalphieJames", target: "Nym's guard", ability: "Sweep 7: Sai tok Jung Ma", amount: 2821, flag: "hit" });
  });
});
