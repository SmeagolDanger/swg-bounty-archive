import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db/client";
import { log } from "@/lib/observability/logger";
import { ingestFixture } from "./pipeline";
import { PARSER_VERSION } from "./config";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

function validBountyPayload() {
  return {
    windowDays: 14,
    summary: { kills: 0, failures: 0, encounters: 0, successRate: 0, creditsPaid: 0, averageBounty: 0, distinctHunters: 0, distinctTargets: 0, largestBounty: null },
    hunters: [], targets: [], survivors: [], recent: [], fetchedAt: "2026-08-12T10:00:00.000Z",
  };
}

suite("ingestion observability persistence", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  let runId = "";

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!runId) return;
    await pool.query("DELETE FROM ingestion_errors WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM schema_signatures WHERE first_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_encounters WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_aggregate_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM api_ingestions WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM ingestion_runs WHERE id=$1", [runId]);
    await pool.end();
  });

  it("logs and persists deduplicated unknown-field and schema-change events", async () => {
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('ONCE') RETURNING id");
    runId = run.rows[0].id;
    await ingestFixture(runId, "bounty_activity", "bounty", validBountyPayload(), { case: `baseline-${suffix}` });

    const warning = vi.spyOn(log, "warn");
    const unknownField = `monitoringField${suffix}`;
    await ingestFixture(runId, "bounty_activity", "bounty", { ...validBountyPayload(), [unknownField]: true }, { case: `changed-${suffix}` });
    await ingestFixture(runId, "bounty_activity", "bounty", { ...validBountyPayload(), [unknownField]: false }, { case: `changed-again-${suffix}` });

    expect(warning).toHaveBeenCalledWith("source_fields_changed", expect.objectContaining({ run_id: runId, source: "bounty_activity", unexpected_fields: [`$.${unknownField}`] }));
    expect(warning).toHaveBeenCalledWith("source_schema_changed", expect.objectContaining({
      run_id: runId,
      source: "bounty_activity",
      unexpected_fields: [`$.${unknownField}`],
      missing_fields: [],
      changed_types: [],
    }));
    expect(warning.mock.calls.filter(([event]) => event === "source_fields_changed")).toHaveLength(1);

    const events = await pool.query<{ event_type: string; details: Record<string, unknown> }>(
      "SELECT event_type,details FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1) ORDER BY detected_at",
      [runId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["SWG_API_UNKNOWN_FIELDS", "SWG_API_SCHEMA_CHANGE"]));
    expect(events.rows.find((row) => row.event_type === "SWG_API_SCHEMA_CHANGE")?.details).toMatchObject({ addedPaths: [`$.${unknownField}`] });
  });

  it("archives the complete raw response before reporting validation failure", async () => {
    const failure = vi.spyOn(log, "error");
    const payload = {
      ...validBountyPayload(),
      summary: { ...validBountyPayload().summary, failures: 1, encounters: 1, distinctHunters: 1, distinctTargets: 1 },
      recent: [{ timestamp: "2026-08-12T10:00:00.000Z", outcome: "FAILED", hunterName: `Hunter-${suffix}`, targetName: "Target", credits: 100 }],
    };

    await expect(ingestFixture(runId, "bounty_activity", "bounty", payload, { case: `validation-${suffix}` })).rejects.toThrow();
    const archived = await pool.query<{ processing_status: string; payload: unknown; error_information: Record<string, unknown> }>(
      "SELECT i.processing_status,b.payload,i.error_information FROM api_ingestions i LEFT JOIN payload_blobs b ON b.payload_hash=i.payload_hash WHERE i.run_id=$1 AND i.request_parameters->>'case'=$2",
      [runId, `validation-${suffix}`],
    );
    expect(archived.rowCount).toBe(1);
    expect(archived.rows[0]).toMatchObject({ processing_status: "FAILED", payload, error_information: { errorCode: "VALIDATION_FAILED" } });
    expect(failure).toHaveBeenCalledWith("source_validation_failed", expect.objectContaining({
      run_id: runId,
      ingestion_id: expect.any(String),
      source: "bounty_activity",
      parser_version: PARSER_VERSION,
      schema_signature: expect.any(String),
      missing_fields: expect.arrayContaining([expect.stringContaining("credits")]),
    }));
  });
});
