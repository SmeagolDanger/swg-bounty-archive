import { describe, expect, it } from "vitest";
import {
  age, ansiBlock, boardLine, currentBoardRanks, feedEmbed, feedTableRow, fit, hunterDossierEmbed, hunterLiteEmbed, perspectiveRow, ratioBar, rivalryRow, statCard, stripAnsi,
  type DossierData, type FeedRow,
} from "./embeds";

const site = "https://jawatracks.com";
const now = new Date("2026-08-13T03:00:00Z");
const ESC = String.fromCharCode(27);
const kill: FeedRow = { event_at: "2026-08-13T00:10:09Z", outcome: "KILL", hunter_name: "-Eternal-", target_name: "Eahi", credits: 29549 };
const fail: FeedRow = { event_at: "2026-08-13T02:43:00Z", outcome: "FAILED", hunter_name: "Bossk", target_name: "Han_Solo", credits: 0 };

describe("cell formatting", () => {
  it("renders compact fixed ages", () => {
    expect(age("2026-08-13T02:59:40Z", now)).toBe("now");
    expect(age("2026-08-13T02:43:00Z", now)).toBe("17m");
    expect(age("2026-08-12T14:00:00Z", now)).toBe("13h");
    expect(age("2026-08-10T03:00:00Z", now)).toBe("3d");
  });
  it("truncates with an ellipsis, pads to the column width, and drops fence-breaking characters", () => {
    expect(fit("Kanye's FishSticks", 16)).toBe("Kanye's FishSti…");
    expect(fit("Eahi", 8)).toBe("Eahi    ");
    expect(fit(`bad\`tick${ESC}`, 8)).toBe("badtick ");
  });
  it("splits the ratio bar by wins and losses", () => {
    expect(stripAnsi(ratioBar(3, 1))).toBe("██████████");
    expect(ratioBar(3, 1)).toContain(`${ESC}[32m████████${ESC}[31m██`);
    expect(stripAnsi(ratioBar(0, 0))).toBe("··········");
  });
});

describe("table rows", () => {
  it("aligns claims and failures into the same columns", () => {
    const a = stripAnsi(feedTableRow(kill, now));
    const b = stripAnsi(feedTableRow(fail, now));
    expect(a).toBe("  3h ◆ -Eternal-        ▸ Eahi                29,549");
    expect(b).toBe(" 17m ◇ Bossk            ▸ Han_Solo                 —");
    expect(a.length).toBe(b.length);
    expect(a.length).toBeLessThanOrEqual(56);
  });
  it("describes encounters from one hunter's perspective", () => {
    expect(stripAnsi(perspectiveRow(kill, "-Eternal-", now))).toBe("  3h ◆ claimed   Eahi                    29,549");
    expect(stripAnsi(perspectiveRow(kill, "eahi", now))).toBe("  3h ◇ slain by  -Eternal-               29,549");
    expect(stripAnsi(perspectiveRow(fail, "Bossk", now))).toBe(" 17m ◇ failed    Han_Solo                     —");
    expect(stripAnsi(perspectiveRow(fail, "Han_Solo", now))).toBe(" 17m ◆ survived  Bossk                        —");
  });
  it("formats rivalry rows with a bar and optional revenge tally", () => {
    expect(stripAnsi(rivalryRow({ opponent: "Han_Solo", encounters: 4, wins: 1, losses: 3, revenge_kills: 1 }))).toBe("Han_Solo           ██████████  1W  3L  ↩ 1 revenge");
    expect(stripAnsi(rivalryRow({ opponent: "Chewie", encounters: 2, wins: 2, losses: 0, revenge_kills: 0 }))).toBe("Chewie             ██████████  2W  0L");
  });
});

