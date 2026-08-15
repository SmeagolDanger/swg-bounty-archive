import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bountySchema, leaderboardSchema, officersSchema } from "./schemas";

const fixture = (name: string) => JSON.parse(readFileSync(path.resolve("fixtures/swg", name), "utf8"));

describe("SWG response parsers", () => {
  it("parses the captured bounty response", () => {
    const data = bountySchema.parse(fixture("bounty-hunting.json"));
    expect(data.recent).toHaveLength(2);
    expect(data.summary.kills + data.summary.failures).toBe(data.summary.encounters);
  });

  it("preserves normalized and raw leaderboard score independently", () => {
    const data = leaderboardSchema.parse(fixture("leaderboard.json"));
    expect(data.entries[0].score).toBe(72487);
    expect(data.entries[0].scoreRaw).toBe("7248700");
  });

  it("parses the captured GCW response, keeping the percent share string verbatim", () => {
    const data = leaderboardSchema.parse(fixture("gcw-leaderboard.json"));
    expect(data.id).toBe("GCW_IMPERIAL");
    expect(data.valueType).toBe("PERCENT");
    expect(data.entries[0].scoreRaw.endsWith("%")).toBe(true);
    expect(Number.parseFloat(data.entries[0].scoreRaw)).toBeGreaterThan(0);
    expect(Number.isFinite(data.entries[0].score)).toBe(true);
  });

  it("parses the captured Officers' Salute response across officer and enlisted ranks", () => {
    const data = officersSchema.parse(fixture("gcw-officers.json"));
    expect(data.faction).toBe("REBEL");
    expect(data.officers.some((officer) => officer.rankIndex >= 7)).toBe(true);
    expect(data.officers.some((officer) => officer.rankIndex < 7)).toBe(true);
    expect(data.officers[0].currentGcwPoints).toBeGreaterThanOrEqual(0);
  });

  it("rejects duplicate officer identities", () => {
    const officers = fixture("gcw-officers.json");
    officers.officers[1] = { ...officers.officers[0] };
    expect(() => officersSchema.parse(officers)).toThrow();
  });

  it("rejects score strings that are neither decimal nor percent", () => {
    const gcw = fixture("gcw-leaderboard.json");
    gcw.entries[0].scoreRaw = "7.85%%";
    expect(() => leaderboardSchema.parse(gcw)).toThrow();
  });

  it("accepts explicit timezone offsets without substituting collection time", () => {
    const bounty = fixture("bounty-hunting.json");
    bounty.recent[0].timestamp = "2026-08-11T20:59:22.000-04:00";
    const parsed = bountySchema.parse(bounty);
    expect(new Date(parsed.recent[0].timestamp).toISOString()).toBe("2026-08-12T00:59:22.000Z");
  });

  it("accepts tied ranks, but rejects duplicate identities and impossible bounty totals", () => {
    const leaderboard = fixture("leaderboard.json");
    leaderboard.entries[1].rank = leaderboard.entries[0].rank;
    expect(leaderboardSchema.parse(leaderboard).entries[1].rank).toBe(1);
    leaderboard.entries[1].participantId = leaderboard.entries[0].participantId;
    expect(() => leaderboardSchema.parse(leaderboard)).toThrow(/Duplicate participant/);
    const bounty = fixture("bounty-hunting.json");
    bounty.summary.encounters += 1;
    expect(() => bountySchema.parse(bounty)).toThrow(/Kills plus failures/);
  });
});
