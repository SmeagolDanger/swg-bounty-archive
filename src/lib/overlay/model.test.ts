import { describe, expect, it } from "vitest";
import { formatCredits, overlayRows, overlayStats, relativeAge, resultFor, type OverlayDossier } from "./model";

const now = new Date("2026-09-03T18:00:00");
const at = (iso: string) => new Date(iso).toISOString();

const dossier: OverlayDossier = {
  participant: { id: "p1", current_name: "ChickenRat" },
  encounters: [
    { id: "a", event_at: at("2026-09-03T17:53:00"), outcome: "KILL", hunter_name: "ChickenRat", target_name: "Mahi", credits: 125000,
      hunter_stats: { cycle_encounters: 12, cycle_kills: 7, cycle_credits: 900000 } },
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
  it("counts today's claims (hunter role, local day), cycle contracts, and best payout", () => {
    expect(overlayStats(dossier, now)).toEqual({ todayClaimed: 2, cycleContracts: 12, bestPayout: "190,000" });
  });
  it("degrades gracefully without stats or summary", () => {
    const bare: OverlayDossier = { participant: { id: "x", current_name: "Nobody" }, encounters: [], hunterSummary: null };
    expect(overlayStats(bare, now)).toEqual({ todayClaimed: 0, cycleContracts: null, bestPayout: null });
  });
});

describe("credits formatting", () => {
  it("formats thousands and hides zero", () => {
    expect(formatCredits(125000)).toBe("125,000");
    expect(formatCredits(0)).toBeNull();
    expect(formatCredits(null)).toBeNull();
  });
});
