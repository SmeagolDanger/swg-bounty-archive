import { describe, expect, it } from "vitest";
import { dayKey, formatCredits, overlayRows, overlayStats, overlayView, relativeAge, resultFor, type OverlayDossier } from "./model";

const now = new Date("2026-09-03T18:00:00");
const at = (iso: string) => new Date(iso).toISOString();

const dossier: OverlayDossier = {
  participant: { id: "p1", current_name: "ChickenRat" },
  encounters: [
    { id: "a", event_at: at("2026-09-03T17:53:00"), outcome: "KILL", hunter_name: "ChickenRat", target_name: "Mahi", credits: 125000,
      hunter_stats: { cycle_starts_at: at("2026-09-02T00:00:00"), cycle_ends_at: at("2026-09-09T00:00:00"), cycle_encounters: 12, cycle_kills: 7, cycle_credits: 900000 } },
    { id: "b", event_at: at("2026-09-03T17:38:00"), outcome: "FAILED", hunter_name: "ChickenRat", target_name: "Dex", credits: 0 },
    { id: "c", event_at: at("2026-09-03T17:26:00"), outcome: "KILL", hunter_name: "chickenrat", target_name: "Avolo", credits: 190000 },
    { id: "d", event_at: at("2026-09-03T17:00:00"), outcome: "FAILED", hunter_name: "Serverside", target_name: "ChickenRat", credits: 96000 },
    { id: "e", event_at: at("2026-09-01T12:00:00"), outcome: "KILL", hunter_name: "Bossk", target_name: "ChickenRat", credits: 50000 },
  ],
  hunterSummary: { wins: 3, losses: 1, credits: 315000, highest_bounty: 190000 },
};

describe("relative age", () => {
  it("scales from just now to days", () => {
    expect(relativeAge(at("2026-09-03T17:59:30"), now)).toBe("just now");
    expect(relativeAge(at("2026-09-03T17:53:00"), now)).toBe("7m ago");
    expect(relativeAge(at("2026-09-03T16:58:00"), now)).toBe("1h ago");
    expect(relativeAge(at("2026-09-01T18:00:00"), now)).toBe("2d ago");
  });
});

describe("perspective mapping", () => {
  it("labels all four outcomes from the streamer's point of view", () => {
    expect(resultFor(dossier.encounters[0], "ChickenRat")).toEqual({ result: "CLAIMED", opponent: "Mahi" });
    expect(resultFor(dossier.encounters[1], "ChickenRat")).toEqual({ result: "FAILED", opponent: "Dex" });
    expect(resultFor(dossier.encounters[3], "ChickenRat")).toEqual({ result: "ESCAPED", opponent: "Serverside" });
    expect(resultFor(dossier.encounters[4], "ChickenRat")).toEqual({ result: "SLAIN", opponent: "Bossk" });
  });
});

describe("rows", () => {
  it("maps encounters to display rows with payouts only when credits were paid", () => {
    const rows = overlayRows(dossier, 4, now);
    expect(rows.map((r) => [r.target, r.result, r.payout, r.time])).toEqual([
      ["Mahi", "CLAIMED", "125,000", "7m ago"],
      ["Dex", "FAILED", null, "22m ago"],
      ["Avolo", "CLAIMED", "190,000", "34m ago"],
      ["Serverside", "ESCAPED", "96,000", "1h ago"],
    ]);
  });
  it("clamps the row count to 1–10", () => {
    expect(overlayRows(dossier, 0, now)).toHaveLength(1);
    expect(overlayRows(dossier, 99, now)).toHaveLength(5);
  });
});

describe("footer stats", () => {
  it("counts today's claims, cycle contracts, the best claim of this cycle, and the record", () => {
    expect(overlayStats(dossier, now)).toEqual({ todayClaimed: 2, cycleContracts: 12, cycleBest: "190,000", recordBest: "190,000" });
  });
  it("keeps pre-cycle claims out of the cycle best", () => {
    const early = { ...dossier, encounters: [dossier.encounters[0], { ...dossier.encounters[2], event_at: at("2026-09-01T12:00:00") }] };
    expect(overlayStats(early, now).cycleBest).toBe("125,000");
  });
  it("degrades gracefully without stats or summary", () => {
    const bare: OverlayDossier = { participant: { id: "x", current_name: "Nobody" }, encounters: [], hunterSummary: null };
    expect(overlayStats(bare, now)).toEqual({ todayClaimed: 0, cycleContracts: null, cycleBest: null, recordBest: null });
  });
});

