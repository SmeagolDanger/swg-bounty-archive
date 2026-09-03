import { describe, expect, it } from "vitest";
import { clampOverlayParams, overlayCacheKey, overlayPageUrl } from "./render";

describe("overlay image parameters", () => {
  it("clamps rows and scale and trims the rest", () => {
    expect(clampOverlayParams({ name: "  ChickenRat  ", rows: 99, scale: 9 })).toEqual({ name: "ChickenRat", rows: 10, title: undefined, avatar: undefined, scale: 3 });
    expect(clampOverlayParams({ name: "x", rows: 0, scale: 0.1 })).toEqual({ name: "x", rows: 4, title: undefined, avatar: undefined, scale: 0.4 });
  });
  it("builds the page URL with only the provided options", () => {
    expect(overlayPageUrl("http://127.0.0.1:3000/", clampOverlayParams({ name: "Chicken Rat", rows: 4 })))
      .toBe("http://127.0.0.1:3000/overlay?name=Chicken+Rat&rows=4");
    expect(overlayPageUrl("http://web:3000", clampOverlayParams({ name: "x", title: "Bounties", avatar: "https://a/b.png" })))
      .toBe("http://web:3000/overlay?name=x&rows=4&title=Bounties&avatar=https%3A%2F%2Fa%2Fb.png");
  });
  it("keys the cache by every parameter", () => {
    const a = overlayCacheKey(clampOverlayParams({ name: "x", rows: 4 }));
    expect(a).toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 4 })));
    expect(a).not.toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 5 })));
    expect(a).not.toBe(overlayCacheKey(clampOverlayParams({ name: "x", rows: 4, scale: 2 })));
  });
});
