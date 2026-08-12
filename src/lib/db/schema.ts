import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const apiSources = pgTable("api_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().unique(),
  baseUrl: text("base_url").notNull(),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull().default("GET"),
  enabled: boolean("enabled").notNull().default(true),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(300),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: created(),
});

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runType: text("run_type").notNull(),
  status: text("status").notNull().default("RUNNING"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  requests: integer("requests").notNull().default(0),
  received: integer("received").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  unchanged: integer("unchanged").notNull().default(0),
  revised: integer("revised").notNull().default(0),
  duplicatesPrevented: integer("duplicates_prevented").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
});

export const apiIngestions = pgTable("api_ingestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  sourceId: uuid("source_id").notNull(),
  endpoint: text("endpoint").notNull(),
  requestParameters: jsonb("request_parameters").notNull().default({}),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  responseReceivedAt: timestamp("response_received_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  httpStatus: integer("http_status").notNull(),
  responseHeaders: jsonb("response_headers").notNull(),
  payload: jsonb("payload"),
  payloadHash: text("payload_hash"),
  schemaSignature: text("schema_signature"),
  parserVersion: text("parser_version").notNull(),
  processingStatus: text("processing_status").notNull(),
  errorInformation: jsonb("error_information"),
  createdAt: created(),
}, (table) => [index("api_ingestions_received_idx").on(table.responseReceivedAt)]);

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantType: text("participant_type").notNull(),
  sourceParticipantId: text("source_participant_id").notNull(),
  currentName: text("current_name").notNull(),
  guildAbbreviation: text("guild_abbreviation"),
  faction: text("faction"),
  planet: text("planet"),
  cityName: text("city_name"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  sourceIngestionId: uuid("source_ingestion_id").notNull(),
  raw: jsonb("raw").notNull(),
}, (table) => [unique().on(table.participantType, table.sourceParticipantId)]);

export const bountyEncounters = pgTable("bounty_encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  fingerprint: text("fingerprint").notNull().unique(),
  eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
  outcome: text("outcome").notNull(),
  hunterName: text("hunter_name").notNull(),
  targetName: text("target_name").notNull(),
  credits: bigint("credits", { mode: "number" }).notNull(),
  sourceIngestionId: uuid("source_ingestion_id").notNull(),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
  raw: jsonb("raw").notNull(),
}, (table) => [
  index("bounty_encounters_event_at_idx").on(table.eventAt),
  check("credits_nonnegative", sql`${table.credits} >= 0`),
]);

export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  leaderboardId: text("leaderboard_id").notNull(),
  periodId: uuid("period_id").notNull(),
  subject: text("subject").notNull(),
  totalScore: numeric("total_score", { precision: 30, scale: 6 }).notNull(),
  valueType: text("value_type").notNull(),
  stateHash: text("state_hash").notNull(),
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  sourceIngestionId: uuid("source_ingestion_id").notNull(),
  raw: jsonb("raw").notNull(),
}, (table) => [unique().on(table.leaderboardId, table.periodId, table.subject, table.stateHash)]);