describe("credits formatting", () => {
  it("formats thousands and hides zero", () => {
    expect(formatCredits(125000)).toBe("125,000");
    expect(formatCredits(0)).toBeNull();
    expect(formatCredits(null)).toBeNull();
  });
});

describe("period views", () => {
  it("recent keeps the rolling rows and the summary tiles", () => {
    const view = overlayView(dossier, "recent", 4, now);
    expect(view.rows.map((r) => r.target)).toEqual(["Mahi", "Dex", "Avolo", "Serverside"]);
    expect(view.omitted).toBe(0);
    expect(view.tiles.map((t) => [t.label, t.value])).toEqual([
      ["Today", "2 claimed"], ["Contracts", "12"], ["Cycle best", "190,000 cr"], ["Record", "190,000 cr"],
    ]);
  });
  it("today shows the whole local day by default, with day totals", () => {
    const view = overlayView(dossier, "today", undefined, now);
    expect(view.rows).toHaveLength(4);
    expect(view.omitted).toBe(0);
    expect(view.tiles.map((t) => [t.label, t.value])).toEqual([
      ["Claimed", "2"], ["Failed", "1"], ["Credits", "315,000 cr"], ["Best", "190,000 cr"],
    ]);
  });
  it("cycle shows the whole leaderboard window with the archived cycle stats", () => {
    const view = overlayView(dossier, "cycle", undefined, now);
    expect(view.rows).toHaveLength(4);
    expect(view.tiles.map((t) => [t.label, t.value])).toEqual([
      ["Contracts", "12"], ["Claimed", "7"], ["Credits", "900,000 cr"], ["Cycle best", "190,000 cr"],
    ]);
  });
  it("reports a remainder only when an explicit limit cuts a bounded window", () => {
    const limited = overlayView(dossier, "today", 2, now);
    expect(limited.rows).toHaveLength(2);
    expect(limited.omitted).toBe(2);
    expect(overlayView(dossier, "recent", 2, now).omitted).toBe(0);
  });
  it("today explains an empty day", () => {
    const view = overlayView({ ...dossier, encounters: [dossier.encounters[4]] }, "today", 10, now);
    expect(view.rows).toHaveLength(0);
    expect(view.emptyNote).toMatch(/No contracts today/);
  });
});

describe("timezone-aware today", () => {
  // 01:30 UTC on Sep 4 = 22:30 on Sep 3 in Halifax (UTC-3 in September).
  const lateNow = new Date("2026-09-04T01:30:00Z");
  const tzDossier: OverlayDossier = {
    participant: { id: "p", current_name: "Polarix" },
    encounters: [
      { id: "n", event_at: "2026-09-04T01:00:00.000Z", outcome: "FAILED", hunter_name: "Polarix", target_name: "Saavin", credits: 0 },
      { id: "o", event_at: "2026-09-03T20:00:00.000Z", outcome: "KILL", hunter_name: "Polarix", target_name: "Swagalicious", credits: 65248 },
    ],
    hunterSummary: null,
  };
  it("keys days in the requested zone", () => {
    expect(dayKey(lateNow, "UTC")).toBe("2026-09-04");
    expect(dayKey(lateNow, "America/Halifax")).toBe("2026-09-03");
  });
  it("UTC midnight splits the day the streamer's zone keeps whole", () => {
    expect(overlayView(tzDossier, "today", undefined, lateNow, "UTC").rows).toHaveLength(1);
    const local = overlayView(tzDossier, "today", undefined, lateNow, "America/Halifax");
    expect(local.rows).toHaveLength(2);
    expect(local.tiles.find((t) => t.label === "Claimed")?.value).toBe("1");
  });
});
