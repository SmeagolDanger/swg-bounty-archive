import { describe, expect, it } from "vitest";
import {
  ansiBlock, boardLine, characterLine, currentBoardRanks, feedEmbed, feedTableRow, fit, hunterDossierEmbed, hunterLiteEmbed, kd, kdRow, kdWindows, reputation, stripAnsi,
  type DossierData, type FeedRow,
} from "./embeds";

const site = "https://jawatracks.com";
const now = new Date("2026-08-13T03:00:00Z");
const ESC = String.fromCharCode(27);
const kill: FeedRow = { event_at: "2026-08-13T00:10:09Z", outcome: "KILL", hunter_name: "-Eternal-", target_name: "Eahi", credits: 29549 };
const fail: FeedRow = { event_at: "2026-08-13T02:43:00Z", outcome: "FAILED", hunter_name: "Bossk", target_name: "Han_Solo", credits: 0 };

describe("cell formatting", () => {
  it("truncates with an ellipsis, pads to the column width, and drops fence-breaking characters", () => {
    expect(fit("Kanye's FishSticks", 16)).toBe("Kanye's FishSti…");
    expect(fit("Eahi", 8)).toBe("Eahi    ");
    expect(fit(`bad\`tick${ESC}`, 8)).toBe("badtick ");
  });
  it("quotes K/D the way players do", () => {
    expect(kd(36, 30)).toBe("1.20");
    expect(kd(5, 0)).toBe("∞");
    expect(kd(0, 0)).toBe("—");
  });
  it("colours cells and strips them back out", () => {
    const row = feedTableRow(kill);
    expect(row).toContain(`${ESC}[32mCOLLECTED`);
    expect(stripAnsi(row)).not.toContain(ESC);
  });
});

