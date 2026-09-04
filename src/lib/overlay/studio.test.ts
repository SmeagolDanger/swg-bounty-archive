import { describe, expect, it } from "vitest";
import { overlayImageHref, overlayPageHref, type StudioState } from "./studio";

const base: StudioState = { name: "Polarix", period: "recent" };

describe("overlay studio URLs", () => {
  it("keeps defaults out of the query string", () => {
    expect(overlayPageHref(base)).toBe("/overlay?name=Polarix");
    expect(overlayImageHref(base)).toBe("/api/overlay/image?name=Polarix");
  });
  it("carries period, rows, title, avatar, and scale", () => {
    const state: StudioState = { name: "Polarix", period: "cycle", rows: 150, title: " Cycle report ", avatar: "https://a/b.png", scale: 0.8 };
    expect(overlayPageHref(state)).toBe("/overlay?name=Polarix&period=cycle&rows=100&title=Cycle+report&avatar=https%3A%2F%2Fa%2Fb.png&scale=0.8");
    expect(overlayImageHref(state)).toBe("/api/overlay/image?name=Polarix&period=cycle&rows=100&title=Cycle+report&avatar=https%3A%2F%2Fa%2Fb.png&scale=0.8");
  });
  it("adds the timezone only for the today boundary", () => {
    expect(overlayPageHref({ name: "x", period: "today", tz: "America/Halifax" })).toBe("/overlay?name=x&period=today&tz=America%2FHalifax");
    expect(overlayPageHref({ name: "x", period: "cycle", tz: "America/Halifax" })).toBe("/overlay?name=x&period=cycle");
  });
  it("adds refresh to the page URL only, when it differs from the default", () => {
    expect(overlayPageHref({ ...base, refresh: 60 })).toBe("/overlay?name=Polarix&refresh=60");
    expect(overlayPageHref({ ...base, refresh: 30 })).toBe("/overlay?name=Polarix");
    expect(overlayImageHref({ ...base, refresh: 60 })).toBe("/api/overlay/image?name=Polarix");
  });
  it("trims blanks so empty fields disappear", () => {
    expect(overlayPageHref({ name: " Polarix ", period: "recent", title: "  ", avatar: "", tz: " " })).toBe("/overlay?name=Polarix");
  });
});
