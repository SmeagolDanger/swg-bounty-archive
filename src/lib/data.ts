import { pool } from "@/lib/db/client";
import { deriveRivalryMetrics } from "@/lib/analytics/metrics";
import { BOUNTY_BOARD_IDS, GCW_BOARD_IDS, PERIODS, SUBJECTS, TRACKED_BOARD_IDS } from "@/lib/ingestion/config";
export { ALL_BOARD_LABELS, BOARD_LABELS, GCW_BOARD_FACTIONS, GCW_BOARD_LABELS } from "@/lib/constants";

export const isBoard = (value: string): value is (typeof TRACKED_BOARD_IDS)[number] => TRACKED_BOARD_IDS.includes(value as (typeof TRACKED_BOARD_IDS)[number]);

// GCW boards and the officer registries share the participants table, so
// "tracked" counts must stay scoped to participants observed on a bounty
// board (entries or wins) or they inflate with GCW-only players/guilds/cities.
const BOUNTY_BOARD_SQL_LIST = BOUNTY_BOARD_IDS.map((id) => `'${id}'`).join(",");
const bountyBoardPresence = (alias: string) =>
  `(EXISTS (SELECT 1 FROM leaderboard_entries be_e JOIN leaderboard_snapshots be_s ON be_s.id=be_e.snapshot_id
              WHERE be_e.participant_id=${alias}.id AND be_s.leaderboard_id IN (${BOUNTY_BOARD_SQL_LIST}))
      OR EXISTS (SELECT 1 FROM leaderboard_wins be_w WHERE be_w.participant_id=${alias}.id AND be_w.leaderboard_id IN (${BOUNTY_BOARD_SQL_LIST})))`;
const countBountyParticipants = (type: "player" | "guild" | "city") => {
  // Players also count when their name appears as a hunter in the encounter
  // archive — encounters carry names only, so this is name-matched.
  const encounterMatch = type === "player"
    ? ` OR EXISTS (SELECT 1 FROM bounty_encounters be_n WHERE lower(be_n.hunter_name)=lower(bp.current_name))`
    : "";
  return `(SELECT count(*)::int FROM participants bp WHERE bp.participant_type='${type}' AND (${bountyBoardPresence("bp")}${encounterMatch}))`;
};
export const isPeriod = (value: string): value is (typeof PERIODS)[number] => PERIODS.includes(value as (typeof PERIODS)[number]);
export const isSubject = (value: string): value is (typeof SUBJECTS)[number] => SUBJECTS.includes(value as (typeof SUBJECTS)[number]);

// Guards for values that reach SQL casts directly from URLs: reject instead of erroring the query.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID_PATTERN.test(value);
const isoDate = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;

// Date filters are interpreted in the visitor's timezone so day boundaries match the
// timestamps the UI displays. Only known IANA names ever reach AT TIME ZONE.
let knownTimeZones: Set<string> | null = null;
export function isTimeZone(value: string): boolean {
  knownTimeZones ??= new Set(Intl.supportedValuesOf("timeZone"));
  return knownTimeZones.has(value) || value === "UTC";
}
const timeZoneOf = (value: string | undefined) => value && isTimeZone(value) ? value : "UTC";

export interface EncounterHunterStats {
  cycle_starts_at: Date | string | null;
  cycle_ends_at: Date | string | null;
  cycle_encounters: number;
  cycle_kills: number;
  cycle_deaths: number;
  cycle_failures: number;
  cycle_credits: number;
  overall_encounters: number;
  overall_kills: number;
  overall_deaths: number;
  overall_failures: number;
  overall_credits: number;
}

async function attachHunterStats<T extends Record<string, unknown>>(encounters: T[]): Promise<Array<T & { hunter_stats: EncounterHunterStats | null }>> {
  const hunterKeys = [...new Set(encounters.map((row) => String(row.hunter_name ?? "").trim().toLocaleLowerCase()).filter(Boolean))];
  if (!hunterKeys.length) return encounters.map((row) => ({ ...row, hunter_stats: null }));

  const stats = await pool.query<EncounterHunterStats & { hunter_key: string }>(`WITH current_cycle AS (
      SELECT lp.starts_at,lp.ends_at
      FROM leaderboard_snapshots s
      JOIN leaderboard_periods lp ON lp.id=s.period_id
      WHERE s.subject='player' AND s.leaderboard_id IN (${BOUNTY_BOARD_SQL_LIST}) AND lp.source_period_key='CURRENT'
      ORDER BY s.observed_at DESC
      LIMIT 1
    ), actor_events AS (
      SELECT lower(hunter_name) AS hunter_key,event_at,1 AS hunter_encounter,
        (outcome='KILL')::int AS kill,(outcome='FAILED')::int AS failure,0 AS death,
        CASE WHEN outcome='KILL' THEN credits ELSE 0 END AS credits
      FROM bounty_encounters WHERE lower(hunter_name)=ANY($1::text[])
      UNION ALL
      SELECT lower(target_name) AS hunter_key,event_at,0 AS hunter_encounter,
        0 AS kill,0 AS failure,(outcome='KILL')::int AS death,0 AS credits
      FROM bounty_encounters WHERE lower(target_name)=ANY($1::text[])
    )
    SELECT ae.hunter_key,
      cc.starts_at AS cycle_starts_at,cc.ends_at AS cycle_ends_at,
      coalesce(sum(ae.hunter_encounter) FILTER(WHERE cc.starts_at IS NOT NULL AND ae.event_at>=cc.starts_at AND (cc.ends_at IS NULL OR ae.event_at<cc.ends_at)),0)::int AS cycle_encounters,
      coalesce(sum(ae.kill) FILTER(WHERE cc.starts_at IS NOT NULL AND ae.event_at>=cc.starts_at AND (cc.ends_at IS NULL OR ae.event_at<cc.ends_at)),0)::int AS cycle_kills,
      coalesce(sum(ae.death) FILTER(WHERE cc.starts_at IS NOT NULL AND ae.event_at>=cc.starts_at AND (cc.ends_at IS NULL OR ae.event_at<cc.ends_at)),0)::int AS cycle_deaths,
      coalesce(sum(ae.failure) FILTER(WHERE cc.starts_at IS NOT NULL AND ae.event_at>=cc.starts_at AND (cc.ends_at IS NULL OR ae.event_at<cc.ends_at)),0)::int AS cycle_failures,
      coalesce(sum(ae.credits) FILTER(WHERE cc.starts_at IS NOT NULL AND ae.event_at>=cc.starts_at AND (cc.ends_at IS NULL OR ae.event_at<cc.ends_at)),0)::float8 AS cycle_credits,
      sum(ae.hunter_encounter)::int AS overall_encounters,
      sum(ae.kill)::int AS overall_kills,
      sum(ae.death)::int AS overall_deaths,
      sum(ae.failure)::int AS overall_failures,
      coalesce(sum(ae.credits),0)::float8 AS overall_credits
    FROM actor_events ae
    LEFT JOIN current_cycle cc ON true
    GROUP BY ae.hunter_key,cc.starts_at,cc.ends_at`, [hunterKeys]);
  const byHunter = new Map(stats.rows.map(({ hunter_key, ...row }) => [hunter_key, row]));
  return encounters.map((row) => ({ ...row, hunter_stats: byHunter.get(String(row.hunter_name ?? "").trim().toLocaleLowerCase()) ?? null }));
}

