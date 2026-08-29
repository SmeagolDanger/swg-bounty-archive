import { describe, expect, it } from "vitest";
import { clamp, currentBoardRanks, encounterLine, feedEmbed, hunterDossierEmbed, hunterLiteEmbed, type DossierData, type FeedRow } from "./embeds";

const site = "https://jawatracks.com";
const kill: FeedRow = { event_at: "2026-08-13T00:10:09Z", outcome: "KILL", hunter_name: "-Eternal-", target_name: "Eahi", credits: 29549 };
const fail: FeedRow = { event_at: "2026-08-13T01:00:00Z", outcome: "FAILED", hunter_name: "Bossk", target_name: "Han_Solo", credits: 0 };

describe("encounter lines", () => {
  it("renders claims with payout and a Discord relative timestamp", () => {
    const unix = Math.floor(Date.parse(kill.event_at as string) / 1000);
    expect(encounterLine(kill)).toBe(`🎯 **-Eternal-** claimed **Eahi** · 29,549 cr · <t:${unix}:R>`);
  });
  it("renders failures from the hunter's view by default and the target's when asked", () => {
    expect(encounterLine(fail)).toContain("**Bossk** failed against **Han\\_Solo**");
    expect(encounterLine(fail, { perspective: "han_solo" })).toContain("**Han\\_Solo** survived **Bossk**");
  });
});

describe("feed embed", () => {
  it("lists encounters, links the filtered archive page, and summarises filters", () => {
    const embed = feedEmbed([kill, fail], { filters: { q: "Bossk", outcome: "KILL", minCredits: 5000 }, total: 1234, siteUrl: site });
    expect(embed.title).toBe("Bounty feed · latest 2 encounters");
    expect(embed.url).toBe(`${site}/encounters?q=Bossk&outcome=KILL&minCredits=5000`);
    expect(embed.description?.split("\n")).toHaveLength(2);
    expect(embed.footer?.text).toContain("name ~ “Bossk” · claims only · ≥ 5,000 cr · 1,234 archived");
    expect(embed.timestamp).toBe("2026-08-13T00:10:09.000Z");
  });
  it("explains an empty result", () => {
    const embed = feedEmbed([], { siteUrl: site });
    expect(embed.description).toMatch(/No archived encounters/);
    expect(embed.url).toBe(`${site}/encounters`);
  });
});

describe("clamp", () => {
  it("cuts on a line boundary and never exceeds the limit", () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const out = clamp(text, 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("\n")).toBe(false);
  });
});

const dossier: DossierData = {
  participant: { id: "11111111-2222-4333-8444-555555555555", current_name: "Bossk", guild_abbreviation: "TRAN", city_name: "Mos Eisley", planet: "Tatooine", first_seen_at: "2026-06-01T00:00:00Z", last_seen_at: "2026-08-20T00:00:00Z" },
  history: [
    { leaderboard_id: "BOUNTY_HUNTER_GROUND_VALUE", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 3, score: 100 },
    { leaderboard_id: "BOUNTY_HUNTER_GROUND_VALUE", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 5, score: 90 },
    { leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS", starts_at: "2026-08-08T22:00:00Z", ends_at: "2026-08-15T22:00:00Z", rank: 1, score: 9 },
    { leaderboard_id: "GCW_IMPERIAL", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 2, score: 1 },
  ],
  encounters: [fail, kill],
  rivalries: [
    { opponent: "Han_Solo", encounters: 4, wins: 1, losses: 3, revenge_kills: 1 },
    { opponent: "Chewie", encounters: 1, wins: 1, losses: 0, revenge_kills: 0 },
  ],
  hunterSummary: { encounters: 10, wins: 7, losses: 3, win_rate: 0.7, credits: 250000, average_bounty: 35714, highest_bounty: 90000, unique_targets: 6, active_days: 4, first_active_at: "2026-07-01T00:00:00Z", last_active_at: "2026-08-19T12:00:00Z" },
  targetSummary: { encounters: 5, survived: 4, killed: 1, survival_rate: 0.8 },
};

describe("current board ranks", () => {
  it("keeps the newest observation per bounty board for unfinished periods only", () => {
    expect(currentBoardRanks(dossier.history, new Date("2026-08-18T00:00:00Z"))).toEqual([{ board: "Ground Value", rank: 3 }]);
  });
});

describe("hunter dossier embed", () => {
  const embed = hunterDossierEmbed(dossier, { siteUrl: site, now: new Date("2026-08-18T00:00:00Z") });
  const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value ?? "";

  it("links the dossier page and summarises identity", () => {
    expect(embed.title).toBe("Bossk · Hunter dossier");
    expect(embed.url).toBe(`${site}/hunter/${dossier.participant.id}`);
    expect(embed.description).toContain("Guild **TRAN** · City Mos Eisley · Tatooine");
  });
  it("reports hunter and target records", () => {
    expect(field("Hunter record")).toContain("**7W** / **3L** (70% claim rate)");
    expect(field("Hunter record")).toContain("250,000 cr collected");
    expect(field("As target")).toContain("80% survival");
    expect(field("Current cycle boards")).toBe("#3 Ground Value");
  });
  it("shows only repeat rivalries and recent encounters from the hunter's perspective", () => {
    expect(field("Rivalry files")).toBe("**Han\\_Solo** — 1W 3L · 1 revenge");
    expect(field("Recent encounters")).toContain("failed against");
  });
  it("footer carries the last active date", () => {
    expect(embed.footer?.text).toContain("Last active 2026-08-19");
  });
  it("copes with a hunter who has never claimed", () => {
    const quiet = hunterDossierEmbed({ ...dossier, hunterSummary: { ...dossier.hunterSummary!, encounters: 0 }, targetSummary: null, rivalries: [], encounters: [] }, { siteUrl: site });
    expect(quiet.fields?.map((f) => f.name)).toEqual(["Hunter record"]);
    expect(quiet.fields?.[0].value).toMatch(/No hunter-role encounters/);
  });
});

describe("lite dossier", () => {
  it("derives the record from encounter hunter_stats", () => {
    const stats = { cycle_starts_at: null, cycle_ends_at: null, cycle_encounters: 2, cycle_kills: 2, cycle_deaths: 0, cycle_failures: 0, cycle_credits: 45082, overall_encounters: 3, overall_kills: 3, overall_deaths: 1, overall_failures: 0, overall_credits: 68025 };
    const embed = hunterLiteEmbed("-Eternal-", [{ ...kill, hunter_stats: stats }], { siteUrl: site });
    expect(embed.url).toBe(`${site}/encounters?q=-Eternal-`);
    expect(embed.fields?.[0].value).toContain("**3W** / 0L as hunter");
    expect(embed.fields?.[1].value).toContain("45,082 cr");
  });
});
