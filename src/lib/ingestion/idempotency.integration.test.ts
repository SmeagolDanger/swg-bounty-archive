import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { ingestFixture } from "./pipeline";

const dbEnabled = process.env.RUN_DB_TESTS === "1";
const suite = dbEnabled ? describe : describe.skip;

suite("database idempotency and concurrent ingestion", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  let runId = "";
  let priorBoardIngestionId: string | null = null;
  const participantIds = [`test-${suffix}-1`, `test-${suffix}-2`];

  afterAll(async () => {
    if (!runId) return;
    await pool.query("DELETE FROM data_revisions WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM leaderboard_entries WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM leaderboard_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_encounters WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_aggregate_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM leaderboard_periods WHERE leaderboard_id='BOUNTY_HUNTER_GROUND_VALUE' AND NOT EXISTS (SELECT 1 FROM leaderboard_snapshots WHERE period_id=leaderboard_periods.id)");
    await pool.query("DELETE FROM participants WHERE source_participant_id = ANY($1::text[])", [participantIds]);
    await pool.query("DELETE FROM schema_signatures WHERE first_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    if (priorBoardIngestionId) await pool.query("UPDATE leaderboards SET source_ingestion_id=$1 WHERE id='BOUNTY_HUNTER_GROUND_VALUE'", [priorBoardIngestionId]);
    else await pool.query("DELETE FROM leaderboards WHERE id='BOUNTY_HUNTER_GROUND_VALUE'");
    await pool.query("DELETE FROM api_ingestions WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM ingestion_runs WHERE id=$1", [runId]);
    await pool.end();
  });

  it("imports the exact same logical fixture 100 times concurrently only once", async () => {
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('ONCE') RETURNING id");
    runId = run.rows[0].id;
    const priorBoard = await pool.query<{ source_ingestion_id:string }>("SELECT source_ingestion_id FROM leaderboards WHERE id='BOUNTY_HUNTER_GROUND_VALUE'");
    priorBoardIngestionId = priorBoard.rows[0]?.source_ingestion_id ?? null;
    const catalog = {
      boards: [{ id: "BOUNTY_HUNTER_GROUND_VALUE", trackerOid: "60516", name: "Bounty Hunter — Ground Value", category: "Bounty Hunter", valueType: "CREDITS", periodStartTime: 1786226405, periodEndTime: 1786831200 }],
      fetchedAt: "2026-08-12T01:17:35.698Z",
    };
    await ingestFixture(runId, "board_catalog", "catalog", catalog);
    const payload = {
      id: "BOUNTY_HUNTER_GROUND_VALUE", period: "CURRENT", subject: "player", valueType: "CREDITS", totalScore: 3,
      periodStartTime: 1786226405, periodEndTime: 1786831200, fetchedAt: "2026-08-12T01:17:35.698Z",
      entries: [
        { rank: 1, participantId: participantIds[0], name: `Test Hunter ${suffix}`, score: 2, scoreRaw: "200", guildAbbreviation: null, faction: null, planet: null, cityName: null },
        { rank: 2, participantId: participantIds[1], name: `Test Hunter Two ${suffix}`, score: 1, scoreRaw: "100", guildAbbreviation: null, faction: null, planet: null, cityName: null },
      ],
    };
    await Promise.all(Array.from({ length: 100 }, () => ingestFixture(runId, "leaderboard", "leaderboard", payload, { id: payload.id, period: payload.period, subject: payload.subject })));
    const count = await pool.query<{ snapshots: number; entries: number; raw_ingestions: number }>(
      `SELECT
        (SELECT count(*)::int FROM leaderboard_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)) AS snapshots,
        (SELECT count(*)::int FROM leaderboard_entries WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)) AS entries,
        (SELECT count(*)::int FROM api_ingestions WHERE run_id=$1) AS raw_ingestions`, [runId],
    );
    expect(count.rows[0]).toEqual({ snapshots: 1, entries: 2, raw_ingestions: 101 });

    const historical = { ...payload, period: "PREVIOUS_1" as const, periodStartTime: 1785621605, periodEndTime: 1786226400 };
    await ingestFixture(runId, "leaderboard", "leaderboard", historical, { id: payload.id, period: historical.period, subject: payload.subject });
    const corrected = { ...historical, entries: [
      { ...historical.entries[0], rank: 2, score: 3, scoreRaw: "300" },
      { ...historical.entries[1], rank: 1, score: 4, scoreRaw: "400" },
    ] };
    await ingestFixture(runId, "leaderboard", "leaderboard", corrected, { id: payload.id, period: corrected.period, subject: payload.subject });
    const correctionCounts = await pool.query<{ snapshots:number; entries:number; revisions:number }>(
      `SELECT
        (SELECT count(*)::int FROM leaderboard_snapshots s JOIN leaderboard_periods p ON p.id=s.period_id WHERE s.source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1) AND p.source_period_key='PREVIOUS_1') AS snapshots,
        (SELECT count(*)::int FROM leaderboard_entries e JOIN leaderboard_snapshots s ON s.id=e.snapshot_id JOIN leaderboard_periods p ON p.id=s.period_id WHERE e.source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1) AND p.source_period_key='PREVIOUS_1') AS entries,
        (SELECT count(*)::int FROM data_revisions WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1) AND entity_type='leaderboard_entry') AS revisions`, [runId],
    );
    expect(correctionCounts.rows[0]).toEqual({ snapshots:2, entries:4, revisions:4 });

    const bounty = {
      windowDays:14, summary:{kills:1,failures:1,encounters:2,successRate:0.5,creditsPaid:500,averageBounty:500,distinctHunters:1,distinctTargets:2,
        largestBounty:{timestamp:"2026-08-12T00:56:07.000Z",outcome:"KILL" as const,hunterName:`Test Hunter ${suffix}`,targetName:"Test Target",credits:500}},
      hunters:[{rank:1,name:`Test Hunter ${suffix}`,kills:1,failures:1,encounters:2,successRate:0.5,creditsEarned:500}],
      targets:[{rank:1,name:"Test Target",timesKilled:1,timesSurvived:0,encounters:1,survivalRate:0}],
      survivors:[{rank:1,name:"Test Survivor",timesKilled:0,timesSurvived:1,encounters:1,survivalRate:1}],
      recent:[
        {timestamp:"2026-08-12T00:56:07.000Z",outcome:"KILL" as const,hunterName:`Test Hunter ${suffix}`,targetName:"Test Target",credits:500},
        {timestamp:"2026-08-12T00:57:07.000Z",outcome:"FAILED" as const,hunterName:`Test Hunter ${suffix}`,targetName:"Test Survivor",credits:0},
      ], fetchedAt:"2026-08-12T01:10:00.844Z",
    };
    await Promise.all(Array.from({ length:100 },()=>ingestFixture(runId,"bounty_activity","bounty",bounty)));
    const bountyCounts=await pool.query<{encounters:number;aggregates:number}>(`SELECT
      (SELECT count(*)::int FROM bounty_encounters WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)) AS encounters,
      (SELECT count(*)::int FROM bounty_aggregate_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)) AS aggregates`,[runId]);
    expect(bountyCounts.rows[0]).toEqual({encounters:2,aggregates:1});
    const search=await pool.query("SELECT current_name FROM participants WHERE current_name ILIKE $1 AND source_participant_id = ANY($2::text[])",["%test hunter%",participantIds]);
    expect(search.rowCount).toBe(2);
  });
});