export async function getDashboard() {
  const [stats, recent, top, activity, activeGroups, ingestion] = await Promise.all([
    pool.query(`SELECT
      (SELECT count(*)::int FROM bounty_encounters) AS encounters,
      (SELECT count(*)::int FROM bounty_encounters WHERE event_at >= date_trunc('day',now())) AS encounters_today,
      (SELECT count(*)::int FROM bounty_encounters WHERE event_at >= now()-interval '7 days') AS encounters_week,
      ${countBountyParticipants("player")} AS hunters,
      ${countBountyParticipants("guild")} AS guilds,
      ${countBountyParticipants("city")} AS cities,
      (SELECT min(event_at) FROM bounty_encounters) AS history_start`),
    pool.query(`SELECT be.id,be.event_at,be.outcome,be.hunter_name,be.target_name,be.credits,
      hunter.id AS hunter_participant_id,target.id AS target_participant_id
      FROM bounty_encounters be
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.hunter_name) ORDER BY last_seen_at DESC LIMIT 1) hunter ON true
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.target_name) ORDER BY last_seen_at DESC LIMIT 1) target ON true
      ORDER BY be.event_at DESC LIMIT 12`),
    pool.query(`WITH latest AS (
        SELECT DISTINCT ON (s.leaderboard_id) s.id,s.leaderboard_id,s.value_type
        FROM leaderboard_snapshots s JOIN leaderboard_periods p ON p.id=s.period_id
        WHERE s.subject='player' AND p.source_period_key='CURRENT'
        ORDER BY s.leaderboard_id,s.observed_at DESC
      )
      SELECT l.leaderboard_id,l.value_type,e.rank,e.score::float8,e.score_raw,p.id AS participant_id,p.current_name,p.guild_abbreviation,p.city_name
      FROM latest l JOIN leaderboard_entries e ON e.snapshot_id=l.id JOIN participants p ON p.id=e.participant_id
      WHERE e.rank <= 5 ORDER BY l.leaderboard_id,e.rank`),
    pool.query(`SELECT date_trunc('day',event_at)::date::text AS day,
      count(*)::int AS encounters,count(*) FILTER(WHERE outcome='KILL')::int AS kills,
      coalesce(sum(credits) FILTER(WHERE outcome='KILL'),0)::float8 AS credits
      FROM bounty_encounters WHERE event_at >= now()-interval '30 days' GROUP BY 1 ORDER BY 1`),
    pool.query(`WITH latest AS (
      SELECT DISTINCT ON (s.leaderboard_id,s.subject) s.id,s.subject
      FROM leaderboard_snapshots s JOIN leaderboard_periods p ON p.id=s.period_id
      WHERE s.leaderboard_id='BOUNTY_HUNTER_TOTAL_KILLS' AND p.source_period_key='CURRENT' AND s.subject IN ('guild','city')
      ORDER BY s.leaderboard_id,s.subject,s.observed_at DESC)
      SELECT l.subject,p.id,p.current_name,e.rank,e.score::float8 AS score,p.planet,p.guild_abbreviation
      FROM latest l JOIN leaderboard_entries e ON e.snapshot_id=l.id JOIN participants p ON p.id=e.participant_id
      WHERE e.rank<=5 ORDER BY l.subject,e.rank`),
    pool.query(`SELECT max(response_received_at) FILTER(WHERE processing_status='PROCESSED') AS last_verified,
      (SELECT count(*)::int FROM ingestion_errors WHERE resolved_at IS NULL) AS failed_ingestions FROM api_ingestions`),
  ]);
  return { stats: stats.rows[0], recent: await attachHunterStats(recent.rows), top: top.rows, activity: activity.rows, activeGroups: activeGroups.rows, ingestion: ingestion.rows[0] };
}

export interface EncounterFilters {
  q?: string;
  outcome?: string;
  minCredits?: number;
  maxCredits?: number;
  from?: string;
  to?: string;
  tz?: string;
  page?: number;
  pageSize?: number;
}

