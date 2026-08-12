import { describe, expect, it } from "vitest";
import { canonicalJson, encounterFingerprint, schemaSignature } from "./hash";

describe("deterministic hashing", () => {
  it("canonicalizes object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it("does not use collection time in encounter identity", () => {
    const encounter = { timestamp: "2026-08-12T00:56:07.000Z", outcome: "KILL" as const, hunterName: "Hunter", targetName: "Target", credits: 27065 };
    expect(encounterFingerprint(encounter)).toBe(encounterFingerprint({ ...encounter }));
    expect(encounterFingerprint(encounter)).toBe(encounterFingerprint({ ...encounter, timestamp: "2026-08-11T20:56:07.000-04:00" }));
  });

  it("detects nested schema changes without depending on values", () => {
    expect(schemaSignature({ rows: [{ id: "a", score: 1 }] }).signature).toBe(schemaSignature({ rows: [{ id: "b", score: 99 }] }).signature);
    expect(schemaSignature({ rows: [{ id: "a", score: 1 }], newField: true }).signature).not.toBe(schemaSignature({ rows: [{ id: "b", score: 99 }] }).signature);
  });
});
