import { describe, expect, it } from "vitest";
import { classifyAlert, structuredLogRecord } from "./logger";

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

describe("alert classification", () => {
  it("names run-level failures and summarises them in one line", () => {
    expect(classifyAlert("error", "ingestion_run_complete", { status: "failed", source: "all", failed_sources: 3, error_message: "All 64 requests failed" }))
      .toEqual({ alert: "ingestion_failed", alert_summary: "ingestion_run_complete · status=failed · failed_sources=3 · All 64 requests failed" });
    expect(classifyAlert("warn", "ingestion_run_complete", { status: "partial", source: "all", reason: ["source_failures"], partial_sources: 0, failed_sources: 1 }))
      .toEqual({ alert: "ingestion_partial", alert_summary: "ingestion_run_complete · status=partial · reason=source_failures · failed_sources=1" });
    expect(classifyAlert("info", "ingestion_run_complete", { status: "success" })).toBeUndefined();
  });

  it("does not double-alert on per-source failures that the run summary already covers", () => {
    expect(classifyAlert("error", "source_validation_failed", { source: "leaderboard", status: "failed" })).toBeUndefined();
    expect(classifyAlert("error", "source_processing_failed", { source: "leaderboard", status: "failed", reason: "processing_failed" })).toBeUndefined();
    expect(classifyAlert("warn", "api_rate_limited", { source: "leaderboard" })).toBeUndefined();
    expect(classifyAlert("error", "source_processing_failed", { source: "worker_cycle", reason: "worker_cycle_aborted" })?.alert).toBe("worker_cycle_aborted");
  });

  it("alerts on dead Discord webhooks but not on transient delivery failures", () => {
    expect(classifyAlert("warn", "discord_bounty_failed", { reason: "webhook_delivery_failed", http_status: 404 })?.alert).toBe("discord_webhook_rejected");
    expect(classifyAlert("warn", "discord_bounty_failed", { reason: "webhook_delivery_failed", http_status: 429 })).toBeUndefined();
    expect(classifyAlert("warn", "discord_bounty_failed", { reason: "webhook_delivery_failed", http_status: 502 })).toBeUndefined();
    expect(classifyAlert("warn", "discord_bounty_failed", { reason: "webhook_delivery_failed", error_type: "TypeError" })).toBeUndefined();
    expect(classifyAlert("warn", "discord_bounty_failed", { reason: "publisher_error" })?.alert).toBe("discord_feed_error");
  });

  it("covers the other operational failures and the manual test event", () => {
    expect(classifyAlert("warn", "capture_heartbeat_failed", { source: "capture_standby" })?.alert).toBe("standby_unreachable");
    expect(classifyAlert("warn", "discord_report_failed", {})?.alert).toBe("weekly_report_failed");
    expect(classifyAlert("error", "database_transaction_failed", { reason: "run_finalization_failed" })?.alert).toBe("database_failure");
    expect(classifyAlert("warn", "source_schema_changed", { source: "bounty_activity" })?.alert).toBe("source_changed");
    expect(classifyAlert("error", "capture_replay_complete", { status: "failed" })?.alert).toBe("replay_failed");
    expect(classifyAlert("info", "capture_replay_complete", { status: "succeeded" })).toBeUndefined();
    expect(classifyAlert("error", "source_processing_failed", { source: "monitoring_test", reason: "manual_test" })?.alert).toBe("monitoring_test");
    expect(classifyAlert("error", "worker_stopped", { reason: "worker_exit" })?.alert).toBe("worker_stopped");
    expect(classifyAlert("info", "worker_stopped", { reason: "signal" })).toBeUndefined();
  });

  it("adds alert fields to emitted records after redaction", () => {
    const record = structuredLogRecord("error", "database_transaction_failed", {
      reason: "http_failure_audit_write_failed", error_message: "connect to postgresql://user:secret@db/x refused",
    });
    expect(record.alert).toBe("database_failure");
    expect(String(record.alert_summary)).toContain("reason=http_failure_audit_write_failed");
    expect(String(record.alert_summary)).not.toContain("user:secret");
    expect(structuredLogRecord("info", "ingestion_run_complete", { status: "success" })).not.toHaveProperty("alert");
  });
});
