import { describe, expect, it } from "vitest";
import { clampOverlayParams, overlayCacheKey, overlayPageUrl } from "./render";

describe("overlay image parameters", () => {
  it("clamps rows and scale, defaults the period, and trims the rest", () => {
    expect(clampOverlayParams({ name: "  ChickenRat  ", rows: 99, scale: 9 })).toEqual({ name: "ChickenRat", period: "recent", rows: 20, title: undefined, avatar: undefined, scale: 3 });
    expect(clampOverlayParams({ name: "x", rows: 0, scale: 0.1 })).toEqual({ name: "x", period: "recent", rows: 4, title: undefined, avatar: undefined, scale: 0.4 });
    expect(clampOverlayParams({ name: "x", period: "today" }).period).toBe("today");
    expect(clampOverlayParams({ name: "x", period: "bogus" }).period).toBe("recent");
    expect(clampOverlayParams({ name: "x" }).rows).toBeUndefined();
  });
  it("builds the page URL with only the provided options", () => {
    expect(overlayPageUrl("http://127.0.0.1:3000/", clampOverlayParams({ name: "Chicken Rat", rows: 4 })))
      .toBe("http://127.0.0.1:3000/overlay?name=Chicken+Rat&rows=4");
    expect(overlayPageUrl("http://web:3000", clampOverlayParams({ name: "x", period: "cycle", title: "Bounties", avatar: "https://a/b.png" })))
      .toBe("http://web:3000/overlay?name=x&period=cycle&title=Bounties&avatar=https%3A%2F%2Fa%2Fb.png");
  });
  it("keys the cache by every parameter", () => {
    const a = overlayCacheKey(clampOverlayParams({ name: "x", rows: 4 }));
    expect(a).toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 4 })));
    expect(a).not.toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 5 })));
    expect(a).not.toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 4, period: "today" })));
  });
});