export async function getEncounters(filters: EncounterFilters) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.q) conditions.push(`(hunter_name ILIKE ${bind(`%${filters.q}%`)} OR target_name ILIKE ${bind(`%${filters.q}%`)})`);
  if (filters.outcome === "KILL" || filters.outcome === "FAILED") conditions.push(`outcome=${bind(filters.outcome)}`);
  if (Number.isFinite(filters.minCredits)) conditions.push(`credits>=${bind(filters.minCredits)}`);
  if (Number.isFinite(filters.maxCredits)) conditions.push(`credits<=${bind(filters.maxCredits)}`);
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const timeZone = timeZoneOf(filters.tz);
  if (from) conditions.push(`event_at>=(${bind(from)}::date::timestamp AT TIME ZONE ${bind(timeZone)})`);
  if (to) conditions.push(`event_at<((${bind(to)}::date + interval '1 day') AT TIME ZONE ${bind(timeZone)})`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);
  const count = await pool.query(`SELECT count(*)::int AS count FROM bounty_encounters ${where}`, values);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = await pool.query(
    `SELECT be.id,be.event_at,be.outcome,be.hunter_name,be.target_name,be.credits,be.fingerprint,
      hunter.id AS hunter_participant_id,target.id AS target_participant_id
     FROM bounty_encounters be
     LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.hunter_name) ORDER BY last_seen_at DESC LIMIT 1) hunter ON true
     LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.target_name) ORDER BY last_seen_at DESC LIMIT 1) target ON true
     ${where} ORDER BY be.event_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { rows: await attachHunterStats(rows.rows), total: count.rows[0].count as number, page, pageSize };
}

export interface HunterDirectoryFilters {
  q?: string;
  activity?: "all" | "seen" | "unseen";
  sort?: "name" | "winRate" | "encounters" | "credits" | "lastActive";
  page?: number;
  pageSize?: number;
}

export async function getHunterDirectory(filters: HunterDirectoryFilters = {}) {
  const values: unknown[] = [];
  // The Hunters directory shows bounty-relevant players only: on a bounty
  // board or present in the encounter archive. GCW-only participants keep
  // their dossiers (reachable via search and guild/officer links) but are
  // not listed here.
  const conditions = ["p.participant_type='player'", `(em.hunter_key IS NOT NULL OR ${bountyBoardPresence("p")})`];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.q?.trim()) conditions.push(`(p.current_name ILIKE ${bind(`%${filters.q.trim()}%`)} OR p.guild_abbreviation ILIKE ${bind(`%${filters.q.trim()}%`)})`);
  if (filters.activity === "seen") conditions.push("em.encounters > 0");
  if (filters.activity === "unseen") conditions.push("em.encounters IS NULL");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);
  const order = {
    name: "p.current_name ASC",
    winRate: "win_rate DESC NULLS LAST, encounters DESC, p.current_name ASC",
    encounters: "encounters DESC NULLS LAST, p.current_name ASC",
    credits: "credits_claimed DESC NULLS LAST, p.current_name ASC",
    lastActive: "last_active_at DESC NULLS LAST, p.current_name ASC",
  }[filters.sort ?? "encounters"];
  const ctes = `WITH encounter_metrics AS (
      SELECT lower(hunter_name) AS hunter_key,count(*)::int AS encounters,
        count(*) FILTER(WHERE outcome='KILL')::int AS wins,
        count(*) FILTER(WHERE outcome='FAILED')::int AS losses,
        CASE WHEN count(*)>0 THEN count(*) FILTER(WHERE outcome='KILL')::float8/count(*) ELSE NULL END AS win_rate,
        coalesce(sum(credits) FILTER(WHERE outcome='KILL'),0)::float8 AS credits_claimed,
        max(credits) FILTER(WHERE outcome='KILL')::float8 AS highest_bounty,
        count(DISTINCT event_at::date)::int AS active_days,
        count(DISTINCT lower(target_name))::int AS unique_targets,
        max(event_at) AS last_active_at
      FROM bounty_encounters GROUP BY lower(hunter_name)
    ), latest_boards AS (
      SELECT DISTINCT ON (s.leaderboard_id,e.participant_id)
        s.leaderboard_id,e.participant_id,e.rank,e.score::float8 AS score,e.score_raw
      FROM leaderboard_entries e
      JOIN leaderboard_snapshots s ON s.id=e.snapshot_id
      JOIN leaderboard_periods lp ON lp.id=s.period_id
      WHERE s.subject='player' AND lp.source_period_key='CURRENT'
      ORDER BY s.leaderboard_id,e.participant_id,s.observed_at DESC
    ), board_values AS (
      SELECT participant_id,
        max(rank) FILTER(WHERE leaderboard_id='BOUNTY_HUNTER_TOTAL_KILLS') AS total_kills_rank,
        max(score) FILTER(WHERE leaderboard_id='BOUNTY_HUNTER_TOTAL_KILLS') AS total_kills_score,
        max(rank) FILTER(WHERE leaderboard_id='BOUNTY_HUNTER_UNIQUE_KILLS') AS unique_kills_rank,
        max(score) FILTER(WHERE leaderboard_id='BOUNTY_HUNTER_UNIQUE_KILLS') AS unique_kills_score
      FROM latest_boards GROUP BY participant_id
    )`;
  const count = await pool.query(`${ctes} SELECT count(*)::int AS count FROM participants p LEFT JOIN encounter_metrics em ON em.hunter_key=lower(p.current_name) ${where}`, values);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = await pool.query(`${ctes}
    SELECT p.id,p.current_name,p.guild_abbreviation,p.faction,p.city_name,p.first_seen_at,p.last_seen_at,guild.id AS guild_id,
      bv.total_kills_rank,bv.total_kills_score,bv.unique_kills_rank,bv.unique_kills_score,
      coalesce(em.encounters,0)::int AS encounters,coalesce(em.wins,0)::int AS wins,coalesce(em.losses,0)::int AS losses,
      em.win_rate,coalesce(em.credits_claimed,0)::float8 AS credits_claimed,em.highest_bounty,
      coalesce(em.active_days,0)::int AS active_days,coalesce(em.unique_targets,0)::int AS unique_targets,em.last_active_at
    FROM participants p LEFT JOIN encounter_metrics em ON em.hunter_key=lower(p.current_name)
    LEFT JOIN board_values bv ON bv.participant_id=p.id
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='guild' AND lower(guild_abbreviation)=lower(nullif(p.guild_abbreviation,'')) ORDER BY last_seen_at DESC LIMIT 1) guild ON true
    ${where} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  const summary = await pool.query(`SELECT
      ${countBountyParticipants("player")} AS leaderboard_hunters,
      (SELECT count(DISTINCT lower(hunter_name))::int FROM bounty_encounters) AS encounter_hunters,
      (SELECT count(DISTINCT lower(target_name))::int FROM bounty_encounters) AS encounter_targets,
      (SELECT count(*)::int FROM bounty_encounters) AS encounters,
      (SELECT count(*)::int FROM participants p WHERE p.participant_type='player' AND EXISTS (SELECT 1 FROM bounty_encounters be WHERE lower(be.hunter_name)=lower(p.current_name))) AS matched_hunters`);
  return { rows: rows.rows, total: count.rows[0].count as number, page, pageSize, summary: summary.rows[0] };
}

export async function getArchiveStats() {
  const [summary, topHunters, topTargets, outcomes] = await Promise.all([
    pool.query(`SELECT
      (SELECT count(*)::int FROM bounty_encounters) AS encounters,
      (SELECT count(*)::int FROM bounty_encounters WHERE event_at>=date_trunc('day',now())) AS encounters_today,
      (SELECT count(DISTINCT lower(hunter_name))::int FROM bounty_encounters) AS encounter_hunters,
      (SELECT count(DISTINCT lower(target_name))::int FROM bounty_encounters) AS encounter_targets,
      (SELECT count(DISTINCT actor) FROM (SELECT lower(hunter_name) actor FROM bounty_encounters UNION SELECT lower(target_name) FROM bounty_encounters) actors)::int AS unique_names,
      ${countBountyParticipants("player")} AS leaderboard_hunters,
      ${countBountyParticipants("guild")} AS guilds,
      ${countBountyParticipants("city")} AS cities,
      (SELECT min(event_at) FROM bounty_encounters) AS history_start,
      (SELECT max(event_at) FROM bounty_encounters) AS history_end`),
    pool.query(`SELECT min(be.hunter_name) AS hunter_name,count(*)::int AS encounters,count(*) FILTER(WHERE be.outcome='KILL')::int AS wins,
      count(*) FILTER(WHERE be.outcome='FAILED')::int AS losses,coalesce(sum(be.credits) FILTER(WHERE be.outcome='KILL'),0)::float8 AS credits,
      player.id AS participant_id
      FROM bounty_encounters be
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.hunter_name) ORDER BY last_seen_at DESC LIMIT 1) player ON true
      GROUP BY lower(be.hunter_name),player.id ORDER BY encounters DESC,wins DESC,hunter_name LIMIT 15`),
    pool.query(`SELECT min(be.target_name) AS target_name,count(*)::int AS encounters,count(*) FILTER(WHERE be.outcome='FAILED')::int AS survived,
      count(*) FILTER(WHERE be.outcome='KILL')::int AS killed,player.id AS participant_id
      FROM bounty_encounters be
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.target_name) ORDER BY last_seen_at DESC LIMIT 1) player ON true
      GROUP BY lower(be.target_name),player.id ORDER BY encounters DESC,survived DESC,target_name LIMIT 15`),
    pool.query(`SELECT outcome,count(*)::int AS encounters,coalesce(sum(credits),0)::float8 AS credits FROM bounty_encounters GROUP BY outcome ORDER BY outcome`),
  ]);
  return { summary: summary.rows[0], topHunters: topHunters.rows, topTargets: topTargets.rows, outcomes: outcomes.rows };
}

export interface RawDataFilters {
  q?: string;
  source?: string;
  status?: "PROCESSED" | "FAILED" | "HTTP_ERROR" | "RECEIVED";
  from?: string;
  to?: string;
  tz?: string;
  page?: number;
  pageSize?: number;
}

