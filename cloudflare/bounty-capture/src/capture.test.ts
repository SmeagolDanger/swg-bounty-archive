import { describe, expect, it } from "vitest";
import {
  MIN_CAPTURE_GAP_SECONDS, captureKey, captureTimeFromKey, decideStandbyCapture, looksLikeBountyPayload, parseDate, sha256Hex, tokenMatches,
} from "./capture";

const now = new Date("2026-09-18T20:10:00.000Z");
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("decideStandbyCapture", () => {
  it("stays idle while the primary's heartbeat is fresh", () => {
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(200), lastCheckedAt: null })).toEqual({ capture: false, reason: "primary_healthy" });
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(360), lastCheckedAt: null })).toEqual({ capture: false, reason: "primary_healthy" });
  });

  it("takes over once the heartbeat is stale, on the primary's cadence", () => {
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(361), lastCheckedAt: null })).toEqual({ capture: true, reason: "primary_stale" });
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(3600), lastCheckedAt: secondsAgo(MIN_CAPTURE_GAP_SECONDS - 1) })).toEqual({ capture: false, reason: "captured_recently" });
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(3600), lastCheckedAt: secondsAgo(MIN_CAPTURE_GAP_SECONDS) })).toEqual({ capture: true, reason: "primary_stale" });
  });

  it("captures when it has never heard from the primary", () => {
    expect(decideStandbyCapture({ now, heartbeatAt: null, lastCheckedAt: null })).toEqual({ capture: true, reason: "primary_never_seen" });
  });

  it("honours a configured staleness threshold", () => {
    expect(decideStandbyCapture({ now, heartbeatAt: secondsAgo(100), lastCheckedAt: null, staleAfterSeconds: 60 })).toEqual({ capture: true, reason: "primary_stale" });
  });
});

describe("capture keys", () => {
  it("round-trips the capture time and sorts chronologically", () => {
    const key = captureKey(now, "1a2b3c4d5e6f");
    expect(key).toBe("captures/2026-09-18T20-10-00.000Z-1a2b3c4d.json");
    expect(captureTimeFromKey(key)?.toISOString()).toBe(now.toISOString());
    const later = captureKey(new Date(now.getTime() + 1), "00000000");
    expect([later, key].sort()).toEqual([key, later]);
  });

  it("rejects keys that are not captures", () => {
    expect(captureTimeFromKey("state/latest.json")).toBeNull();
    expect(captureTimeFromKey("captures/../state/heartbeat.json")).toBeNull();
  });
});

describe("helpers", () => {
  it("parses optional ISO dates", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("nope")).toBe("invalid");
    expect((parseDate("2026-09-18T00:00:00Z") as Date).toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  it("hashes deterministically", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compares tokens safely", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secret ", "secret")).toBe(false);
    expect(tokenMatches(null, "secret")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });

  it("recognises the bounty feed shape", () => {
    expect(looksLikeBountyPayload({ recent: [], fetchedAt: "x" })).toBe(true);
    expect(looksLikeBountyPayload({ boards: [] })).toBe(false);
    expect(looksLikeBountyPayload(null)).toBe(false);
  });
});
