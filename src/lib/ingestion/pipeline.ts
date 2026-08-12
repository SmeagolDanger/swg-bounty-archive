import type { PoolClient } from "pg";
import { pool } from "@/lib/db/client";
import { BOUNTY_BOARD_IDS, PARSER_VERSION, PERIODS, SUBJECTS, swgBaseUrl } from "./config";
import { encounterFingerprint, schemaSignature, sha256 } from "./hash";
import { fetchJson, type FetchResult } from "./fetcher";
import { boardCatalogSchema, bountySchema, leaderboardSchema, winsSchema } from "./schemas";
import { findUnknownFields } from "./unknown-fields";

type RunType = "ONCE" | "POLL" | "BACKFILL" | "RECONCILE" | "INSPECT";
type SourceKey = "board_catalog" | "bounty_activity" | "leaderboard" | "leaderboard_wins";
type Processor = "catalog" | "bounty" | "leaderboard" | "wins";

interface WorkItem {
  sourceKey: SourceKey;
  path: string;
  parameters: Record<string, string>;
  processor: Processor;
}

interface Counters {
  received: number;
  inserted: number;
  unchanged: number;
  revised: number;
  duplicates: number;
}

const json = (value: unknown) => JSON.stringify(value);

async function recordRevision(
  client: PoolClient,
  ingestionId: string,
  entityType: string,
  entityKey: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<number> {
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return 0;
  const result = await client.query(
    `INSERT INTO data_revisions(entity_type, entity_key, field, old_value, new_value, source_ingestion_id)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT DO NOTHING RETURNING id`,
    [entityType, entityKey, field, json(oldValue), json(newValue), ingestionId],
  );
  return result.rowCount ?? 0;
}

async function upsertParticipant(
  client: PoolClient,
  type: "player" | "guild" | "city",
  entry: { participantId: string; name: string; guildAbbreviation?: string | null; faction?: string | null; planet?: string | null; cityName?: string | null },
  ingestionId: string,
  raw: unknown,
): Promise<{ id: string; revised: number }> {
  const old = await client.query<{
    id: string; current_name: string; guild_abbreviation: string | null; faction: string | null; planet: string | null; city_name: string | null;
  }>(`SELECT id,current_name,guild_abbreviation,faction,planet,city_name FROM participants WHERE participant_type=$1 AND source_participant_id=$2`, [type, entry.participantId]);
  let revised = 0;
  const prior = old.rows[0];
  if (prior) {
    const next = {
      current_name: entry.name,
      guild_abbreviation: entry.guildAbbreviation ?? null,
      faction: entry.faction ?? null,
      planet: entry.planet ?? null,
      city_name: entry.cityName ?? null,
    };
    for (const [field, value] of Object.entries(next)) {
      revised += await recordRevision(client, ingestionId, "participant", `${type}:${entry.participantId}`, field, prior[field as keyof typeof prior], value);
    }
  }
  const result = await client.query<{ id: string }>(
    `INSERT INTO participants(participant_type,source_participant_id,current_name,guild_abbreviation,faction,planet,city_name,source_ingestion_id,raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT(participant_type,source_participant_id) DO UPDATE SET
       current_name=EXCLUDED.current_name,guild_abbreviation=EXCLUDED.guild_abbreviation,faction=EXCLUDED.faction,
       planet=EXCLUDED.planet,city_name=EXCLUDED.city_name,last_seen_at=now(),source_ingestion_id=EXCLUDED.source_ingestion_id,raw=EXCLUDED.raw
     RETURNING id`,
    [type, entry.participantId, entry.name, entry.guildAbbreviation ?? null, entry.faction ?? null, entry.planet ?? null, entry.cityName ?? null, ingestionId, json(raw)],
  );
  return { id: result.rows[0].id, revised };
}

async function processCatalog(client: PoolClient, payload: unknown, ingestionId: string): Promise<Counters> {
  const data = boardCatalogSchema.parse(payload);
  let inserted = 0;
  let unchanged = 0;
  let revised = 0;
  for (const board of data.boards.filter((item) => item.category === "Bounty Hunter")) {
    const old = await client.query<{ name: string; tracker_oid: string; category: string; value_type: string }>("SELECT name,tracker_oid,category,value_type FROM leaderboards WHERE id=$1", [board.id]);
    if (old.rows[0]) {
      for (const field of ["name", "tracker_oid", "category", "value_type"] as const) {
        const sourceField = field === "tracker_oid" ? "trackerOid" : field === "value_type" ? "valueType" : field;
        revised += await recordRevision(client, ingestionId, "leaderboard", board.id, field, old.rows[0][field], board[sourceField]);
      }
      unchanged += 1;
    } else inserted += 1;
    await client.query(
      `INSERT INTO leaderboards(id,tracker_oid,name,category,value_type,source_ingestion_id,raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT(id) DO UPDATE SET tracker_oid=EXCLUDED.tracker_oid,name=EXCLUDED.name,category=EXCLUDED.category,
       value_type=EXCLUDED.value_type,last_seen_at=now(),source_ingestion_id=EXCLUDED.source_ingestion_id,raw=EXCLUDED.raw`,
      [board.id, board.trackerOid, board.name, board.category, board.valueType, ingestionId, json(board)],
    );
  }
  return { received: data.boards.length, inserted, unchanged, revised, duplicates: 0 };
}

async function processLeaderboard(client: PoolClient, payload: unknown, ingestionId: string, observedAt: Date): Promise<Counters> {
  const data = leaderboardSchema.parse(payload);
  if (!BOUNTY_BOARD_IDS.includes(data.id as (typeof BOUNTY_BOARD_IDS)[number])) throw new Error(`Not an approved Bounty Hunter board: ${data.id}`);
  const board = await client.query("SELECT id FROM leaderboards WHERE id=$1", [data.id]);
  if (!board.rowCount) throw new Error(`Board catalog must be imported before ${data.id}`);

  const startsAt = new Date(data.periodStartTime * 1000);
  const endsAt = new Date(data.periodEndTime * 1000);
  const period = await client.query<{ id: string }>(
    `INSERT INTO leaderboard_periods(leaderboard_id,source_period_key,starts_at,ends_at)
     VALUES($1,$2,$3,$4) ON CONFLICT(leaderboard_id,starts_at,ends_at) DO UPDATE SET last_seen_at=now(),source_period_key=EXCLUDED.source_period_key RETURNING id`,
    [data.id, data.period, startsAt, endsAt],
  );
  const periodId = period.rows[0].id;
  const state = { ...data, fetchedAt: undefined };
  const stateHash = sha256(state);
  const priorSnapshot = await client.query<{ id: string }>(
    `SELECT id FROM leaderboard_snapshots WHERE leaderboard_id=$1 AND period_id=$2 AND subject=$3 ORDER BY observed_at DESC LIMIT 1`,
    [data.id, periodId, data.subject],
  );
  const snapshot = await client.query<{ id: string }>(
    `INSERT INTO leaderboard_snapshots(leaderboard_id,period_id,subject,total_score,value_type,state_hash,source_fetched_at,observed_at,source_ingestion_id,raw)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT(leaderboard_id,period_id,subject,state_hash) DO NOTHING RETURNING id`,
    [data.id, periodId, data.subject, data.totalScore, data.valueType, stateHash, new Date(data.fetchedAt), observedAt, ingestionId, json(data)],
  );
  if (!snapshot.rowCount) return { received: data.entries.length, inserted: 0, unchanged: data.entries.length, revised: 0, duplicates: data.entries.length };

  let revised = 0;
  const oldEntries = new Map<string, Record<string, unknown>>();
  if (data.period !== "CURRENT" && priorSnapshot.rows[0]) {
    const old = await client.query(`SELECT source_participant_id,rank,score::text,score_raw FROM leaderboard_entries WHERE snapshot_id=$1`, [priorSnapshot.rows[0].id]);
    for (const entry of old.rows) oldEntries.set(entry.source_participant_id as string, entry);
  }

  for (const entry of data.entries) {
    const participant = await upsertParticipant(client, data.subject, entry, ingestionId, entry);
    revised += participant.revised;
    await client.query(
      `INSERT INTO leaderboard_entries(snapshot_id,participant_id,source_participant_id,rank,score,score_raw,source_ingestion_id,raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(snapshot_id,source_participant_id) DO NOTHING`,
      [snapshot.rows[0].id, participant.id, entry.participantId, entry.rank, entry.score, entry.scoreRaw, ingestionId, json(entry)],
    );
    const old = oldEntries.get(entry.participantId);
    if (old) {
      revised += await recordRevision(client, ingestionId, "leaderboard_entry", `${data.id}:${periodId}:${data.subject}:${entry.participantId}`, "rank", old.rank, entry.rank);
      revised += await recordRevision(client, ingestionId, "leaderboard_entry", `${data.id}:${periodId}:${data.subject}:${entry.participantId}`, "score_raw", old.score_raw, entry.scoreRaw);
    }
  }
  return { received: data.entries.length, inserted: data.entries.length, unchanged: 0, revised, duplicates: 0 };
}

async function processBounty(client: PoolClient, payload: unknown, ingestionId: string, observedAt: Date): Promise<Counters> {
  const data = bountySchema.parse(payload);
  let inserted = 0;
  let duplicates = 0;
  for (const encounter of data.recent) {
    const fingerprint = encounterFingerprint(encounter);
    const result = await client.query(
      `INSERT INTO bounty_encounters(fingerprint,event_at,outcome,hunter_name,target_name,credits,source_ingestion_id,first_observed_at,raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,
      [fingerprint, new Date(encounter.timestamp), encounter.outcome, encounter.hunterName, encounter.targetName, encounter.credits, ingestionId, observedAt, json(encounter)],
    );
    if (result.rowCount) inserted += 1; else duplicates += 1;
  }
  const aggregateState = { windowDays: data.windowDays, summary: data.summary, hunters: data.hunters, targets: data.targets, survivors: data.survivors };
  const aggregate = await client.query(
    `INSERT INTO bounty_aggregate_snapshots(window_days,state_hash,source_fetched_at,observed_at,source_ingestion_id,summary,hunters,targets,survivors,raw)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb) ON CONFLICT(state_hash) DO NOTHING RETURNING id`,
    [data.windowDays, sha256(aggregateState), new Date(data.fetchedAt), observedAt, ingestionId, json(data.summary), json(data.hunters), json(data.targets), json(data.survivors), json(data)],
  );
  if (aggregate.rowCount) inserted += 1; else duplicates += 1;
  return { received: data.recent.length + 1, inserted, unchanged: duplicates, revised: 0, duplicates };
}

async function processWins(client: PoolClient, payload: unknown, ingestionId: string, observedAt: Date): Promise<Counters> {
  const data = winsSchema.parse(payload);
  if (!BOUNTY_BOARD_IDS.includes(data.id as (typeof BOUNTY_BOARD_IDS)[number])) throw new Error(`Not an approved Bounty Hunter board: ${data.id}`);
  let inserted = 0;
  let unchanged = 0;
  let revised = 0;
  for (const [subject, entries] of [["city", data.cityWins], ["guild", data.guildWins]] as const) {
    for (const entry of entries) {
      const participant = await upsertParticipant(client, subject, { ...entry, cityName: null }, ingestionId, entry);
      revised += participant.revised;
      const result = await client.query(
        `INSERT INTO leaderboard_wins(leaderboard_id,participant_id,subject,wins,rank,state_hash,observed_at,source_ingestion_id,raw)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(leaderboard_id,participant_id,wins,rank) DO NOTHING RETURNING id`,
        [data.id, participant.id, subject, entry.wins, entry.rank, sha256(entry), observedAt, ingestionId, json(entry)],
      );
      if (result.rowCount) inserted += 1; else unchanged += 1;
    }
  }
  return { received: data.cityWins.length + data.guildWins.length, inserted, unchanged, revised, duplicates: unchanged };
}

async function archiveAndProcess(runId: string, item: WorkItem, result: FetchResult): Promise<Counters> {
  const client = await pool.connect();
  const baseUrl = swgBaseUrl();
  try {
    await client.query("BEGIN");
    const source = await client.query<{ id: string }>("SELECT id FROM api_sources WHERE source_key=$1 FOR UPDATE", [item.sourceKey]);
    if (!source.rows[0]) throw new Error(`Unknown API source ${item.sourceKey}`);
    const shape = result.payload === null ? null : schemaSignature(result.payload);
    const ingestion = await client.query<{ id: string }>(
      `INSERT INTO api_ingestions(run_id,source_id,endpoint,request_parameters,requested_at,response_received_at,duration_ms,http_status,response_headers,payload,payload_hash,schema_signature,parser_version,processing_status)
       VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14) RETURNING id`,
      [runId, source.rows[0].id, `${baseUrl}${item.path}`, json(item.parameters), result.requestedAt, result.receivedAt, result.durationMs, result.status,
        json(result.headers), result.payload === null ? null : json(result.payload), result.payload === null ? null : sha256(result.payload), shape?.signature ?? null,
        PARSER_VERSION, result.status >= 200 && result.status < 300 ? "RECEIVED" : "HTTP_ERROR"],
    );
    const ingestionId = ingestion.rows[0].id;
    const unknownFields = result.payload === null ? [] : findUnknownFields(item.processor, result.payload);
    if (unknownFields.length) {
      const eventKey = `${item.sourceKey}:${sha256(unknownFields)}`;
      await client.query(
        `INSERT INTO data_quality_events(severity,event_type,entity_type,entity_key,details,source_ingestion_id)
         SELECT 'WARNING','SWG_API_UNKNOWN_FIELDS','api_source',$1,$2::jsonb,$3
         WHERE NOT EXISTS (SELECT 1 FROM data_quality_events WHERE event_type='SWG_API_UNKNOWN_FIELDS' AND entity_key=$1 AND resolved_at IS NULL)`,
        [eventKey, json({ sourceKey: item.sourceKey, unknownFields }), ingestionId],
      );
    }
    if (shape) {
      const known = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM schema_signatures s JOIN api_ingestions i ON i.id=s.first_ingestion_id WHERE s.source_id=$1 AND i.parser_version=$2`,
        [source.rows[0].id, PARSER_VERSION],
      );
      const signatureInsert = await client.query(
        `INSERT INTO schema_signatures(source_id,signature,field_paths,first_ingestion_id) VALUES($1,$2,$3::jsonb,$4)
         ON CONFLICT(source_id,signature) DO UPDATE SET last_seen_at=now(),occurrences=schema_signatures.occurrences+1 RETURNING (xmax = 0) AS inserted`,
        [source.rows[0].id, shape.signature, json(shape.paths), ingestionId],
      );
      if (signatureInsert.rows[0]?.inserted && Number(known.rows[0].count) > 0) {
        await client.query(
          `INSERT INTO data_quality_events(severity,event_type,details,source_ingestion_id) VALUES('WARNING','SWG_API_SCHEMA_CHANGE',$1::jsonb,$2)`,
          [json({ sourceKey: item.sourceKey, signature: shape.signature, fieldPaths: shape.paths }), ingestionId],
        );
      }
    }
    if (result.status < 200 || result.status >= 300) throw new Error(`SWG returned HTTP ${result.status}`);
    let counters: Counters;
    if (item.processor === "catalog") counters = await processCatalog(client, result.payload, ingestionId);
    else if (item.processor === "leaderboard") counters = await processLeaderboard(client, result.payload, ingestionId, result.receivedAt);
    else if (item.processor === "wins") counters = await processWins(client, result.payload, ingestionId, result.receivedAt);
    else counters = await processBounty(client, result.payload, ingestionId, result.receivedAt);
    await client.query("UPDATE api_ingestions SET processing_status='PROCESSED' WHERE id=$1", [ingestionId]);
    await client.query("UPDATE api_sources SET last_success_at=now(),last_attempt_at=now() WHERE id=$1", [source.rows[0].id]);
    await client.query("UPDATE ingestion_errors SET resolved_at=now() WHERE source_id=$1 AND resolved_at IS NULL", [source.rows[0].id]);
    await client.query("COMMIT");
    return counters;
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    const source = await pool.query<{ id: string }>("SELECT id FROM api_sources WHERE source_key=$1", [item.sourceKey]);
    let failedIngestionId: string | null = null;
    if (source.rows[0]) {
      const shape = result.payload === null ? null : schemaSignature(result.payload);
      const failed = await pool.query<{ id: string }>(
        `INSERT INTO api_ingestions(run_id,source_id,endpoint,request_parameters,requested_at,response_received_at,duration_ms,http_status,response_headers,payload,payload_hash,schema_signature,parser_version,processing_status,error_information)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,'FAILED',$14::jsonb) RETURNING id`,
        [runId, source.rows[0].id, `${baseUrl}${item.path}`, json(item.parameters), result.requestedAt, result.receivedAt, result.durationMs,
          result.status, json(result.headers), result.payload === null ? null : json(result.payload), result.payload === null ? null : sha256(result.payload),
          shape?.signature ?? null, PARSER_VERSION, json({ message })],
      );
      failedIngestionId = failed.rows[0].id;
      await pool.query("UPDATE api_sources SET last_attempt_at=now() WHERE id=$1", [source.rows[0].id]);
    }
    await pool.query(
      `INSERT INTO ingestion_errors(run_id,source_id,ingestion_id,error_code,message,details) VALUES($1,$2,$3,'PROCESSING_FAILED',$4,$5::jsonb)`,
      [runId, source.rows[0]?.id ?? null, failedIngestionId, message, json({ path: item.path, parameters: item.parameters })],
    );
    throw error;
  } finally {
    client.release();
  }
}

