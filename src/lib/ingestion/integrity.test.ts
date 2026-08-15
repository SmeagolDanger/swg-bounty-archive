import { describe, expect, it } from "vitest";
import { TRACKED_BOARD_IDS } from "./config";
import { assessSourceIntegrity, classifyRunStatus, isDatabaseFailure } from "./integrity";

describe("source integrity classification", () => {
  it("classifies successful, partial, and failed runs independently of process exit", () => {
    expect(classifyRunStatus(10, 0, 0)).toBe("SUCCEEDED");
    expect(classifyRunStatus(10, 0, 1)).toBe("PARTIAL");
    expect(classifyRunStatus(10, 1, 0)).toBe("PARTIAL");
    expect(classifyRunStatus(10, 10, 0)).toBe("FAILED");
  });

  it("distinguishes database failures from source processing errors", () => {
    expect(isDatabaseFailure(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(true);
    expect(isDatabaseFailure(new Error("Not an approved board"))).toBe(false);
  });

  it("accepts complete declared record counts", () => {
    const result = assessSourceIntegrity("officers", {
      totalResults: 2,
      officers: [{ oid: "1" }, { oid: "2" }],
    });
    expect(result).toMatchObject({ expected_records: 2, received_records: 2, issues: [] });
  });

  it("marks truncated declared record sets partial", () => {
    const result = assessSourceIntegrity("officers", {
      totalResults: 3,
      officers: [{ oid: "1" }],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      reason: "officer_registry_incomplete",
      expected_records: 3,
      received_records: 1,
    }));
  });

  it("detects unexpected empty bounty responses", () => {
    const result = assessSourceIntegrity("bounty", { summary: { encounters: 8 }, recent: [] });
    expect(result.issues).toContainEqual(expect.objectContaining({ reason: "unexpected_empty_response" }));
  });

  it("detects missing required catalog boards", () => {
    const result = assessSourceIntegrity("catalog", { boards: TRACKED_BOARD_IDS.slice(1).map((id) => ({ id })) });
    expect(result.issues[0]).toMatchObject({ reason: "tracked_boards_missing", missing_fields: [TRACKED_BOARD_IDS[0]] });
  });

  it("detects pagination that terminates before the declared final page", () => {
    const result = assessSourceIntegrity("leaderboard", {
      entries: [],
      pagination: { pagesReceived: 2, totalPages: 4, complete: false },
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      event: "pagination_incomplete",
      expected_records: 4,
      received_records: 2,
    }));
  });
});
