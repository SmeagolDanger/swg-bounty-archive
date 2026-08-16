import type { PoolClient } from "pg";
import { ZodError } from "zod";
import { pool } from "@/lib/db/client";
import { GCW_FACTIONS, PARSER_VERSION, PERIODS, SUBJECTS, swgBaseUrl, TRACKED_BOARD_CATEGORIES, TRACKED_BOARD_IDS } from "./config";
import { diffSchema, encounterFingerprint, hasUnobservedArrayMembers, schemaSignature, sha256, type SchemaStructure } from "./hash";
import { fetchJson, type FetchResult } from "./fetcher";
import { boardCatalogSchema, bountySchema, leaderboardSchema, winsSchema, officersSchema, PARSER_NULLABLE_PATHS } from "./schemas";
import { findUnknownFields } from "./unknown-fields";
import { assessSourceIntegrity, classifyRunStatus, isDatabaseFailure, type IntegrityIssue, type SourceProcessor } from "./integrity";
import { errorLogContext, log } from "@/lib/observability/logger";

type RunType = "ONCE" | "POLL" | "BACKFILL" | "RECONCILE" | "INSPECT";
type SourceKey = "board_catalog" | "bounty_activity" | "leaderboard" | "leaderboard_wins" | "gcw_officers";
type Processor = SourceProcessor;

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

interface ProcessedSource extends Counters {
  qualityIssues: IntegrityIssue[];
}

export interface IngestionRunResult {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL";
}

class ArchivedIngestionError extends Error {
  constructor(
    message: string,
    readonly kind: "validation" | "http" | "database" | "processing" = "processing",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArchivedIngestionError";
  }
}

const json = (value: unknown) => JSON.stringify(value);

