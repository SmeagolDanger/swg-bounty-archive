import { describe, expect, it } from "vitest";
import { canonicalJson, diffSchema, encounterFingerprint, hasUnobservedArrayMembers, schemaSignature, schemaStructure } from "./hash";

describe("deterministic hashing", () => {
  it("canonicalizes object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it("does not use collection time in encounter identity", () => {
    const encounter = { timestamp: "2026-08-12T00:56:07.000Z", outcome: "KILL" as const, hunterName: "Hunter", targetName: "Target", credits: 27065 };
    expect(encounterFingerprint(encounter)).toBe(encounterFingerprint({ ...encounter }));
    expect(encounterFingerprint(encounter)).toBe(encounterFingerprint({ ...encounter, timestamp: "2026-08-11T20:56:07.000-04:00" }));
  });

  it("detects fields inside arrays without depending on scalar values", () => {
    const first = schemaSignature({ entries: [{ rank: 1, participantId: "a", score: 1 }] });
    const same = schemaSignature({ entries: [{ score: 99, participantId: "b", rank: 2 }] });
    expect(first.signature).toBe(same.signature);
    expect(first.paths).toContain("$.entries[].score:number");
    expect(first.signature).not.toBe(schemaSignature({ entries: [{ rank: 1, participantId: "a", score: 1, newField: true }] }).signature);
  });

  it("is deterministic across object key and array item ordering", () => {
    const left = { entries: [{ name: "a", score: 1 }, { active: true, score: 2 }] };
    const right = { entries: [{ score: 2, active: false }, { score: 9, name: "b" }] };
    expect(schemaSignature(left)).toEqual(schemaSignature(right));
  });

  it("unions heterogeneous array fields and types", () => {
    expect(schemaStructure({ entries: [{ score: 1, guild: null }, { score: "2", guild: "ABC", active: true }] })).toEqual({
      "$": ["object"],
      "$.entries": ["array"],
      "$.entries[]": ["object"],
      "$.entries[].active": ["boolean"],
      "$.entries[].guild": ["null", "string"],
      "$.entries[].score": ["number", "string"],
    });
  });

  it("diffs added, removed, and changed paths", () => {
    const previous = schemaStructure({ entries: [{ score: 1, scoreRaw: "1" }] });
    const next = schemaStructure({ entries: [{ score: "1", newField: true }] });
    expect(diffSchema(previous, next)).toEqual({
      addedPaths: ["$.entries[].newField"],
      removedPaths: ["$.entries[].scoreRaw"],
      changedTypes: [{ path: "$.entries[].score", from: ["number"], to: ["string"] }],
    });
  });

  it("uses stable nullable unions and detects null-only changes", () => {
    const nullable = schemaStructure({ entries: [{ guild: null }, { guild: "ABC" }] });
    expect(nullable["$.entries[].guild"]).toEqual(["null", "string"]);
    expect(diffSchema(nullable, schemaStructure({ entries: [{ guild: null }] })).changedTypes).toEqual([
      { path: "$.entries[].guild", from: ["null", "string"], to: ["null"] },
    ]);
  });

  it("marks empty arrays as structurally inconclusive", () => {
    expect(hasUnobservedArrayMembers(schemaSignature({ entries: [] }).structure)).toBe(true);
    expect(hasUnobservedArrayMembers(schemaSignature({ entries: [{ rank: 1 }] }).structure)).toBe(false);
    expect(diffSchema(schemaStructure({ entries: [{ rank: 1 }] }), schemaStructure({ entries: [] }))).toEqual({
      addedPaths: [], removedPaths: [], changedTypes: [],
    });
    expect(diffSchema(schemaStructure({ entries: [] }), schemaStructure({ entries: [], newField: true })).addedPaths).toEqual(["$.newField"]);
  });
});