export async function getRawData(filters: RawDataFilters = {}) {
  const values: unknown[] = [];
  const conditions: string[] = ["i.payload_hash IS NOT NULL"];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.q?.trim()) {
    const token = bind(filters.q.trim());
    conditions.push(`jsonb_to_tsvector('simple',coalesce(b.payload,'{}'::jsonb),'["string","numeric","key"]'::jsonb) @@ websearch_to_tsquery('simple',${token})`);
  }
  if (filters.source?.trim()) conditions.push(`s.source_key=${bind(filters.source.trim())}`);
  if (filters.status) conditions.push(`i.processing_status=${bind(filters.status)}`);
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const timeZone = timeZoneOf(filters.tz);
  if (from) conditions.push(`i.response_received_at>=(${bind(from)}::date::timestamp AT TIME ZONE ${bind(timeZone)})`);
  if (to) conditions.push(`i.response_received_at<((${bind(to)}::date + interval '1 day') AT TIME ZONE ${bind(timeZone)})`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);
  const count = await pool.query(`SELECT count(*)::int AS count FROM api_ingestions i JOIN api_sources s ON s.id=i.source_id LEFT JOIN payload_blobs b ON b.payload_hash=i.payload_hash ${where}`, values);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = await pool.query(`SELECT i.id,s.source_key,i.endpoint,i.request_parameters,i.response_received_at,i.duration_ms,i.http_status,
      i.processing_status,i.payload_hash,i.schema_signature,i.parser_version,octet_length(convert_to(b.payload::text,'UTF8'))::int AS payload_bytes,
      left(b.payload::text,280) AS preview
    FROM api_ingestions i JOIN api_sources s ON s.id=i.source_id LEFT JOIN payload_blobs b ON b.payload_hash=i.payload_hash ${where}
    ORDER BY i.response_received_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  const sources = await pool.query(`SELECT s.source_key,s.endpoint,count(i.id) FILTER(WHERE i.payload_hash IS NOT NULL)::int AS responses
    FROM api_sources s LEFT JOIN api_ingestions i ON i.source_id=s.id GROUP BY s.id,s.source_key,s.endpoint ORDER BY s.source_key`);
  return { rows: rows.rows, total: count.rows[0].count as number, page, pageSize, sources: sources.rows };
}

export async function getRawIngestion(id: string) {
  const result = await pool.query(`SELECT i.id,i.run_id,s.source_key,r.run_type,i.endpoint,i.request_parameters,i.requested_at,
      i.response_received_at,i.duration_ms,i.http_status,b.payload,i.payload_hash,i.schema_signature,i.parser_version,i.processing_status
    FROM api_ingestions i JOIN api_sources s ON s.id=i.source_id JOIN ingestion_runs r ON r.id=i.run_id
    JOIN payload_blobs b ON b.payload_hash=i.payload_hash
    WHERE i.id::text=$1`, [id]);
  return result.rows[0] ?? null;
}

export interface RivalryFilters {
  q?: string;
  sort?: "encounters" | "closest" | "revenge" | "longest" | "recent";
  page?: number;
  pageSize?: number;
}

const rivalryCtes = `WITH tagged AS (
    SELECT be.*,
      least(lower(be.hunter_name),lower(be.target_name)) AS side_a_key,
      greatest(lower(be.hunter_name),lower(be.target_name)) AS side_b_key,
      CASE WHEN lower(be.hunter_name)<=lower(be.target_name) THEN be.hunter_name ELSE be.target_name END AS side_a_name,
      CASE WHEN lower(be.hunter_name)<=lower(be.target_name) THEN be.target_name ELSE be.hunter_name END AS side_b_name
    FROM bounty_encounters be WHERE lower(be.hunter_name)<>lower(be.target_name)
  ), kill_sequence AS (
    SELECT side_a_key,side_b_key,lower(hunter_name) AS killer_key,lower(target_name) AS victim_key,
      lag(lower(hunter_name)) OVER(PARTITION BY side_a_key,side_b_key ORDER BY event_at,id) AS previous_killer_key
    FROM tagged WHERE outcome='KILL'
  ), revenges AS (
    SELECT side_a_key,side_b_key,count(*) FILTER(WHERE previous_killer_key=victim_key)::int AS revenge_kills
    FROM kill_sequence GROUP BY side_a_key,side_b_key
  ), rivalry_rows AS (
    SELECT t.side_a_key,t.side_b_key,min(t.side_a_name) AS side_a_name,min(t.side_b_name) AS side_b_name,
      count(*)::int AS encounters,
      count(*) FILTER(WHERE (t.outcome='KILL' AND lower(t.hunter_name)=t.side_a_key) OR (t.outcome='FAILED' AND lower(t.target_name)=t.side_a_key))::int AS side_a_wins,
      count(*) FILTER(WHERE (t.outcome='KILL' AND lower(t.hunter_name)=t.side_b_key) OR (t.outcome='FAILED' AND lower(t.target_name)=t.side_b_key))::int AS side_b_wins,
      count(*) FILTER(WHERE t.outcome='KILL')::int AS claims,
      coalesce(sum(t.credits) FILTER(WHERE t.outcome='KILL'),0)::float8 AS credits,
      min(t.event_at) AS first_event_at,max(t.event_at) AS last_event_at,
      coalesce(max(r.revenge_kills),0)::int AS revenge_kills
    FROM tagged t LEFT JOIN revenges r USING(side_a_key,side_b_key)
    GROUP BY t.side_a_key,t.side_b_key
  )`;

export async function getRivalries(filters: RivalryFilters = {}) {
  const values: unknown[] = [];
  const conditions = ["rr.encounters>=2"];
  if (filters.q?.trim()) {
    values.push(`%${filters.q.trim()}%`, `%${filters.q.trim()}%`);
    conditions.push(`(rr.side_a_name ILIKE $${values.length - 1} OR rr.side_b_name ILIKE $${values.length})`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);
  const order = {
    encounters: "rr.encounters DESC,rr.last_event_at DESC",
    closest: "abs(rr.side_a_wins-rr.side_b_wins) ASC,rr.encounters DESC",
    revenge: "rr.revenge_kills DESC,rr.encounters DESC",
    longest: "(rr.last_event_at-rr.first_event_at) DESC,rr.encounters DESC",
    recent: "rr.last_event_at DESC,rr.encounters DESC",
  }[filters.sort ?? "encounters"];
  const count = await pool.query(`${rivalryCtes} SELECT count(*)::int AS count FROM rivalry_rows rr ${where}`, values);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = await pool.query(`${rivalryCtes}
    SELECT rr.*,a.id AS side_a_participant_id,b.id AS side_b_participant_id
    FROM rivalry_rows rr
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=rr.side_a_key ORDER BY last_seen_at DESC LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=rr.side_b_key ORDER BY last_seen_at DESC LIMIT 1) b ON true
    ${where} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  const summary = await pool.query(`${rivalryCtes} SELECT count(*) FILTER(WHERE encounters>=2)::int AS rivalries,
    coalesce(max(encounters),0)::int AS most_encounters,coalesce(sum(revenge_kills),0)::int AS revenge_kills,
    coalesce(max(extract(epoch FROM last_event_at-first_event_at)) FILTER(WHERE encounters>=2),0)::float8 AS longest_span_seconds FROM rivalry_rows`);
  return { rows: rows.rows, total: count.rows[0].count as number, page, pageSize, summary: summary.rows[0] };
}