describe("feed table", () => {
  it("mirrors the site's columns: UTC time, hunter, outcome, target, payout", () => {
    const a = stripAnsi(feedTableRow(kill));
    const b = stripAnsi(feedTableRow(fail));
    expect(a).toBe("00:10  -Eternal-      COLLECTED  Eahi             29,549");
    expect(b).toBe("02:43  Bossk          FAILED     Han_Solo              —");
    expect(a.length).toBe(b.length);
    expect(a.length).toBeLessThanOrEqual(56);
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
  it("has a bounty-board header, themed stat strip, aligned table, and a filtered archive link", () => {
    const embed = feedEmbed([fail, kill], { filters: { q: "Bossk", outcome: "KILL", minCredits: 5000 }, total: 2824, siteUrl: site, now });
    expect(embed.author?.name).toBe("Outer Rim Ledger · Bounty Board");
    expect(embed.title).toBe("📡 Live feed · last 2 contracts · “Bossk” · collected only · ≥ 5,000 cr");
    expect(embed.url).toBe(`${site}/encounters?q=Bossk&outcome=KILL&minCredits=5000`);
    expect(embed.description).toContain("🎯 **1** collected  ·  💨 **1** got away  ·  💰 **29,549 cr** paid out  ·  📅 2026-08-13");
    expect(stripAnsi(embed.description!)).toContain("UTC    HUNTER         OUTCOME    TARGET           PAYOUT\n02:43  Bossk");
    expect(embed.footer?.text).toBe("2,824 contracts archived · Outer Rim Ledger · data from SWG Legends");
    expect(embed.timestamp).toBe("2026-08-13T02:43:00.000Z");
  });
  it("shows a date range when rows span days", () => {
    const embed = feedEmbed([fail, { ...kill, event_at: "2026-08-11T10:00:00Z" }], { siteUrl: site, now });
    expect(embed.description).toContain("📅 2026-08-11 → 2026-08-13");
  });
  it("explains an empty result without a table", () => {
    const embed = feedEmbed([], { siteUrl: site, now });
    expect(embed.description).toBe("The board is quiet — no encounters match those filters.");
    expect(embed.url).toBe(`${site}/encounters`);
  });
});

const stats = { cycle_starts_at: "2026-08-15T22:00:00Z", cycle_ends_at: "2026-08-22T22:00:00Z", cycle_encounters: 4, cycle_kills: 3, cycle_deaths: 1, cycle_failures: 1, cycle_credits: 120000, overall_encounters: 10, overall_kills: 7, overall_deaths: 4, overall_failures: 3, overall_credits: 250000 };
const dossier: DossierData = {
  participant: { id: "11111111-2222-4333-8444-555555555555", current_name: "Bossk", guild_abbreviation: "TRAN", faction: "Imperial", city_name: "Mos Eisley", planet: "Tatooine", first_seen_at: "2026-06-01T00:00:00Z", last_seen_at: "2026-08-20T00:00:00Z" },
  history: [
    { leaderboard_id: "BOUNTY_HUNTER_GROUND_VALUE", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 3, score: 100 },
    { leaderboard_id: "BOUNTY_HUNTER_GROUND_VALUE", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 5, score: 90 },
    { leaderboard_id: "BOUNTY_HUNTER_TOTAL_KILLS", starts_at: "2026-08-08T22:00:00Z", ends_at: "2026-08-15T22:00:00Z", rank: 1, score: 9 },
    { leaderboard_id: "GCW_IMPERIAL", starts_at: "2026-08-15T22:00:00Z", ends_at: "2026-08-22T22:00:00Z", rank: 2, score: 1 },
  ],
  encounters: [{ ...fail, hunter_stats: stats }, { ...kill, target_name: "Bossk", hunter_stats: null }],
  rivalries: [
    { opponent: "Han_Solo", encounters: 4, wins: 1, losses: 3, revenge_kills: 1 },
    { opponent: "Chewie", encounters: 2, wins: 2, losses: 0, revenge_kills: 0 },
  ],
  hunterSummary: { encounters: 10, wins: 7, losses: 3, win_rate: 0.7, credits: 250000, average_bounty: 35714, highest_bounty: 90000, unique_targets: 6, active_days: 4, first_active_at: "2026-07-01T00:00:00Z", last_active_at: "2026-08-19T12:00:00Z" },
  targetSummary: { encounters: 5, survived: 4, killed: 1, survival_rate: 0.8 },
  officerSalute: { faction_name: "Imperial", rank_name: "Colonel", rank_index: 9, profession: "Bounty Hunter" },
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

describe("character and reputation", () => {
  it("builds the character line from salute, guild, and home", () => {
    expect(characterLine(dossier.participant, dossier.officerSalute)).toBe("🛡️ Imperial Colonel   🧬 Bounty Hunter   ⟨ **TRAN** ⟩   🏠 Mos Eisley, Tatooine");
  });
  it("falls back to the participant faction and skips unknown parts", () => {
    expect(characterLine({ id: "x", current_name: "Solo", faction: "Rebel" }, null)).toBe("⚔️ Rebel");
    expect(characterLine({ id: "x", current_name: "Solo" }, null)).toBe("");
  });
  it("grades hunters by K/D once they have a record", () => {
    expect(reputation(2, 1)).toBe("🐣 Fresh contract");
    expect(reputation(9, 3)).toBe("★★★★★ Legend of the Outer Rim");
    expect(reputation(8, 4)).toBe("★★★★ Feared");
    expect(reputation(5, 4)).toBe("★★★ Seasoned");
    expect(reputation(4, 5)).toBe("★★ Scrappy");
    expect(reputation(2, 8)).toBe("★ Bantha fodder");
  });
});

describe("K/D card", () => {
  it("takes the cycle from hunter_stats and totals from the summaries, counting target deaths", () => {
    expect(kdWindows(dossier)).toEqual({
      cycle: { kills: 3, deaths: 1, contracts: 4, credits: 120000 },
      overall: { kills: 7, deaths: 4, contracts: 10, credits: 250000 },
    });
  });
  it("lays out aligned rows", () => {
    expect(stripAnsi(kdRow("THIS CYCLE", { kills: 12, deaths: 4, contracts: 16, credits: 1240000 }))).toBe("THIS CYCLE     12       4   3.00    75%    1,240,000");
    expect(stripAnsi(kdRow("ALL TIME", { kills: 36, deaths: 30, contracts: 65, credits: 9012706 }))).toBe("ALL TIME       36      30   1.20    55%    9,012,706");
    expect(stripAnsi(kdRow("THIS CYCLE", null))).toBe("THIS CYCLE  no contracts observed this cycle");
    expect(stripAnsi(kdRow("THIS CYCLE", { kills: 0, deaths: 0, contracts: 0, credits: 0 }))).toBe("THIS CYCLE  no contracts observed this cycle");
  });
});

describe("hunter dossier embed", () => {
  const embed = hunterDossierEmbed(dossier, { siteUrl: site, now: cycleNow });
  const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value ?? "";

  it("headers as a guild dossier and links the site page", () => {
    expect(embed.author?.name).toBe("Outer Rim Ledger · Guild dossier");
    expect(embed.title).toBe("Bossk");
    expect(embed.url).toBe(`${site}/hunter/${dossier.participant.id}`);
  });
  it("opens with the character line and reputation", () => {
    expect(embed.description).toBe("🛡️ Imperial Colonel   🧬 Bounty Hunter   ⟨ **TRAN** ⟩   🏠 Mos Eisley, Tatooine\n**★★★ Seasoned**");
  });
  it("shows the K/D card, highlights, boards, and a single nemesis", () => {
    expect(embed.fields?.map((f) => f.name)).toEqual(["Kill / Death record", "Highlights", "This week's boards", "Nemesis"]);
    expect(stripAnsi(field("Kill / Death record"))).toContain("THIS CYCLE      3       1   3.00    75%      120,000\nALL TIME        7       4   1.75    70%      250,000");
    expect(field("Highlights")).toBe("🏆 Biggest payday **90,000 cr**\n🎯 **6** unique marks\n🛡️ Hunted **5×**, escaped **80%**");
    expect(field("This week's boards")).toBe("🥉 **#3** Ground Value");
    expect(field("Nemesis")).toBe("☠️ **Han_Solo** — 1W 3L · 1 revenge kill");
  });
  it("footer carries the last contract date", () => {
    expect(embed.footer?.text).toBe("Last contract 2026-08-19 · Outer Rim Ledger · data from SWG Legends");
  });
  it("omits empty sections but always shows the K/D card", () => {
    const quiet = hunterDossierEmbed({ ...dossier, history: [], rivalries: [], encounters: [], hunterSummary: null, targetSummary: null, officerSalute: null }, { siteUrl: site, now: cycleNow });
    expect(quiet.fields?.map((f) => f.name)).toEqual(["Kill / Death record"]);
    expect(quiet.description).toBe("🛡️ Imperial   ⟨ **TRAN** ⟩   🏠 Mos Eisley, Tatooine\n**🐣 Fresh contract**");
    expect(stripAnsi(quiet.fields![0].value)).toContain("ALL TIME    no contracts observed this cycle");
  });
});

describe("lite dossier", () => {
  it("derives the K/D card from encounter hunter_stats", () => {
    const embed = hunterLiteEmbed("-Eternal-", [{ ...kill, hunter_stats: stats }], { siteUrl: site, now });
    expect(embed.title).toBe("-Eternal-");
    expect(embed.url).toBe(`${site}/encounters?q=-Eternal-`);
    expect(embed.description).toBe("📜 Off the boards — known only from the contract log.\n**★★★ Seasoned**");
    expect(stripAnsi(embed.fields![0].value)).toContain("ALL TIME        7       4   1.75    70%      250,000");
  });
});
