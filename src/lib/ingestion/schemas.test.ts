import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bountySchema, leaderboardSchema } from "./schemas";

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
