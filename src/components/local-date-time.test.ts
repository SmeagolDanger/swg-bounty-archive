import { describe, expect, it } from "vitest";
import { formatZonedDateTime } from "./local-date-time";

describe("local date/time formatting", () => {
  const instant = "2026-08-13T01:30:00.000Z";

  it("formats the same instant in the requested user timezone", () => {
    expect(formatZonedDateTime(instant, "dateTime", "America/Halifax")).toContain("Aug 12, 2026");
    expect(formatZonedDateTime(instant, "dateTime", "Europe/London")).toContain("Aug 13, 2026");
  });

  it("joins date and time with a fixed separator so server and browser ICU agree", () => {
    expect(formatZonedDateTime(instant, "dateTime", "UTC")).toBe("Aug 13, 2026, 01:30 AM UTC");
    expect(formatZonedDateTime(instant, "compact", "UTC")).toBe("Aug 13, 01:30 AM UTC");
  });

  it("uses the requested timezone for date-only calendar boundaries", () => {
    expect(formatZonedDateTime(instant, "date", "America/Halifax")).toBe("Aug 12, 2026");
    expect(formatZonedDateTime(instant, "date", "Europe/London")).toBe("Aug 13, 2026");
  });
});