export async function getRivalryDetail(hunterId: string, opponentName: string) {
  if (!isUuid(hunterId) || !opponentName.trim() || opponentName.length > 100) return null;
  const entity = await pool.query("SELECT * FROM participants WHERE id=$1 AND participant_type='player'", [hunterId]);
  if (!entity.rows[0]) return null;
  const hunter = entity.rows[0];
  const events = await pool.query(`SELECT be.id,be.event_at,be.outcome,be.hunter_name,be.target_name,be.credits,
      hp.id AS hunter_participant_id,tp.id AS target_participant_id
    FROM bounty_encounters be
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.hunter_name) ORDER BY last_seen_at DESC LIMIT 1) hp ON true
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.target_name) ORDER BY last_seen_at DESC LIMIT 1) tp ON true
    WHERE (lower(be.hunter_name)=lower($1) AND lower(be.target_name)=lower($2))
       OR (lower(be.hunter_name)=lower($2) AND lower(be.target_name)=lower($1))
    ORDER BY be.event_at ASC,be.id ASC`, [hunter.current_name, opponentName]);
  if (!events.rows.length) return null;
  const metrics = deriveRivalryMetrics(events.rows.map((event) => ({ outcome: event.outcome, hunterName: event.hunter_name, targetName: event.target_name, credits: Number(event.credits) })), hunter.current_name);
  const opponent = await pool.query("SELECT id,current_name,guild_abbreviation FROM participants WHERE participant_type='player' AND lower(current_name)=lower($1) ORDER BY last_seen_at DESC LIMIT 1", [opponentName]);
  return { hunter, opponent: opponent.rows[0] ?? { id: null, current_name: opponentName, guild_abbreviation: null }, events: await attachHunterStats([...events.rows].reverse()),
    summary: { encounters: metrics.encounters, hunterWins: metrics.playerWins, opponentWins: metrics.opponentWins, hunterClaims: metrics.playerClaims,
      hunterSurvivals: metrics.playerSurvivals, hunterCredits: metrics.playerCredits, revengeKills: metrics.revengeKills,
      winRate: metrics.winRate, firstEventAt: events.rows[0].event_at, lastEventAt: events.rows.at(-1).event_at } };
}

export interface GuildDirectoryFilters {
  q?: string;
  sort?: "score" | "winRate" | "claims" | "credits" | "roster";
}

const guildCompetitionCtes = `WITH player_names AS (
    SELECT DISTINCT ON (lower(current_name)) id,current_name,nullif(guild_abbreviation,'') AS guild_abbreviation,last_seen_at
    FROM participants WHERE participant_type='player' ORDER BY lower(current_name),last_seen_at DESC
  ), member_activity AS (
    SELECT pn.id,pn.current_name,pn.guild_abbreviation,count(be.id)::int AS encounters,
      count(be.id) FILTER(WHERE be.outcome='KILL')::int AS wins,count(be.id) FILTER(WHERE be.outcome='FAILED')::int AS losses,
      coalesce(sum(be.credits) FILTER(WHERE be.outcome='KILL'),0)::float8 AS credits,
      count(DISTINCT lower(be.target_name))::int AS unique_targets,max(be.event_at) AS last_active_at
    FROM player_names pn LEFT JOIN bounty_encounters be ON lower(be.hunter_name)=lower(pn.current_name)
    WHERE pn.guild_abbreviation IS NOT NULL GROUP BY pn.id,pn.current_name,pn.guild_abbreviation
  ), guild_activity AS (
    SELECT lower(guild_abbreviation) AS guild_key,count(*)::int AS roster_size,
      count(*) FILTER(WHERE encounters>0)::int AS active_hunters,coalesce(sum(encounters),0)::int AS encounters,
      coalesce(sum(wins),0)::int AS wins,coalesce(sum(losses),0)::int AS losses,coalesce(sum(credits),0)::float8 AS credits,
      coalesce(sum(unique_targets),0)::int AS target_observations,max(last_active_at) AS last_active_at
    FROM member_activity GROUP BY lower(guild_abbreviation)
  ), latest_guild_board AS (
    SELECT DISTINCT ON (e.participant_id) e.participant_id,e.rank,e.score::float8 AS score
    FROM leaderboard_entries e JOIN leaderboard_snapshots s ON s.id=e.snapshot_id JOIN leaderboard_periods lp ON lp.id=s.period_id
    WHERE s.subject='guild' AND s.leaderboard_id='BOUNTY_HUNTER_TOTAL_KILLS' AND lp.source_period_key='CURRENT'
    ORDER BY e.participant_id,s.observed_at DESC
  )`;

export async function getGuildDirectory(filters: GuildDirectoryFilters = {}) {
  const values: unknown[] = [];
  const conditions = ["g.participant_type='guild'"];
  if (filters.q?.trim()) {
    values.push(`%${filters.q.trim()}%`);
    conditions.push(`(g.current_name ILIKE $1 OR g.guild_abbreviation ILIKE $1)`);
  }
  const order = {
    score: "lb.rank ASC NULLS LAST,g.current_name",
    winRate: "win_rate DESC NULLS LAST,wins DESC,g.current_name",
    claims: "wins DESC,g.current_name",
    credits: "credits DESC,g.current_name",
    roster: "roster_size DESC,g.current_name",
  }[filters.sort ?? "score"];
  const rows = await pool.query(`${guildCompetitionCtes} SELECT g.id,g.current_name,g.guild_abbreviation,g.first_seen_at,g.last_seen_at,
      lb.rank,lb.score,coalesce(ga.roster_size,0)::int AS roster_size,coalesce(ga.active_hunters,0)::int AS active_hunters,
      coalesce(ga.encounters,0)::int AS encounters,coalesce(ga.wins,0)::int AS wins,coalesce(ga.losses,0)::int AS losses,
      CASE WHEN ga.encounters>0 THEN ga.wins::float8/ga.encounters ELSE NULL END AS win_rate,
      coalesce(ga.credits,0)::float8 AS credits,ga.last_active_at
    FROM participants g LEFT JOIN guild_activity ga ON ga.guild_key=lower(g.guild_abbreviation)
    LEFT JOIN latest_guild_board lb ON lb.participant_id=g.id WHERE ${conditions.join(" AND ")} ORDER BY ${order}`, values);
  const summary = await pool.query(`${guildCompetitionCtes} SELECT count(*)::int AS guilds,coalesce(sum(roster_size),0)::int AS rostered_hunters,
    coalesce(sum(active_hunters),0)::int AS active_hunters,coalesce(sum(wins),0)::int AS claims,coalesce(sum(credits),0)::float8 AS credits FROM guild_activity`);
  return { rows: rows.rows, summary: summary.rows[0] };
}