function schemaScope(item: WorkItem): string {
  // Query variants can have legitimately different nullable or empty shapes.
  // The work builder creates deterministic paths, so the path is a stable scope.
  return `${item.sourceKey}:${item.path}`;
}

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
  for (const board of data.boards.filter((item) => (TRACKED_BOARD_CATEGORIES as readonly string[]).includes(item.category))) {
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
  if (!TRACKED_BOARD_IDS.includes(data.id as (typeof TRACKED_BOARD_IDS)[number])) throw new Error(`Not an approved board: ${data.id}`);
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
  if (!TRACKED_BOARD_IDS.includes(data.id as (typeof TRACKED_BOARD_IDS)[number])) throw new Error(`Not an approved board: ${data.id}`);
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

async function processOfficers(client: PoolClient, payload: unknown, ingestionId: string, observedAt: Date): Promise<Counters> {
  const data = officersSchema.parse(payload);
  // One immutable snapshot per distinct registry state per faction; identical
  // re-observations dedupe on (faction, state_hash) like leaderboard snapshots.
  const stateHash = sha256({ faction: data.faction, totalResults: data.totalResults, officers: data.officers });
  const snapshot = await client.query<{ id: string }>(
    `INSERT INTO gcw_officer_snapshots(faction,total_results,state_hash,source_fetched_at,observed_at,source_ingestion_id,raw)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(faction,state_hash) DO NOTHING RETURNING id`,
    [data.faction, data.totalResults, stateHash, new Date(data.fetchedAt), observedAt, ingestionId, json(data)],
  );
  if (!snapshot.rows[0]) {
    return { received: data.officers.length, inserted: 0, unchanged: data.officers.length, revised: 0, duplicates: data.officers.length };
  }
  const snapshotId = snapshot.rows[0].id;
  let inserted = 0;
  let revised = 0;
  for (const officer of data.officers) {
    const participant = await upsertParticipant(client, "player", {
      participantId: officer.oid,
      name: officer.name,
      guildAbbreviation: officer.guildAbbreviation,
      faction: officer.factionName,
      planet: officer.residentPlanet,
      cityName: officer.residentCityName,
    }, ingestionId, officer);
    revised += participant.revised;
    const result = await client.query(
      `INSERT INTO gcw_officer_entries(snapshot_id,participant_id,source_participant_id,name,faction_name,rank_index,rank_name,
        current_gcw_points,current_pvp_kills,lifetime_gcw_points,lifetime_pvp_kills,
        profession,guild_name,guild_abbreviation,resident_planet,resident_city_name,source_ingestion_id,raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT(snapshot_id,source_participant_id) DO NOTHING RETURNING id`,
      [snapshotId, participant.id, officer.oid, officer.name, officer.factionName, officer.rankIndex, officer.rankName,
       officer.currentGcwPoints, officer.currentPvpKills, officer.lifetimeGcwPoints, officer.lifetimePvpKills,
       officer.profession, officer.guildName, officer.guildAbbreviation, officer.residentPlanet, officer.residentCityName,
       ingestionId, json(officer)],
    );
    if (result.rowCount) inserted += 1;
  }
  return { received: data.officers.length, inserted, unchanged: 0, revised, duplicates: 0 };
}

function validationDetails(error: unknown): { message: string; affectedPaths: string[] } {
  if (!(error instanceof ZodError)) return { message: error instanceof Error ? error.message : String(error), affectedPaths: [] };
  const affectedPaths = [...new Set(error.issues.map((issue) => issue.path.length ? `$.${issue.path.join(".")}` : "$"))].sort();
  const message = error.issues.slice(0, 8).map((issue) => `${issue.path.length ? `$.${issue.path.join(".")}` : "$"}: ${issue.message}`).join("; ");
  return { message, affectedPaths };
}

async function recordSchemaAndUnknownFields(
  runId: string,
  ingestionId: string,
  sourceId: string,
  item: WorkItem,
  payload: unknown,
  shape: ReturnType<typeof schemaSignature>,
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const scopeKey = schemaScope(item);
  const comparable = !hasUnobservedArrayMembers(shape.structure);
  const unknownFields = findUnknownFields(item.processor, payload);
  if (unknownFields.length) {
    const eventKey = `${item.sourceKey}:${sha256(unknownFields)}`;
    const event = await pool.query(
      `INSERT INTO data_quality_events(severity,event_type,entity_type,entity_key,details,source_ingestion_id)
       SELECT 'WARNING','SWG_API_UNKNOWN_FIELDS','api_source',$1,$2::jsonb,$3
       WHERE NOT EXISTS (SELECT 1 FROM data_quality_events WHERE event_type='SWG_API_UNKNOWN_FIELDS' AND entity_key=$1 AND resolved_at IS NULL)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [eventKey, json({ sourceKey: item.sourceKey, scopeKey, unknownFields }), ingestionId],
    );
    if (event.rowCount) {
      issues.push({ event: "source_integrity_failed", reason: "unexpected_fields", missing_fields: unknownFields });
      log.warn("source_fields_changed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, endpoint: item.path, status: "partial",
        parser_version: PARSER_VERSION, schema_signature: shape.signature, scope_key: scopeKey, unexpected_fields: unknownFields,
        message: "SWG Legends response contains unexpected fields",
      });
    }
  }

  const previous = await pool.query<{ signature: string; structure: SchemaStructure }>(
    `SELECT signature,structure FROM schema_signatures
     WHERE source_id=$1 AND scope_key=$2 AND ($3::boolean=false OR comparable) AND structure <> '{}'::jsonb
     ORDER BY last_seen_at DESC`,
    [sourceId, scopeKey, comparable],
  );
  const inserted = await pool.query<{ inserted: boolean }>(
    `INSERT INTO schema_signatures(source_id,scope_key,signature,field_paths,structure,comparable,first_ingestion_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
     ON CONFLICT(source_id,scope_key,signature) DO UPDATE SET last_seen_at=now(),occurrences=schema_signatures.occurrences+1
     RETURNING (xmax = 0) AS inserted`,
    [sourceId, scopeKey, shape.signature, json(shape.paths), json(shape.structure), comparable, ingestionId],
  );
  const prior = previous.rows[0];
  if (inserted.rows[0]?.inserted && prior && prior.signature !== shape.signature) {
    // Alert only when the source exhibits something never observed for this
    // scope across ALL known signatures: a brand-new path, a type never seen
    // on a path, or the disappearance of a path every prior variant carried.
    // Weekly-reset boards alternate between narrowed samples (small boards
    // whose nullable fields carry no nulls) and the refilled shapes, minting
    // new signature combinations that contain nothing new — those are
    // recorded silently as known variants.
    const knownStructure: SchemaStructure = {};
    const pathPresence = new Map<string, number>();
    for (const row of previous.rows) {
      for (const [path, types] of Object.entries(row.structure)) {
        knownStructure[path] = [...new Set([...(knownStructure[path] ?? []), ...types])];
        pathPresence.set(path, (pathPresence.get(path) ?? 0) + 1);
      }
    }
    const diff = diffSchema(knownStructure, shape.structure);
    const removedEverywhere = diff.removedPaths.filter((path) => pathPresence.get(path) === previous.rows.length);
    const widenedTypes = diff.changedTypes.filter((change) => change.to.some((type) =>
      !change.from.includes(type) && !(type === "null" && PARSER_NULLABLE_PATHS.has(change.path))));
    const meaningful = diff.addedPaths.length > 0 || removedEverywhere.length > 0 || widenedTypes.length > 0;
    if (!meaningful) return issues;
    const reported = { addedPaths: diff.addedPaths, removedPaths: removedEverywhere, changedTypes: widenedTypes };
    const details = {
      sourceKey: item.sourceKey,
      scopeKey,
      previousSignature: prior.signature,
      newSignature: shape.signature,
      ...reported,
      parserVersion: PARSER_VERSION,
    };
    const quality = await pool.query(
      `INSERT INTO data_quality_events(severity,event_type,entity_type,entity_key,details,source_ingestion_id)
       VALUES('WARNING','SWG_API_SCHEMA_CHANGE','api_source',$1,$2::jsonb,$3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`${item.sourceKey}:${sha256(reported)}`, json(details), ingestionId],
    );
    if (quality.rowCount) {
      issues.push({ event: "source_integrity_failed", reason: "source_schema_changed" });
      log.warn("source_schema_changed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, endpoint: item.path, status: "partial",
        parser_version: PARSER_VERSION, scope_key: scopeKey, previous_signature: prior.signature,
        schema_signature: shape.signature, missing_fields: reported.removedPaths, unexpected_fields: reported.addedPaths,
        changed_types: reported.changedTypes, message: "SWG Legends response structure changed",
      });
    }
  }
  return issues;
}

async function archiveAndProcess(runId: string, item: WorkItem, result: FetchResult): Promise<ProcessedSource> {
  const baseUrl = swgBaseUrl();
  const source = await pool.query<{ id: string }>("SELECT id FROM api_sources WHERE source_key=$1", [item.sourceKey]);
  if (!source.rows[0]) throw new Error(`Unknown API source ${item.sourceKey}`);
  const sourceId = source.rows[0].id;
  const shape = result.payload === null ? null : schemaSignature(result.payload);
  const initialStatus = result.status >= 200 && result.status < 300 ? "RECEIVED" : "HTTP_ERROR";
  const payloadHash = result.payload === null ? null : sha256(result.payload);
  // Payload bytes are content-addressed: one payload_blobs row per unique
  // hash, referenced by every api_ingestions row that observed that content.
  if (payloadHash !== null) {
    await pool.query(
      "INSERT INTO payload_blobs(payload_hash,payload) VALUES($1,$2::jsonb) ON CONFLICT (payload_hash) DO NOTHING",
      [payloadHash, json(result.payload)],
    );
  }
  const ingestion = await pool.query<{ id: string }>(
    `INSERT INTO api_ingestions(run_id,source_id,endpoint,request_parameters,requested_at,response_received_at,duration_ms,http_status,response_headers,payload_hash,schema_signature,parser_version,processing_status)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) RETURNING id`,
    [runId, sourceId, `${baseUrl}${item.path}`, json(item.parameters), result.requestedAt, result.receivedAt, result.durationMs, result.status,
      json(result.headers), payloadHash, shape?.signature ?? null,
      PARSER_VERSION, initialStatus],
  );
  const ingestionId = ingestion.rows[0].id;
  let qualityIssues: IntegrityIssue[] = [];
  await pool.query("UPDATE api_sources SET last_attempt_at=now() WHERE id=$1", [sourceId]);
  if (result.status >= 200 && result.status < 300 && result.payload !== null && shape) {
    try {
      qualityIssues = await recordSchemaAndUnknownFields(runId, ingestionId, sourceId, item, result.payload, shape);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = "SCHEMA_OBSERVATION_FAILED";
      log.error("database_transaction_failed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, endpoint: item.path, status: "failed",
        http_status: result.status, duration_ms: result.durationMs, parser_version: PARSER_VERSION,
        schema_signature: shape.signature, reason: "schema_observation_failed", error_type: errorCode,
        error_message: errorMessage, ...errorLogContext(error),
      });
      try {
        await pool.query(
          "UPDATE api_ingestions SET processing_status='FAILED',error_information=$2::jsonb WHERE id=$1",
          [ingestionId, json({ errorCode, message: errorMessage })],
        );
        await pool.query(
          `INSERT INTO ingestion_errors(run_id,source_id,ingestion_id,error_code,message,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [runId, sourceId, ingestionId, errorCode, errorMessage, json({ path: item.path, parameters: item.parameters })],
        );
      } catch (auditError) {
        log.error("database_transaction_failed", {
          run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, status: "failed",
          reason: "schema_failure_audit_write_failed", ...errorLogContext(auditError),
        });
      }
      throw new ArchivedIngestionError(errorMessage, "database", { cause: error });
    }
  }

  if (result.status < 200 || result.status >= 300) {
    const message = `SWG returned HTTP ${result.status}`;
    log.warn(result.status === 429 ? "api_rate_limited" : "api_http_error", {
      run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, endpoint: item.path, status: "failed",
      http_status: result.status, duration_ms: result.durationMs, parser_version: PARSER_VERSION,
      schema_signature: shape?.signature, reason: result.status === 429 ? "api_rate_limited" : "http_error",
      error_type: result.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", error_message: message,
    });
    try {
      await pool.query(
        `INSERT INTO ingestion_errors(run_id,source_id,ingestion_id,error_code,message,details) VALUES($1,$2,$3,'HTTP_ERROR',$4,$5::jsonb)`,
        [runId, sourceId, ingestionId, message, json({ path: item.path, parameters: item.parameters, httpStatus: result.status })],
      );
    } catch (auditError) {
      log.error("database_transaction_failed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, status: "failed",
        reason: "http_failure_audit_write_failed", ...errorLogContext(auditError),
      });
    }
    throw new ArchivedIngestionError(message, "http");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let counters: Counters;
    if (item.processor === "catalog") counters = await processCatalog(client, result.payload, ingestionId);
    else if (item.processor === "leaderboard") counters = await processLeaderboard(client, result.payload, ingestionId, result.receivedAt);
    else if (item.processor === "wins") counters = await processWins(client, result.payload, ingestionId, result.receivedAt);
    else if (item.processor === "officers") counters = await processOfficers(client, result.payload, ingestionId, result.receivedAt);
    else counters = await processBounty(client, result.payload, ingestionId, result.receivedAt);
    await client.query("UPDATE api_ingestions SET processing_status='PROCESSED' WHERE id=$1", [ingestionId]);
    await client.query("UPDATE api_sources SET last_success_at=now(),last_attempt_at=now() WHERE id=$1", [sourceId]);
    await client.query("UPDATE ingestion_errors SET resolved_at=now() WHERE source_id=$1 AND resolved_at IS NULL", [sourceId]);
    await client.query("COMMIT");
    return { ...counters, qualityIssues };
  } catch (error) {
    const details = validationDetails(error);
    const errorCode = error instanceof ZodError ? "VALIDATION_FAILED" : "PROCESSING_FAILED";
    const context = {
      run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, endpoint: item.path, status: "failed",
      http_status: result.status, duration_ms: result.durationMs, parser_version: PARSER_VERSION,
      schema_signature: shape?.signature, reason: errorCode.toLowerCase(), error_type: errorCode, error_message: details.message,
      missing_fields: details.affectedPaths, ...errorLogContext(error),
    };
    if (error instanceof ZodError) log.error("source_validation_failed", context);
    else if (isDatabaseFailure(error)) log.error("database_transaction_failed", context);
    else log.error("source_processing_failed", context);
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error("database_transaction_failed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, status: "failed",
        reason: "transaction_rollback_failed", ...errorLogContext(rollbackError),
      });
    }
    try {
      await pool.query("UPDATE api_ingestions SET processing_status='FAILED',error_information=$2::jsonb WHERE id=$1", [ingestionId, json({ errorCode, ...details })]);
      await pool.query(
        `INSERT INTO ingestion_errors(run_id,source_id,ingestion_id,error_code,message,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [runId, sourceId, ingestionId, errorCode, details.message, json({ path: item.path, parameters: item.parameters, affectedPaths: details.affectedPaths })],
      );
    } catch (auditError) {
      log.error("database_transaction_failed", {
        run_id: runId, ingestion_id: ingestionId, source: item.sourceKey, status: "failed",
        reason: "failure_audit_write_failed", ...errorLogContext(auditError),
      });
    }
    throw new ArchivedIngestionError(
      details.message,
      error instanceof ZodError ? "validation" : isDatabaseFailure(error) ? "database" : "processing",
      { cause: error },
    );
  } finally {
    client.release();
  }
}

function buildWork(periods: readonly string[] = PERIODS): WorkItem[] {
  const items: WorkItem[] = [{ sourceKey: "bounty_activity", path: "/api/game/bounty-hunting", parameters: {}, processor: "bounty" }];
  for (const id of TRACKED_BOARD_IDS) {
    for (const period of periods) for (const subject of SUBJECTS) {
      const parameters = { id, period, subject };
      items.push({ sourceKey: "leaderboard", path: `/api/game/leaderboard?${new URLSearchParams(parameters)}`, parameters, processor: "leaderboard" });
    }
    const parameters = { id };
    items.push({ sourceKey: "leaderboard_wins", path: `/api/game/leaderboard-wins?${new URLSearchParams(parameters)}`, parameters, processor: "wins" });
  }
  for (const faction of GCW_FACTIONS) {
    const parameters = { faction };
    items.push({ sourceKey: "gcw_officers", path: `/api/game/gcw-officers?${new URLSearchParams(parameters)}`, parameters, processor: "officers" });
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

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s*out|timeout/i.test(error.message);
}

async function recordTransportFailure(runId: string, item: WorkItem, error: unknown): Promise<void> {
  const timeout = isTimeoutError(error);
  const errorCode = timeout ? "TIMEOUT" : "TRANSPORT_ERROR";
  const errorMessage = error instanceof Error ? error.message : String(error);
  try {
    const source = await pool.query<{ id: string }>("SELECT id FROM api_sources WHERE source_key=$1", [item.sourceKey]);
    if (source.rows[0]) await pool.query("UPDATE api_sources SET last_attempt_at=now() WHERE id=$1", [source.rows[0].id]);
    await pool.query(
      `INSERT INTO ingestion_errors(run_id,source_id,error_code,message,details) VALUES($1,$2,$3,$4,$5::jsonb)`,
      [runId, source.rows[0]?.id ?? null, errorCode, errorMessage, json({ path: item.path, parameters: item.parameters })],
    );
  } catch (databaseError) {
    log.error("database_transaction_failed", {
      run_id: runId, source: item.sourceKey, source_instance: item.path, status: "failed",
      reason: "transport_failure_audit_write_failed", ...errorLogContext(databaseError),
    });
  }
  const context = {
    run_id: runId, source: item.sourceKey, endpoint: item.path, status: "failed", parser_version: PARSER_VERSION,
    error_type: errorCode, error_message: errorMessage, ...errorLogContext(error),
  };
  if (timeout) log.warn("api_timeout", context);
  else log.error("api_transport_error", context);
}

export async function runIngestion(runType: RunType = "ONCE", periods: readonly string[] = PERIODS): Promise<IngestionRunResult> {
  const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES($1) RETURNING id", [runType]);
  const runId = run.rows[0].id;
  const startedAt = new Date();
  let requests = 0;
  let expectedRecords = 0;
  let received = 0;
  let inserted = 0;
  let unchanged = 0;
  let revised = 0;
  let duplicates = 0;
  let errors = 0;
  let rejectedRecords = 0;
  let partialSources = 0;
  const baseUrl = swgBaseUrl();
  let finalized = false;
  log.info("ingestion_started", {
    run_id: runId,
    run_type: runType.toLowerCase(),
    source: "all",
    status: "running",
    started_at: startedAt.toISOString(),
  });

  const execute = async (item: WorkItem) => {
    requests += 1;
    const sourceStartedAt = new Date();
    let responseReceived = false;
    try {
      const response = await fetchJson(`${baseUrl}${item.path}`);
      responseReceived = true;
      const counts = await archiveAndProcess(runId, item, response);
      const integrity = assessSourceIntegrity(item.processor, response.payload);
      const issues = [...counts.qualityIssues, ...integrity.issues];
      const sourceStatus = issues.length ? "partial" : "success";
      if (sourceStatus === "partial") partialSources += 1;
      expectedRecords += integrity.expected_records;
      received += counts.received;
      inserted += counts.inserted;
      unchanged += counts.unchanged;
      revised += counts.revised;
      duplicates += counts.duplicates;

      for (const issue of integrity.issues.filter((entry) => entry.event === "pagination_incomplete")) {
        log.warn("pagination_incomplete", {
          run_id: runId, source: item.sourceKey, source_instance: item.path, status: "partial",
          started_at: sourceStartedAt.toISOString(), completed_at: new Date().toISOString(),
          ...issue,
        });
      }

      const summary = {
        run_id: runId,
        run_type: runType.toLowerCase(),
        source: item.sourceKey,
        source_instance: item.path,
        status: sourceStatus,
        started_at: sourceStartedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - sourceStartedAt.getTime(),
        expected_records: integrity.expected_records,
        received_records: integrity.received_records,
        inserted_records: counts.inserted,
        updated_records: counts.revised,
        unchanged_records: counts.unchanged,
        rejected_records: 0,
        duplicate_records: counts.duplicates,
        ...(issues.length ? { reason: issues.map((issue) => issue.reason), issue_count: issues.length } : {}),
      };
      if (sourceStatus === "partial") log.warn("ingestion_complete", summary);
      else log.info("ingestion_complete", summary);
    } catch (error) {
      errors += 1;
      if (error instanceof ArchivedIngestionError && error.kind === "validation") rejectedRecords += 1;
      if (!(error instanceof ArchivedIngestionError)) {
        if (responseReceived) {
          log.error("database_transaction_failed", {
            run_id: runId, source: item.sourceKey, source_instance: item.path, status: "failed",
            reason: "archive_or_database_write_failed", ...errorLogContext(error),
          });
        } else {
          await recordTransportFailure(runId, item, error);
        }
      }
      log.error("ingestion_complete", {
        run_id: runId,
        run_type: runType.toLowerCase(),
        source: item.sourceKey,
        source_instance: item.path,
        status: "failed",
        started_at: sourceStartedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - sourceStartedAt.getTime(),
        expected_records: 0,
        received_records: 0,
        inserted_records: 0,
        updated_records: 0,
        unchanged_records: 0,
        rejected_records: error instanceof ArchivedIngestionError && error.kind === "validation" ? 1 : 0,
        duplicate_records: 0,
        reason: error instanceof ArchivedIngestionError ? error.kind : "transport",
        ...errorLogContext(error),
      });
    }
  };

  try {
    await execute({ sourceKey: "board_catalog", path: "/api/game/leaderboards", parameters: {}, processor: "catalog" });
    const configuredConcurrency = Number(process.env.INGESTION_CONCURRENCY ?? 2);
    const concurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(4, configuredConcurrency)) : 2;
    await runConcurrent(buildWork(periods), concurrency, execute);
    const status = classifyRunStatus(requests, errors, partialSources);
    await pool.query(
      `UPDATE ingestion_runs SET status=$2,finished_at=now(),requests=$3,received=$4,inserted=$5,unchanged=$6,revised=$7,duplicates_prevented=$8,errors=$9 WHERE id=$1`,
      [runId, status, requests, received, inserted, unchanged, revised, duplicates, errors],
    );
    finalized = true;
    const completedAt = new Date();
    const summary = {
      run_id: runId,
      run_type: runType.toLowerCase(),
      source: "all",
      status: status === "SUCCEEDED" ? "success" : status.toLowerCase(),
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      request_count: requests,
      expected_records: expectedRecords,
      received_records: received,
      inserted_records: inserted,
      updated_records: revised,
      unchanged_records: unchanged,
      rejected_records: rejectedRecords,
      duplicate_records: duplicates,
      partial_sources: partialSources,
      failed_sources: errors,
      ...(status === "PARTIAL" ? {
        reason: [errors > 0 ? "source_failures" : null, partialSources > 0 ? "source_integrity_warnings" : null].filter(Boolean),
      } : {}),
      ...(status === "FAILED" ? { reason: "all_requests_failed", error_message: `All ${requests} requests failed` } : {}),
    };
    if (status === "SUCCEEDED") log.info("ingestion_run_complete", summary);
    else if (status === "PARTIAL") log.warn("ingestion_run_complete", summary);
    else log.error("ingestion_run_complete", summary);
    if (status === "FAILED") throw new ArchivedIngestionError(`Ingestion ${runId} failed`);
    return { runId, status };
  } catch (error) {
    if (!finalized) {
      try {
        await pool.query("UPDATE ingestion_runs SET status='FAILED',finished_at=now(),errors=GREATEST(errors,1) WHERE id=$1", [runId]);
      } catch (databaseError) {
        log.error("database_transaction_failed", {
          run_id: runId, source: "ingestion_runs", status: "failed", reason: "run_finalization_failed",
          ...errorLogContext(databaseError),
        });
      }
      const completedAt = new Date();
      log.error("ingestion_run_complete", {
        run_id: runId, run_type: runType.toLowerCase(), source: "all", status: "failed",
        started_at: startedAt.toISOString(), completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - startedAt.getTime(), request_count: requests,
        expected_records: expectedRecords, received_records: received, inserted_records: inserted,
        updated_records: revised, unchanged_records: unchanged, rejected_records: rejectedRecords,
        duplicate_records: duplicates, partial_sources: partialSources, failed_sources: Math.max(errors, 1),
        reason: "run_aborted", ...errorLogContext(error),
      });
    }
    throw error;
  }
}

export async function ingestFixture(runId: string, sourceKey: SourceKey, processor: Processor, payload: unknown, parameters: Record<string, string> = {}): Promise<Counters> {
  const now = new Date();
  return archiveAndProcess(runId, { sourceKey, path: `/fixture/${sourceKey}`, parameters, processor }, {
    status: 200, headers: { "content-type": "application/json" }, payload, requestedAt: now, receivedAt: now, durationMs: 0,
  });
}