function buildWork(periods: readonly string[] = PERIODS): WorkItem[] {
  const items: WorkItem[] = [{ sourceKey: "bounty_activity", path: "/api/game/bounty-hunting", parameters: {}, processor: "bounty" }];
  for (const id of BOUNTY_BOARD_IDS) {
    for (const period of periods) for (const subject of SUBJECTS) {
      const parameters = { id, period, subject };
      items.push({ sourceKey: "leaderboard", path: `/api/game/leaderboard?${new URLSearchParams(parameters)}`, parameters, processor: "leaderboard" });
    }
    const parameters = { id };
    items.push({ sourceKey: "leaderboard_wins", path: `/api/game/leaderboard-wins?${new URLSearchParams(parameters)}`, parameters, processor: "wins" });
  }
  return items;
}

async function runConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  }));
}

export async function runIngestion(runType: RunType = "ONCE", periods: readonly string[] = PERIODS): Promise<string> {
  const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES($1) RETURNING id", [runType]);
  const runId = run.rows[0].id;
  let requests = 0;
  let received = 0;
  let inserted = 0;
  let unchanged = 0;
  let revised = 0;
  let duplicates = 0;
  let errors = 0;
  const baseUrl = swgBaseUrl();

  const execute = async (item: WorkItem) => {
    requests += 1;
    try {
      const response = await fetchJson(`${baseUrl}${item.path}`);
      const counts = await archiveAndProcess(runId, item, response);
      received += counts.received;
      inserted += counts.inserted;
      unchanged += counts.unchanged;
      revised += counts.revised;
      duplicates += counts.duplicates;
    } catch (error) {
      errors += 1;
      process.stderr.write(`${item.path}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };

  try {
    await execute({ sourceKey: "board_catalog", path: "/api/game/leaderboards", parameters: {}, processor: "catalog" });
    const concurrency = Math.max(1, Math.min(4, Number(process.env.INGESTION_CONCURRENCY ?? 2)));
    await runConcurrent(buildWork(periods), concurrency, execute);
    const status = errors === 0 ? "SUCCEEDED" : errors < requests ? "PARTIAL" : "FAILED";
    await pool.query(
      `UPDATE ingestion_runs SET status=$2,finished_at=now(),requests=$3,received=$4,inserted=$5,unchanged=$6,revised=$7,duplicates_prevented=$8,errors=$9 WHERE id=$1`,
      [runId, status, requests, received, inserted, unchanged, revised, duplicates, errors],
    );
    if (status === "FAILED") throw new Error(`Ingestion ${runId} failed`);
    return runId;
  } catch (error) {
    await pool.query("UPDATE ingestion_runs SET status='FAILED',finished_at=now(),errors=GREATEST(errors,1) WHERE id=$1", [runId]);
    throw error;
  }
}

export async function ingestFixture(runId: string, sourceKey: SourceKey, processor: Processor, payload: unknown, parameters: Record<string, string> = {}): Promise<Counters> {
  const now = new Date();
  return archiveAndProcess(runId, { sourceKey, path: `/fixture/${sourceKey}`, parameters, processor }, {
    status: 200, headers: { "content-type": "application/json" }, payload, requestedAt: now, receivedAt: now, durationMs: 0,
  });
}