describe("ansi block", () => {
  it("fences rows and trims to the character budget with a remainder note", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `row ${i}`.padEnd(40));
    const block = ansiBlock(rows, 500);
    expect(block.startsWith("```ansi\n")).toBe(true);
    expect(block.endsWith("\n```")).toBe(true);
    expect(block.length).toBeLessThanOrEqual(500);
    expect(stripAnsi(block)).toMatch(/… \d+ more\n```$/);
  });
});

describe("feed embed", () => {
  it("has a header, stat strip, aligned table, and a filtered archive link", () => {
    const embed = feedEmbed([fail, kill], { filters: { q: "Bossk", outcome: "KILL", minCredits: 5000 }, total: 2824, siteUrl: site, now });
    expect(embed.author?.name).toBe("Outer Rim Ledger · Bounty feed");
    expect(embed.title).toBe("Latest 2 encounters · “Bossk” · claims only · ≥ 5,000 cr");
    expect(embed.url).toBe(`${site}/encounters?q=Bossk&outcome=KILL&minCredits=5000`);
    expect(embed.description).toContain("🎯 **1** claim  ·  💨 **1** failure  ·  💰 **29,549 cr** paid  ·  ⏱ last **3h**");
    expect(stripAnsi(embed.description!)).toContain(" age   hunter           ▸ target              credits\n 17m ◇ Bossk");
    expect(embed.footer?.text).toBe("2,824 encounters archived · Outer Rim Ledger · data from SWG Legends");
    expect(embed.timestamp).toBe("2026-08-13T02:43:00.000Z");
  });
  it("explains an empty result without a table", () => {
    const embed = feedEmbed([], { siteUrl: site, now });
    expect(embed.description).toBe("No archived encounters match those filters.");
    expect(embed.url).toBe(`${site}/encounters`);
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
const cycleNow = new Date("2026-08-18T00:00:00Z");

describe("boards", () => {
  it("keeps the newest observation per bounty board for unfinished periods only", () => {
    expect(currentBoardRanks(dossier.history, cycleNow)).toEqual([{ board: "Ground Value", rank: 3 }]);
  });
  it("awards medals to podium ranks", () => {
    expect(boardLine([{ board: "Space Value", rank: 2 }, { board: "Total Kills", rank: 7 }])).toBe("🥈 **#2** Space Value   ▪ **#7** Total Kills");
  });
});

describe("stat card", () => {
  it("lays out claim rate, payout, activity, and hunted rows", () => {
    const rows = statCard(dossier.hunterSummary, dossier.targetSummary).map(stripAnsi);
    expect(rows[0]).toBe("CLAIM RATE   70%  ████████████████████  7W 3L");
    expect(rows[1]).toBe("COLLECTED   250,000 cr  avg 35,714 · best 90,000");
    expect(rows[2]).toBe("ACTIVITY    6 targets  4 active days  10 contracts");
    expect(rows[3]).toBe("HUNTED        5×  ████████████████████  4 alive 1 slain");
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(56);
  });
  it("says so when a hunter has never taken a contract", () => {
    expect(statCard({ ...dossier.hunterSummary!, encounters: 0 }, null).map(stripAnsi)).toEqual(["CLAIM RATE  no hunter-role contracts archived"]);
  });
});

describe("hunter dossier embed", () => {
  const embed = hunterDossierEmbed(dossier, { siteUrl: site, now: cycleNow });
  const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value ?? "";

  it("headers with the archive brand and links the dossier page", () => {
    expect(embed.author?.name).toBe("Outer Rim Ledger · Hunter dossier");
    expect(embed.title).toBe("Bossk");
    expect(embed.url).toBe(`${site}/hunter/${dossier.participant.id}`);
  });
  it("puts identity and the stat card in the description", () => {
    expect(embed.description).toContain("⟨ **TRAN** ⟩   🏙 Mos Eisley   🪐 Tatooine   📅 since 2026-06-01\n```ansi\n");
    expect(stripAnsi(embed.description!)).toContain("CLAIM RATE   70%");
  });
  it("renders boards, repeat rivalries only, and perspective-aware recents", () => {
    expect(field("Current cycle boards")).toBe("🥉 **#3** Ground Value");
    expect(stripAnsi(field("Rivalry files"))).toBe("```ansi\nHan_Solo           ██████████  1W  3L  ↩ 1 revenge\n```");
    expect(stripAnsi(field("Recent encounters"))).toContain("◇ failed    Han_Solo");
  });
  it("footer carries the last active date", () => {
    expect(embed.footer?.text).toBe("Last active 2026-08-19 · Outer Rim Ledger · data from SWG Legends");
  });
  it("omits empty sections", () => {
    const quiet = hunterDossierEmbed({ ...dossier, history: [], rivalries: [], encounters: [] }, { siteUrl: site, now: cycleNow });
    expect(quiet.fields).toEqual([]);
  });
});

describe("lite dossier", () => {
  it("derives the record from encounter hunter_stats", () => {
    const stats = { cycle_starts_at: null, cycle_ends_at: null, cycle_encounters: 2, cycle_kills: 2, cycle_deaths: 0, cycle_failures: 0, cycle_credits: 45082, overall_encounters: 3, overall_kills: 3, overall_deaths: 1, overall_failures: 0, overall_credits: 68025 };
    const embed = hunterLiteEmbed("-Eternal-", [{ ...kill, hunter_stats: stats }], { siteUrl: site, now });
    expect(embed.title).toBe("-Eternal-");
    expect(embed.url).toBe(`${site}/encounters?q=-Eternal-`);
    expect(stripAnsi(embed.description!)).toContain("ARCHIVE     ████████████████████  3W 0L  1 deaths");
    expect(stripAnsi(embed.description!)).toContain("THIS CYCLE  2W 0L  45,082 cr");
    expect(stripAnsi(embed.fields![0].value)).toContain("◆ claimed   Eahi");
  });
});
