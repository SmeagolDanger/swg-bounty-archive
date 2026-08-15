import { describe, expect, it } from "vitest";
import { structuredLogRecord } from "./logger";

describe("structured logger", () => {
  it("emits stable JSON metadata while redacting sensitive configuration and payloads", () => {
    const record = structuredLogRecord("error", "source_processing_failed", {
      run_id: "run-1",
      source: "leaderboard",
      databaseUrl: "postgresql://user:secret@example/db",
      authorization: "Bearer secret",
      axiomToken: "token",
      payload: { private: "full upstream response" },
      nested: { password: "secret", safe: "visible" },
      errorMessage: "connection postgresql://user:secret@example/db failed with Bearer abc123 token=axiom-secret",
    }, new Date("2026-08-12T10:00:00.000Z"));

    expect(record).toMatchObject({ timestamp: "2026-08-12T10:00:00.000Z", level: "error", event: "source_processing_failed", run_id: "run-1", service: "outer-rim-ledger" });
    expect(JSON.stringify(record)).not.toContain("postgresql://");
    expect(JSON.stringify(record)).not.toContain("abc123");
    expect(JSON.stringify(record)).not.toContain("axiom-secret");
    expect(JSON.stringify(record)).not.toContain("user:secret");
    expect(JSON.stringify(record)).not.toContain("full upstream response");
    expect(record).toMatchObject({ databaseUrl: "[REDACTED]", authorization: "[REDACTED]", payload: "[REDACTED]", nested: { password: "[REDACTED]", safe: "visible" } });
  });
});