async function getGuildProfileData(guildId: string, abbreviation: string | null) {
  if (!abbreviation) return { summary: null, roster: [], rivals: [], activity: [] };
  const [summary, roster, activity, rivals] = await Promise.all([
    pool.query(`${guildCompetitionCtes} SELECT ga.*,CASE WHEN ga.encounters>0 THEN ga.wins::float8/ga.encounters ELSE NULL END AS win_rate
      FROM participants g LEFT JOIN guild_activity ga ON ga.guild_key=lower(g.guild_abbreviation) WHERE g.id=$1`, [guildId]),
    pool.query(`SELECT p.id,p.current_name,p.city_name,coalesce(count(be.id),0)::int AS encounters,
      count(be.id) FILTER(WHERE be.outcome='KILL')::int AS wins,count(be.id) FILTER(WHERE be.outcome='FAILED')::int AS losses,
      coalesce(sum(be.credits) FILTER(WHERE be.outcome='KILL'),0)::float8 AS credits,max(be.event_at) AS last_active_at
      FROM participants p LEFT JOIN bounty_encounters be ON lower(be.hunter_name)=lower(p.current_name)
      WHERE p.participant_type='player' AND lower(nullif(p.guild_abbreviation,''))=lower($1)
      GROUP BY p.id,p.current_name,p.city_name ORDER BY wins DESC,encounters DESC,p.current_name`, [abbreviation]),
    pool.query(`SELECT be.event_at::date::text AS day,count(*)::int AS encounters,
      count(*) FILTER(WHERE be.outcome='KILL')::int AS wins,count(*) FILTER(WHERE be.outcome='FAILED')::int AS losses,
      coalesce(sum(be.credits) FILTER(WHERE be.outcome='KILL'),0)::float8 AS credits
      FROM bounty_encounters be JOIN participants p ON p.participant_type='player' AND lower(p.current_name)=lower(be.hunter_name)
      WHERE lower(nullif(p.guild_abbreviation,''))=lower($1) GROUP BY 1 ORDER BY 1`, [abbreviation]),
    pool.query(`WITH player_names AS (
        SELECT DISTINCT ON (lower(current_name)) current_name,nullif(guild_abbreviation,'') AS guild_abbreviation
        FROM participants WHERE participant_type='player' ORDER BY lower(current_name),last_seen_at DESC
      ), matches AS (
        SELECT be.*,hp.guild_abbreviation AS hunter_guild,tp.guild_abbreviation AS target_guild
        FROM bounty_encounters be JOIN player_names hp ON lower(hp.current_name)=lower(be.hunter_name)
        JOIN player_names tp ON lower(tp.current_name)=lower(be.target_name)
        WHERE hp.guild_abbreviation IS NOT NULL AND tp.guild_abbreviation IS NOT NULL AND lower(hp.guild_abbreviation)<>lower(tp.guild_abbreviation)
          AND (lower(hp.guild_abbreviation)=lower($1) OR lower(tp.guild_abbreviation)=lower($1))
      ), results AS (
        SELECT CASE WHEN lower(hunter_guild)=lower($1) THEN target_guild ELSE hunter_guild END AS opponent_guild,
          CASE WHEN (outcome='KILL' AND lower(hunter_guild)=lower($1)) OR (outcome='FAILED' AND lower(target_guild)=lower($1)) THEN 1 ELSE 0 END AS guild_won,
          event_at FROM matches
      )
      SELECT min(opponent_guild) AS opponent_guild,count(*)::int AS encounters,sum(guild_won)::int AS wins,(count(*)-sum(guild_won))::int AS losses,
        min(event_at) AS first_event_at,max(event_at) AS last_event_at,g.id AS guild_id
      FROM results r LEFT JOIN participants g ON g.participant_type='guild' AND lower(g.guild_abbreviation)=lower(r.opponent_guild)
      GROUP BY lower(opponent_guild),g.id ORDER BY encounters DESC,wins DESC`, [abbreviation]),
  ]);
  return { summary: summary.rows[0], roster: roster.rows, rivals: rivals.rows, activity: activity.rows };
}

async function getHunterRivalries(hunterName: string) {
  const result = await pool.query(`WITH matches AS (
      SELECT be.*,
        CASE WHEN lower(be.hunter_name)=lower($1) THEN be.target_name ELSE be.hunter_name END AS opponent,
        CASE WHEN (be.outcome='KILL' AND lower(be.hunter_name)=lower($1)) OR (be.outcome='FAILED' AND lower(be.target_name)=lower($1)) THEN 1 ELSE 0 END AS player_won,
        CASE WHEN be.outcome='KILL' AND lower(be.hunter_name)=lower($1) THEN 1 ELSE 0 END AS player_claim,
        CASE WHEN be.outcome='FAILED' AND lower(be.target_name)=lower($1) THEN 1 ELSE 0 END AS player_survival
      FROM bounty_encounters be WHERE lower(be.hunter_name)=lower($1) OR lower(be.target_name)=lower($1)
    ), kill_sequence AS (
      SELECT lower(opponent) AS opponent_key,lower(hunter_name) AS killer_key,lower(target_name) AS victim_key,
        lag(lower(hunter_name)) OVER(PARTITION BY lower(opponent) ORDER BY event_at,id) AS previous_killer_key
      FROM matches WHERE outcome='KILL'
    ), revenge AS (
      SELECT opponent_key,count(*) FILTER(WHERE killer_key=lower($1) AND previous_killer_key=victim_key)::int AS revenge_kills
      FROM kill_sequence GROUP BY opponent_key
    ), aggregates AS (
      SELECT lower(opponent) AS opponent_key,min(opponent) AS opponent,count(*)::int AS encounters,sum(player_won)::int AS wins,
        (count(*)-sum(player_won))::int AS losses,sum(player_claim)::int AS claims,sum(player_survival)::int AS survivals,
        coalesce(sum(credits) FILTER(WHERE player_claim=1),0)::float8 AS credits,min(event_at) AS first_event_at,max(event_at) AS last_event_at
      FROM matches GROUP BY lower(opponent)
    )
    SELECT a.*,CASE WHEN a.encounters>0 THEN a.wins::float8/a.encounters ELSE NULL END AS win_rate,
      coalesce(r.revenge_kills,0)::int AS revenge_kills,p.id AS participant_id
    FROM aggregates a LEFT JOIN revenge r ON r.opponent_key=a.opponent_key
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=a.opponent_key ORDER BY last_seen_at DESC LIMIT 1) p ON true
    ORDER BY a.encounters DESC,a.losses DESC,a.opponent`, [hunterName]);
  return result.rows;
}

