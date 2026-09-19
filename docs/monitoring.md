# Axiom monitoring and alerting

Outer Rim Ledger uses Axiom as an optional hosted operational log provider. PostgreSQL remains the permanent authority for raw responses, ingestion runs, errors, schema signatures, revisions, and data-quality events. Axiom is not business-data storage and an Axiom outage never rolls back or fails a valid ingestion.

The integration uses the current [`@axiomhq/js`](https://axiom.co/docs/guides/javascript) batch client. Every event is written as sanitized JSON to stdout or stderr first and then queued for Axiom. The SDK flushes in the background; worker and one-shot collector shutdowns allow a short best-effort flush. Missing credentials, authentication failures, timeouts, and Axiom outages produce local warnings only.

## Dataset and server-side configuration

Create an **Events** dataset in **Settings → Datasets and views**. Recommended names:

- production: `outer-rim-ledger-production`
- development/staging: `outer-rim-ledger-development`

Create an API token that can ingest only into the selected dataset. Put these values in the server's `.env.production`; none use the `NEXT_PUBLIC_` prefix and none are exposed to browser code:

```dotenv
AXIOM_TOKEN=xaat-REPLACE_WITH_SERVER_SIDE_INGEST_TOKEN
AXIOM_DATASET=outer-rim-ledger-production
AXIOM_ENVIRONMENT=production
```

Both `AXIOM_TOKEN` and `AXIOM_DATASET` are required to enable delivery. Leave both blank to use only local JSON logging and PostgreSQL audit history. Supplying only one emits `axiom_configuration_incomplete` locally.

## Event contract

Every hosted event includes `timestamp`, `level`, `environment`, `service`, and `event`. Ingestion events use stable snake-case fields:

- identity: `run_id`, `run_type`, `source`, `source_instance`, `ingestion_id` when available;
- state: `status` (`running`, `success`, `partial`, or `failed`), `reason`;
- timing: `started_at`, `completed_at`, `duration_ms`;
- counts: `expected_records`, `received_records`, `inserted_records`, `updated_records`, `unchanged_records`, `rejected_records`, `duplicate_records`;
- failures: `error_type`, `error_message`, `http_status`, `endpoint`, and a sanitized `stack_trace` for unexpected exceptions;
- source drift: `missing_fields`, `unexpected_fields`, `changed_types`, `schema_signature`, and `parser_version`.

The collector emits:

- `ingestion_started`: one event when a database-backed run begins;
- `ingestion_complete`: one final event for every requested source instance;
- `ingestion_run_complete`: one final whole-run summary;
- `source_schema_changed` / `source_fields_changed`: structural drift;
- `pagination_incomplete`: declared pagination ended before the source's final page;
- `source_validation_failed`: a `200 OK` response failed semantic validation;
- `database_transaction_failed`: an archive/normalization transaction or audit write failed;
- `api_http_error`, `api_rate_limited`, `api_timeout`, and `api_transport_error`;
- `discord_bounty_posted` / `discord_bounty_failed`: one event per live-feed encounter delivery attempt per webhook (`webhook_key`, `encounter_id`, `outcome`, `event_at`, `http_status`; never the webhook URL). A failure is retried on a later worker cycle and never affects the run status. `discord_bounty_bootstrapped` fires once when a webhook is first configured;
- `capture_heartbeat_failed`: the worker could not reach the Cloudflare standby capture; the standby will start capturing on its own after `STALE_AFTER_SECONDS`, so this is informational unless it persists. `capture_replay_complete`: one event per `npm run ingest:replay` with capture and record counts;
- `axiom_delivery_failed`, `axiom_flush_failed`, and configuration warnings are local-only to avoid recursive delivery failures.

A whole run is `success` only if every source succeeds and passes integrity checks. It is `partial` when at least one source fails or is incomplete while others succeed, and `failed` when every requested source fails or the run aborts. The database keeps its existing uppercase `SUCCEEDED`, `PARTIAL`, and `FAILED` values.

The current public SWG endpoints do not expose usable pagination. The collector nevertheless checks pagination metadata if it appears, and treats an incomplete declaration as `partial`. It also validates the public 12-row bounty recent-event window, the 250-row-per-faction Officers' Salute cap, required tracked boards, mandatory response sections, record schemas, duplicate identities, and known invariants.

Raw payloads, response/request headers, cookies, authorization values, database URLs, passwords, tokens, and secrets are never placed in operational events.

## APL investigation queries — Query tab only

Replace the dataset name if necessary.

> **Do not paste the queries in this section into a Match Monitor.** These are interactive investigation queries for Axiom's general **Query** tab and intentionally use operators such as `order by` and `take` that Match Monitors reject. For alert creation, skip to [Recommended monitors](#recommended-monitors) and use the complete query shown for each monitor.

Before creating monitors, confirm that Axiom has received at least one application event:

```apl
['outer-rim-ledger-production']
| getschema
```

The result should include `event`, `status`, `service`, and `environment`. If `event` is absent, run the safe test under **Safe testing and operations** and then expand the query time range. Axiom validates field names against the dataset schema, so create the monitors after these core fields have arrived. The monitor projections use `column_ifexists()` only for optional failure fields that may not exist yet.

### Query tab 1: Failed ingestion

```apl
['outer-rim-ledger-production']
| where event in ('ingestion_complete', 'ingestion_run_complete') and status == 'failed'
| order by _time desc
```

### Query tab 2: Partial ingestion

```apl
['outer-rim-ledger-production']
| where event in ('ingestion_complete', 'ingestion_run_complete') and status == 'partial'
| order by _time desc
```

### Query tab 3: Schema/source changes

```apl
['outer-rim-ledger-production']
| where event in ('source_schema_changed', 'source_fields_changed')
| project _time, source, run_id, status, missing_fields, unexpected_fields, changed_types, message
| order by _time desc
```

### Query tab 4: Pagination failures

```apl
['outer-rim-ledger-production']
| where event == 'pagination_incomplete'
| project _time, source, run_id, expected_records, received_records, reason
| order by _time desc
```

### Query tab 5: API errors and rate limits

```apl
['outer-rim-ledger-production']
| where event in ('api_http_error', 'api_rate_limited', 'api_timeout', 'api_transport_error')
| project _time, event, source, run_id, http_status, endpoint, error_type, error_message
| order by _time desc
```

### Query tab 6: Database failures

```apl
['outer-rim-ledger-production']
| where event == 'database_transaction_failed'
| project _time, source, run_id, ingestion_id, reason, error_type, error_message
| order by _time desc
```

### Query tab 7: Rejected records

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete' and rejected_records > 0
| project _time, source, run_id, status, rejected_records, reason, error_message
| order by _time desc
```

### Query tab 8: Recent whole runs

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_run_complete'
| project _time, run_id, status, duration_ms, expected_records, received_records, inserted_records, updated_records, rejected_records, duplicate_records
| order by _time desc
| take 50
```

### Query tab 9: Runs for a specific source

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete' and source == 'bounty_activity'
| order by _time desc
```

### Query tab 10: One run ID

```apl
['outer-rim-ledger-production']
| where run_id == 'REPLACE_WITH_RUN_ID'
| order by _time asc
```

### Query tab 11: Sources without a recent successful ingestion

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete'
| summarize last_success=maxif(_time, status == 'success'), last_seen=max(_time) by source
| extend minutes_since_success=datetime_diff('minute', now(), last_success)
| where isnull(last_success) or minutes_since_success > 10
| order by minutes_since_success desc
```

## Recommended monitors

Every alert-worthy event carries two extra fields set by the application
(`classifyAlert` in `src/lib/observability/logger.ts`): `alert`, a stable
name, and `alert_summary`, one readable line built from the event's fields
after redaction. That lets a single match monitor page for everything while
staying inside the free plan's monitor limit, and adding a new alert type is a
code change rather than a new monitor.

| `alert` | Fires on | Typical cause |
|---|---|---|
| `ingestion_failed` | a run finished `failed` | source unreachable, database down |
| `ingestion_partial` | a run finished `partial` | one source failed or failed integrity checks |
| `worker_cycle_aborted` | the worker loop caught an unexpected error | database outage mid-cycle |
| `database_failure` | any archive or audit write failed | connection loss, disk full |
| `source_changed` | schema signature or field set changed | SWG Legends changed its API |
| `pagination_incomplete` | declared pagination ended early | source-side change |
| `discord_webhook_rejected` | encounter feed got a 4xx other than 429 | webhook deleted or revoked in Discord |
| `discord_feed_error` | the feed publisher itself threw | database problem during delivery |
| `weekly_report_failed` | weekly report render or post failed | Chromium or webhook problem |
| `discord_bot_error` | a slash command query failed | database problem |
| `standby_unreachable` | heartbeat to the Cloudflare standby failed | Worker or network problem (standby will take over) |
| `discord_feed_backlog` | an encounter has waited over an hour for a webhook | Discord outage or a webhook failing every cycle; at most hourly per webhook |
| `host_disk_low` | free space on the container root below 10% or 2 GB | logs, dumps or the database filling the disk; checked hourly |
| `replay_failed` | `npm run ingest:replay` failed | bad token, Worker down |
| `monitoring_test` | the synthetic event under *Safe testing* | you |
| any other `error`-level event name | unclassified errors (catch-all) | investigate |

Per-source failures inside a run (`source_validation_failed`, `api_*`,
`source_processing_failed` for one source) are deliberately not alerts; the
run's own `ingestion_run_complete` covers them once. Transient Discord
delivery failures (429, 5xx, network) are not alerts either because the feed
retries them on the next cycle.

Create these under **Monitors → New monitor** and attach the Discord notifier
described below. Paste each dataset-qualified query into the advanced APL
editor. Match monitors accept only `where`, `project`, `extend` and `parse`;
threshold monitor queries must end with `summarize`. `No events in time range`
is an expected preview result when nothing recently matched.

### 1. Application alerts (match monitor)

- Name: `jawatracks-alert`
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where isnotempty(tostring(column_ifexists('alert', '')))
  | project _time,
      alert=tostring(column_ifexists('alert', '')),
      alert_summary=tostring(column_ifexists('alert_summary', '')),
      source=tostring(column_ifexists('source', '')),
      run_id=tostring(column_ifexists('run_id', '')),
      status=tostring(column_ifexists('status', '')),
      reason=tostring(column_ifexists('reason', '')),
      http_status=tostring(column_ifexists('http_status', '')),
      error_type=tostring(column_ifexists('error_type', '')),
      error_message=tostring(column_ifexists('error_message', ''))
  ```
- Every field goes through `column_ifexists()` because APL rejects a bare column the dataset has never seen; `alert` only exists once the first alert-worthy (or synthetic test) event has been ingested.
- Notification behavior: once per matching event. Axiom caps match monitors at
  10 notifications per minute and 500 per day, which is why per-source and
  transient events are excluded above.

### 2. No successful ingestion within the expected interval (threshold monitor)

The application cannot log its own absence, so this stays a separate
[threshold monitor](https://axiom.co/docs/monitor-data/threshold-monitors).

- Query:
  ```apl
  ['outer-rim-ledger-production']
  | summarize successful_runs=countif(event == 'ingestion_run_complete' and status == 'success')
  ```
- Operator/threshold: below `1`
- Frequency/range: every `5` minutes over `15` minutes (the poll cadence is 310 s)
- Alert on no data: on

### 3. Spare

Keep the third slot free, or use it for per-source staleness: the same
threshold settings with `event == 'ingestion_complete'`, summarize
`countif(status == 'success') by source`, and **Notify by group** enabled. The
public `/api/health` endpoint remains an independent provider-neutral check for
web, database, worker-failure and worker-staleness state, and is what an
external uptime monitor should watch.

The earlier per-type match monitors (failed, partial, schema, pagination,
database) are superseded by monitor 1 and can be deleted.

## Discord notifier

Axiom supports [Discord notifiers](https://axiom.co/docs/monitor-data/discord-notifier) directly; no custom alerting bot belongs in this repository (the slash-command bot in [discord-bot.md](discord-bot.md) is a separate, read-only feature).

1. In Discord, open the target channel's settings, choose **Integrations → Webhooks → New Webhook**, select the channel, and copy the webhook URL.
2. In Axiom, open **Monitors → Manage notifiers → New notifier**.
3. Name it `Outer Rim Ledger production`.
4. Select **Discord Webhook**, paste the URL, and create the notifier.
5. Edit each monitor, choose **Add notifier**, select the new Discord notifier, and save.
6. Trigger a temporary non-paging test monitor and confirm the message includes `source`, `run_id`, `reason`, and record counts. Then remove the temporary monitor.

Axiom also supports a Discord bot token plus channel ID, but a channel webhook is simpler and requires less privilege.

## Safe testing and operations

To emit a sanitized test event from the worker container without touching business data:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  ./node_modules/.bin/tsx -e 'import { log } from "./src/lib/observability/logger.ts"; import { flushAxiom } from "./src/lib/observability/axiom.ts"; void (async () => { log.error("source_processing_failed", {source:"monitoring_test",status:"failed",reason:"manual_test"}); await flushAxiom(); })();'
```

That event is classified as `alert=monitoring_test`, so the `jawatracks-alert` monitor delivers it to Discord without any temporary monitor. Do not test by changing or deleting production archive data.

To test the production failed-ingestion match monitor end to end, intentionally emit a synthetic event with the same event contract. This triggers the alert but does not create or modify an ingestion run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  ./node_modules/.bin/tsx -e 'import { randomUUID } from "node:crypto"; import { log } from "./src/lib/observability/logger.ts"; import { flushAxiom } from "./src/lib/observability/axiom.ts"; void (async () => { log.error("ingestion_run_complete", {run_id:"monitoring-test-"+randomUUID(),run_type:"manual",source:"monitoring_test",status:"failed",reason:"manual_monitor_test",expected_records:1,received_records:0,rejected_records:0,failed_sources:1}); await flushAxiom(); })();'
```

Confirm the Discord message identifies `source` as `monitoring_test` and `reason` as `manual_monitor_test`. The event remains in Axiom as an explicit monitoring test; it never enters PostgreSQL business history.

If Axiom is unavailable, valid ingestion continues. Inspect `docker compose logs worker`, `/api/health`, `/admin/ingestion`, and the PostgreSQL `ingestion_runs`, `ingestion_errors`, and `data_quality_events` records while hosted delivery recovers.

When a source-change monitor fires, locate its `run_id` and `ingestion_id` in the protected ingestion console, inspect the raw response already preserved in PostgreSQL, update the Zod parser and unknown-field allow-list only after understanding the upstream change, and resolve the database quality event after validation.
