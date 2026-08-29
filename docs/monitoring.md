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

**Alert editor queries:** These are the queries to use for alerts. Create them under **Monitors → New monitor** and attach the Discord notifier described below. Paste each complete dataset-qualified query into the advanced APL editor, including the opening `['outer-rim-ledger-production']` line. Do not add `order by`, `take`, `summarize`, or any other operator to a Match Monitor; only `where`, `project`, `extend`, and `parse` are accepted. Threshold monitor queries must end with `summarize`.

`No events in time range` is an expected preview result when the selected interval contains no failure of that type; it is not a query error. Expand the preview range only if you expect an older matching event. After saving the monitors, use the synthetic events under **Safe testing and operations** to verify delivery without altering archive data.

[Match monitors](https://axiom.co/docs/monitor-data/match-monitors) continuously filter new events and send one notification for each match. They do not have frequency or range settings. Axiom currently limits each match monitor to 10 notifications per minute and 500 per day. The `project` clauses below deliberately keep Discord messages compact, while `column_ifexists()` safely handles optional fields that may not exist until the first event of that failure type arrives.

### Ingestion failed

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event == 'ingestion_run_complete' and status == 'failed'
  | extend expected_count=tolong(expected_records), received_count=tolong(received_records)
  | extend missing_count=max_of(expected_count - received_count, 0)
  | project _time,
      source,
      run_id,
      status,
      reason=tostring(column_ifexists('reason', '')),
      expected_records=expected_count,
      received_records=received_count,
      missing_records=missing_count,
      rejected_records,
      failed_sources,
      error_message=tostring(column_ifexists('error_message', ''))
  ```
- Notification behavior: once for every matching failed run

### Ingestion partial

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event == 'ingestion_run_complete' and status == 'partial'
  | extend expected_count=tolong(expected_records), received_count=tolong(received_records)
  | extend missing_count=max_of(expected_count - received_count, 0)
  | project _time,
      source,
      run_id,
      status,
      reason=tostring(column_ifexists('reason', '')),
      expected_records=expected_count,
      received_records=received_count,
      missing_records=missing_count,
      rejected_records,
      partial_sources,
      failed_sources
  ```
- Notification behavior: once for every matching partial run

### Source/schema changed

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event in ('source_schema_changed', 'source_fields_changed')
  | project _time,
      event,
      source,
      run_id,
      status=tostring(column_ifexists('status', '')),
      missing_fields=tostring(column_ifexists('missing_fields', '[]')),
      unexpected_fields=tostring(column_ifexists('unexpected_fields', '[]')),
      changed_types=tostring(column_ifexists('changed_types', '[]')),
      message=tostring(column_ifexists('message', ''))
  ```
- Notification behavior: once for every matching source/schema change

### Pagination incomplete

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event == 'pagination_incomplete'
  | extend expected_count=tolong(expected_records), received_count=tolong(received_records)
  | extend missing_count=max_of(expected_count - received_count, 0)
  | project _time,
      source,
      run_id,
      status,
      reason=tostring(column_ifexists('reason', 'pagination_incomplete')),
      expected_records=expected_count,
      received_records=received_count,
      missing_records=missing_count
  ```
- Notification behavior: once for every matching pagination failure

### Database failure

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event == 'database_transaction_failed'
  | project _time,
      source,
      run_id,
      ingestion_id=tostring(column_ifexists('ingestion_id', '')),
      reason=tostring(column_ifexists('reason', '')),
      error_type=tostring(column_ifexists('error_type', '')),
      error_message=tostring(column_ifexists('error_message', ''))
  ```
- Notification behavior: once for every matching database failure

### No successful ingestion within the expected interval

- Type: [threshold monitor](https://axiom.co/docs/monitor-data/threshold-monitors)
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | where event == 'ingestion_run_complete'
  | summarize successful_runs=countif(status == 'success')
  ```
- Operator/threshold: below `1`
- Frequency/range: every `5` minutes over `10` minutes
- Alert on no data: on

For per-source staleness, use the same settings with `event == 'ingestion_complete'`, summarize `countif(status == 'success') by source`, and enable **Notify by group**. The public `/api/health` endpoint remains an independent provider-neutral check for web, database, worker-failure, and worker-staleness state.

After enough history exists, add anomaly monitors for unusually high `duplicate_records` and unusually low `received_records`, grouped by `source` in five-minute bins. Add match monitors for `api_rate_limited` and for `ingestion_complete` where `rejected_records > 0`. Baseline these warnings before paging because unchanged snapshots legitimately produce duplicates.

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

Use a temporary match monitor for `source == 'monitoring_test'`, confirm Discord delivery, then delete the monitor. Do not test by changing or deleting production archive data.

To test the production failed-ingestion match monitor end to end, intentionally emit a synthetic event with the same event contract. This triggers the alert but does not create or modify an ingestion run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  ./node_modules/.bin/tsx -e 'import { randomUUID } from "node:crypto"; import { log } from "./src/lib/observability/logger.ts"; import { flushAxiom } from "./src/lib/observability/axiom.ts"; void (async () => { log.error("ingestion_run_complete", {run_id:"monitoring-test-"+randomUUID(),run_type:"manual",source:"monitoring_test",status:"failed",reason:"manual_monitor_test",expected_records:1,received_records:0,rejected_records:0,failed_sources:1}); await flushAxiom(); })();'
```

Confirm the Discord message identifies `source` as `monitoring_test` and `reason` as `manual_monitor_test`. The event remains in Axiom as an explicit monitoring test; it never enters PostgreSQL business history.

If Axiom is unavailable, valid ingestion continues. Inspect `docker compose logs worker`, `/api/health`, `/admin/ingestion`, and the PostgreSQL `ingestion_runs`, `ingestion_errors`, and `data_quality_events` records while hosted delivery recovers.

When a source-change monitor fires, locate its `run_id` and `ingestion_id` in the protected ingestion console, inspect the raw response already preserved in PostgreSQL, update the Zod parser and unknown-field allow-list only after understanding the upstream change, and resolve the database quality event after validation.
