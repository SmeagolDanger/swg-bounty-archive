import { describe, expect, it } from "vitest";
import { decideWeeklyPost } from "./weekly-post";

describe("weekly Discord post decision", () => {
  const current = { starts_at: "2026-08-15T22:00:05Z", ends_at: "2026-08-22T22:00:00Z" };
  const previous = { starts_at: "2026-08-08T22:00:05Z", ends_at: "2026-08-15T22:00:00Z" };

  it("posts the just-finished cycle once the reset has settled", () => {
    const decision = decideWeeklyPost({
      now: new Date("2026-08-15T22:45:00Z"),
      cycles: [current, previous],
      alreadyPosted: new Set(),
    });
    expect(decision.post).toBe(true);
    expect(decision.cycleStart?.toISOString()).toBe(new Date(previous.starts_at).toISOString());
  });

  it("waits out the settle window right after reset", () => {
    const decision = decideWeeklyPost({
      now: new Date("2026-08-15T22:10:00Z"),
      cycles: [current, previous],
      alreadyPosted: new Set(),
    });
    expect(decision).toMatchObject({ post: false, reason: "reset_settling" });
  });

  it("never reposts a cycle", () => {
    const decision = decideWeeklyPost({
      now: new Date("2026-08-16T10:00:00Z"),
      cycles: [current, previous],
      alreadyPosted: new Set([new Date(previous.starts_at).toISOString()]),
    });
    expect(decision).toMatchObject({ post: false, reason: "already_posted" });
  });

  it("skips ancient cycles when the feature is first enabled", () => {
    const decision = decideWeeklyPost({
      now: new Date("2026-09-30T00:00:00Z"),
      cycles: [current, previous],
      alreadyPosted: new Set(),
    });
    expect(decision).toMatchObject({ post: false, reason: "cycle_too_old" });
  });

  it("needs at least two known cycles", () => {
    const decision = decideWeeklyPost({
      now: new Date("2026-08-16T10:00:00Z"),
      cycles: [current],
      alreadyPosted: new Set(),
    });
    expect(decision).toMatchObject({ post: false, reason: "not_enough_cycles" });
  });
});