export async function getLeaderboard(board: string, period: string, subject: string) {
  if (!isBoard(board) || !isPeriod(period) || !isSubject(subject)) throw new Error("Invalid leaderboard selection");
  const snapshot = await pool.query(
    `SELECT s.id,s.total_score::float8,s.value_type,s.source_fetched_at,p.starts_at,p.ends_at
     FROM leaderboard_snapshots s JOIN leaderboard_periods p ON p.id=s.period_id
     WHERE s.leaderboard_id=$1 AND p.source_period_key=$2 AND s.subject=$3 ORDER BY s.observed_at DESC LIMIT 1`,
    [board, period, subject],
  );
  if (!snapshot.rows[0]) return { snapshot: null, entries: [] };
  const entries = await pool.query(
    `SELECT e.rank,e.score::float8,e.score_raw,p.id AS participant_id,p.current_name,p.guild_abbreviation,p.faction,p.planet,p.city_name,
      previous.rank AS previous_rank,previous.score::float8 AS previous_score
     FROM leaderboard_entries e JOIN participants p ON p.id=e.participant_id
     LEFT JOIN LATERAL (
       SELECT pe.rank,pe.score FROM leaderboard_entries pe JOIN leaderboard_snapshots ps ON ps.id=pe.snapshot_id
       WHERE pe.source_participant_id=e.source_participant_id AND ps.leaderboard_id=$2 AND ps.subject=$3 AND ps.observed_at < $4
       ORDER BY ps.observed_at DESC LIMIT 1
     ) previous ON true
     WHERE e.snapshot_id=$1 ORDER BY e.rank`,
    [snapshot.rows[0].id, board, subject, snapshot.rows[0].source_fetched_at],
  );
  return { snapshot: snapshot.rows[0], entries: entries.rows };
}

export async function searchEntities(q: string, limit = 20) {
  if (!q.trim()) return [];
  const result = await pool.query(
    `SELECT id,participant_type,current_name,guild_abbreviation,planet,city_name,
      greatest(similarity(current_name,$1),similarity(coalesce(guild_abbreviation,''),$1),similarity(coalesce(city_name,''),$1)) AS relevance
     FROM participants WHERE current_name ILIKE $2 OR guild_abbreviation ILIKE $2 OR city_name ILIKE $2
     ORDER BY relevance DESC,current_name LIMIT $3`,
    [q, `%${q}%`, Math.min(limit, 50)],
  );
  return result.rows;
}

// GCW correlation: latest observation per (board, weekly period) for one
// participant, newest period first, with the all-time best rank per board.
// score is GCW points; score_raw is the source's faction-share percent string.
async function getGcwStandings(participantId: string) {
  const standings = await pool.query(
    `WITH gcw AS (
        SELECT s.leaderboard_id,lp.starts_at,lp.ends_at,lp.source_period_key,
          e.rank,e.score::float8 AS score,e.score_raw,s.total_score::float8 AS total_score,
          s.source_fetched_at,
          row_number() OVER (PARTITION BY s.leaderboard_id,lp.id ORDER BY s.observed_at DESC) AS rn,
          min(e.rank) OVER (PARTITION BY s.leaderboard_id) AS best_rank
        FROM leaderboard_entries e
        JOIN leaderboard_snapshots s ON s.id=e.snapshot_id
        JOIN leaderboard_periods lp ON lp.id=s.period_id
        WHERE e.participant_id=$1 AND s.leaderboard_id = ANY($2::text[])
      )
      SELECT leaderboard_id,starts_at,ends_at,source_period_key,rank,score,score_raw,total_score,
        CASE WHEN total_score>0 THEN score/total_score ELSE NULL END AS share,
        source_fetched_at,best_rank
      FROM gcw WHERE rn=1 ORDER BY leaderboard_id,starts_at DESC LIMIT 24`,
    [participantId, [...GCW_BOARD_IDS]],
  );
  return standings.rows;
}

// All-time GCW weekly victory counts (guild/city subjects only; the source
// wins feed has no player wins).
async function getGcwWins(participantId: string) {
  const wins = await pool.query(
    `SELECT DISTINCT ON (leaderboard_id) leaderboard_id,wins,rank,observed_at
     FROM leaderboard_wins
     WHERE participant_id=$1 AND leaderboard_id = ANY($2::text[])
     ORDER BY leaderboard_id,observed_at DESC`,
    [participantId, [...GCW_BOARD_IDS]],
  );
  return wins.rows;
}

// Officers' Salute correlation: the player's row in the latest archived
// registry snapshot per faction (players hold one commission, but a faction
// switch can briefly leave rows in both — take the newest observation).
async function getOfficerSalute(participantId: string) {
  const rows = await pool.query(
    `WITH latest AS (
        SELECT DISTINCT ON (faction) id,faction,observed_at,source_fetched_at
        FROM gcw_officer_snapshots ORDER BY faction,observed_at DESC
      )
      SELECT l.faction,l.observed_at,l.source_fetched_at,
        e.rank_index,e.rank_name,e.faction_name,e.profession,
        e.current_gcw_points::float8 AS current_gcw_points,
        e.current_pvp_kills::float8 AS current_pvp_kills,
        e.lifetime_gcw_points::float8 AS lifetime_gcw_points,
        e.lifetime_pvp_kills::float8 AS lifetime_pvp_kills
      FROM latest l JOIN gcw_officer_entries e ON e.snapshot_id=l.id
      WHERE e.participant_id=$1
      ORDER BY l.observed_at DESC LIMIT 1`,
    [participantId],
  );
  return rows.rows[0] ?? null;
}

// Guild officer corps: commissioned members (rank 7+) of this guild in the
// latest registry snapshots, by roster abbreviation.
async function getOfficerCorps(abbreviation: string | null) {
  if (!abbreviation) return { commissioned: 0, enlisted: 0, top: [] };
  const rows = await pool.query(
    `WITH latest AS (
        SELECT DISTINCT ON (faction) id FROM gcw_officer_snapshots ORDER BY faction,observed_at DESC
      )
      SELECT e.participant_id,e.name,e.rank_index,e.rank_name,e.faction_name,
        e.current_gcw_points::float8 AS current_gcw_points
      FROM latest l JOIN gcw_officer_entries e ON e.snapshot_id=l.id
      WHERE lower(e.guild_abbreviation)=lower($1)
      ORDER BY e.rank_index DESC,e.current_gcw_points DESC`,
    [abbreviation],
  );
  const commissioned = rows.rows.filter((row) => Number(row.rank_index) >= 7);
  return {
    commissioned: commissioned.length,
    enlisted: rows.rows.length - commissioned.length,
    top: commissioned.slice(0, 5),
  };
}

