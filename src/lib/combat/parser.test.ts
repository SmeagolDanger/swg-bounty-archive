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
