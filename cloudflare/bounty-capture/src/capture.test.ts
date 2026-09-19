import { describe, expect, it } from "vitest";
import {
  EMPTY_ALERT_STATE, MIN_CAPTURE_GAP_SECONDS, captureKey, captureTimeFromKey, decideStandbyCapture, looksLikeBountyPayload, nextAlertState, parseDate, sha256Hex, tokenMatches,
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

describe("nextAlertState", () => {
  const healthy = { capture: false as const, reason: "primary_healthy" as const };
  const stale = { capture: true as const, reason: "primary_stale" as const };
  const waiting = { capture: false as const, reason: "captured_recently" as const };
  const stored = { stored: true, key: "captures/x.json", reason: "stored" };

  it("announces a takeover once and recovery once, counting captures in between", () => {
    const takeover = nextAlertState({ state: EMPTY_ALERT_STATE, decision: stale, outcome: stored, heartbeatAt: secondsAgo(400), now });
    expect(takeover.messages.map((m) => m.title)).toEqual(["Jawa Tracks collector is silent — standby capturing"]);
    expect(takeover.state.takeoverAt).toBe(now.toISOString());
    expect(takeover.state.capturesDuringTakeover).toBe(1);

    const quiet = nextAlertState({ state: takeover.state, decision: waiting, outcome: null, heartbeatAt: secondsAgo(460), now: new Date(now.getTime() + 60_000) });
    expect(quiet.messages).toEqual([]);

    const again = nextAlertState({ state: quiet.state, decision: stale, outcome: stored, heartbeatAt: secondsAgo(700), now: new Date(now.getTime() + 300_000) });
    expect(again.messages).toEqual([]);
    expect(again.state.capturesDuringTakeover).toBe(2);

    const back = nextAlertState({ state: again.state, decision: healthy, outcome: null, heartbeatAt: new Date(now.getTime() + 600_000), now: new Date(now.getTime() + 600_000) });
    expect(back.messages.map((m) => m.title)).toEqual(["Jawa Tracks collector is back"]);
    expect(back.messages[0].description).toContain(`--since ${now.toISOString()}`);
    expect(back.messages[0].description).toContain("2 capture(s)");
    expect(back.state).toEqual(EMPTY_ALERT_STATE);
  });

  it("stays quiet while healthy and never alerts on unchanged payloads", () => {
    expect(nextAlertState({ state: EMPTY_ALERT_STATE, decision: healthy, outcome: null, heartbeatAt: secondsAgo(10), now }).messages).toEqual([]);
    const during = { ...EMPTY_ALERT_STATE, takeoverAt: secondsAgo(900).toISOString() };
    expect(nextAlertState({ state: during, decision: stale, outcome: { stored: false, key: null, reason: "unchanged" }, heartbeatAt: secondsAgo(1000), now }).messages).toEqual([]);
  });

  it("reports failing captures at most once an hour during a takeover", () => {
    const during = { ...EMPTY_ALERT_STATE, takeoverAt: secondsAgo(900).toISOString() };
    const failing = { stored: false, key: null, reason: "http_403" };
    const first = nextAlertState({ state: during, decision: stale, outcome: failing, heartbeatAt: secondsAgo(1000), now });
    expect(first.messages.map((m) => m.title)).toEqual(["Standby capture is failing"]);
    const soon = nextAlertState({ state: first.state, decision: stale, outcome: failing, heartbeatAt: secondsAgo(1300), now: new Date(now.getTime() + 300_000) });
    expect(soon.messages).toEqual([]);
    const later = nextAlertState({ state: soon.state, decision: stale, outcome: failing, heartbeatAt: secondsAgo(5000), now: new Date(now.getTime() + 3_700_000) });
    expect(later.messages).toHaveLength(1);
  });
});