export async function getParticipant(id: string, expectedType?: "player" | "guild" | "city") {
  if (!isUuid(id)) return null;
  const entity = await pool.query(`SELECT p.*,guild.id AS guild_id FROM participants p
    LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='guild' AND lower(guild_abbreviation)=lower(nullif(p.guild_abbreviation,'')) ORDER BY last_seen_at DESC LIMIT 1) guild ON true
    WHERE p.id=$1 AND ($2::text IS NULL OR p.participant_type=$2)`, [id, expectedType ?? null]);
  if (!entity.rows[0]) return null;
  const participant = entity.rows[0];
  const history = await pool.query(`SELECT s.leaderboard_id,s.subject,s.source_fetched_at,lp.starts_at,lp.ends_at,e.rank,e.score::float8,e.score_raw
      FROM leaderboard_entries e JOIN leaderboard_snapshots s ON s.id=e.snapshot_id JOIN leaderboard_periods lp ON lp.id=s.period_id
      WHERE e.participant_id=$1 ORDER BY s.source_fetched_at DESC LIMIT 200`, [id]);
  if (participant.participant_type === "city") {
    const [gcwStandings, gcwWins] = await Promise.all([getGcwStandings(id), getGcwWins(id)]);
    return { participant, history: history.rows, encounters: [], opponents: [], rivalries: [], hunterSummary: null, targetSummary: null, dailyActivity: [], guildCompetition: null, gcwStandings, gcwWins, officerSalute: null, officerCorps: null };
  }
  if (participant.participant_type === "guild") {
    const [guildCompetition, gcwStandings, gcwWins, officerCorps] = await Promise.all([
      getGuildProfileData(id, participant.guild_abbreviation),
      getGcwStandings(id),
      getGcwWins(id),
      getOfficerCorps(participant.guild_abbreviation),
    ]);
    return { participant, history: history.rows, encounters: [], opponents: [], rivalries: [], hunterSummary: null, targetSummary: null, dailyActivity: [], guildCompetition, gcwStandings, gcwWins, officerSalute: null, officerCorps };
  }
  const [encounters, opponents, hunterSummary, targetSummary, dailyActivity, rivalries, gcwStandings, officerSalute] = await Promise.all([
    pool.query(`SELECT be.id,be.event_at,be.outcome,be.hunter_name,be.target_name,be.credits,
      hunter.id AS hunter_participant_id,target.id AS target_participant_id
      FROM bounty_encounters be
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.hunter_name) ORDER BY last_seen_at DESC LIMIT 1) hunter ON true
      LEFT JOIN LATERAL (SELECT id FROM participants WHERE participant_type='player' AND lower(current_name)=lower(be.target_name) ORDER BY last_seen_at DESC LIMIT 1) target ON true
      WHERE lower(be.hunter_name)=lower($1) OR lower(be.target_name)=lower($1) ORDER BY be.event_at DESC LIMIT 100`, [participant.current_name]),
    pool.query(`SELECT target_name AS opponent,count(*)::int AS encounters,
      count(*) FILTER(WHERE outcome='KILL')::int AS wins,count(*) FILTER(WHERE outcome='FAILED')::int AS losses,
      coalesce(sum(credits) FILTER(WHERE outcome='KILL'),0)::float8 AS credits,
      CASE WHEN count(*)>0 THEN count(*) FILTER(WHERE outcome='KILL')::float8/count(*) ELSE NULL END AS win_rate
      FROM bounty_encounters WHERE lower(hunter_name)=lower($1)
      GROUP BY lower(target_name),target_name ORDER BY encounters DESC,wins DESC LIMIT 10`, [participant.current_name]),
    pool.query(`SELECT count(*)::int AS encounters,count(*) FILTER(WHERE outcome='KILL')::int AS wins,
      count(*) FILTER(WHERE outcome='FAILED')::int AS losses,
      CASE WHEN count(*)>0 THEN count(*) FILTER(WHERE outcome='KILL')::float8/count(*) ELSE NULL END AS win_rate,
      coalesce(sum(credits) FILTER(WHERE outcome='KILL'),0)::float8 AS credits,
      avg(credits) FILTER(WHERE outcome='KILL')::float8 AS average_bounty,
      max(credits) FILTER(WHERE outcome='KILL')::float8 AS highest_bounty,
      count(DISTINCT lower(target_name))::int AS unique_targets,count(DISTINCT event_at::date)::int AS active_days,
      min(event_at) AS first_active_at,max(event_at) AS last_active_at
      FROM bounty_encounters WHERE lower(hunter_name)=lower($1)`, [participant.current_name]),
    pool.query(`SELECT count(*)::int AS encounters,count(*) FILTER(WHERE outcome='FAILED')::int AS survived,
      count(*) FILTER(WHERE outcome='KILL')::int AS killed,
      CASE WHEN count(*)>0 THEN count(*) FILTER(WHERE outcome='FAILED')::float8/count(*) ELSE NULL END AS survival_rate,
      min(event_at) AS first_targeted_at,max(event_at) AS last_targeted_at
      FROM bounty_encounters WHERE lower(target_name)=lower($1)`, [participant.current_name]),
    pool.query(`SELECT event_at::date::text AS day,count(*)::int AS encounters,
      count(*) FILTER(WHERE outcome='KILL')::int AS wins,count(*) FILTER(WHERE outcome='FAILED')::int AS losses,
      coalesce(sum(credits) FILTER(WHERE outcome='KILL'),0)::float8 AS credits
      FROM bounty_encounters WHERE lower(hunter_name)=lower($1) GROUP BY 1 ORDER BY 1`, [participant.current_name]),
    getHunterRivalries(participant.current_name),
    getGcwStandings(id),
    getOfficerSalute(id),
  ]);
  return { participant, history: history.rows, encounters: await attachHunterStats(encounters.rows), opponents: opponents.rows,
    rivalries, hunterSummary: hunterSummary.rows[0], targetSummary: targetSummary.rows[0], dailyActivity: dailyActivity.rows, guildCompetition: null,
    gcwStandings, gcwWins: [], officerSalute, officerCorps: null };
}

export async function getAdminHealth() {
  const [summary, sources, runs, errors, quality, checkpoints, tables, worker] = await Promise.all([
    pool.query(`SELECT max(response_received_at) FILTER(WHERE processing_status='PROCESSED') AS last_success,
      (SELECT count(*)::int FROM ingestion_errors WHERE resolved_at IS NULL) AS parser_errors,
      count(*) FILTER(WHERE processing_status='FAILED')::int AS historical_parser_errors,
      count(*)::int AS raw_responses,coalesce(sum(duration_ms),0)::bigint AS total_request_ms FROM api_ingestions`),
    pool.query(`SELECT s.source_key,s.endpoint,s.poll_interval_seconds,s.last_attempt_at,s.last_success_at,
      i.http_status,i.duration_ms,i.processing_status,i.response_received_at
      FROM api_sources s LEFT JOIN LATERAL (SELECT * FROM api_ingestions WHERE source_id=s.id ORDER BY response_received_at DESC LIMIT 1) i ON true ORDER BY s.source_key`),
    pool.query("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20"),
    pool.query("SELECT * FROM ingestion_errors WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 50"),
    pool.query("SELECT * FROM data_quality_events WHERE resolved_at IS NULL ORDER BY detected_at DESC LIMIT 50"),
    pool.query("SELECT * FROM backfill_checkpoints ORDER BY job_key"),
    pool.query(`SELECT
      (SELECT count(*)::int FROM bounty_encounters) AS encounters,
      (SELECT count(*)::int FROM participants) AS participants,
      (SELECT count(*)::int FROM leaderboard_snapshots) AS snapshots,
      (SELECT count(*)::int FROM leaderboard_entries) AS entries,
      (SELECT count(*)::int FROM data_revisions) AS revisions,
      (SELECT count(*)::int FROM schema_signatures) AS schema_signatures`),
    pool.query("SELECT heartbeat_at,metadata FROM worker_heartbeats WHERE worker_key='primary'"),
  ]);
  return { summary: summary.rows[0], sources: sources.rows, runs: runs.rows, errors: errors.rows, quality: quality.rows, checkpoints: checkpoints.rows, tables: tables.rows[0], worker: worker.rows[0] ?? null };
}
