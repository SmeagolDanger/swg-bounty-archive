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

## APL investigation queries

Replace the dataset name if necessary.

Before creating monitors, confirm that Axiom has received at least one application event:

```apl
['outer-rim-ledger-production']
| getschema
```

The result should include `event`, `status`, `service`, and `environment`. If `event` is absent, run the safe test under **Safe testing and operations** and then expand the query time range. Axiom validates field names against the dataset schema, so a direct `where event == ...` query fails until the field has been ingested. The monitor queries below use `column_ifexists()` so they can still be saved before the first event arrives.

### 1. Failed ingestion

```apl
['outer-rim-ledger-production']
| where event in ('ingestion_complete', 'ingestion_run_complete') and status == 'failed'
| order by _time desc
```

### 2. Partial ingestion

```apl
['outer-rim-ledger-production']
| where event in ('ingestion_complete', 'ingestion_run_complete') and status == 'partial'
| order by _time desc
```

### 3. Schema/source changes

```apl
['outer-rim-ledger-production']
| where event in ('source_schema_changed', 'source_fields_changed')
| project _time, source, run_id, status, missing_fields, unexpected_fields, changed_types, message
| order by _time desc
```

### 4. Pagination failures

```apl
['outer-rim-ledger-production']
| where event == 'pagination_incomplete'
| project _time, source, run_id, expected_records, received_records, reason
| order by _time desc
```

### 5. API errors and rate limits

```apl
['outer-rim-ledger-production']
| where event in ('api_http_error', 'api_rate_limited', 'api_timeout', 'api_transport_error')
| project _time, event, source, run_id, http_status, endpoint, error_type, error_message
| order by _time desc
```

### 6. Database failures

```apl
['outer-rim-ledger-production']
| where event == 'database_transaction_failed'
| project _time, source, run_id, ingestion_id, reason, error_type, error_message
| order by _time desc
```

### 7. Rejected records

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete' and rejected_records > 0
| project _time, source, run_id, status, rejected_records, reason, error_message
| order by _time desc
```

### 8. Recent whole runs

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_run_complete'
| project _time, run_id, status, duration_ms, expected_records, received_records, inserted_records, updated_records, rejected_records, duplicate_records
| order by _time desc
| take 50
```

### 9. Runs for a specific source

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete' and source == 'bounty_activity'
| order by _time desc
```

### 10. One run ID

```apl
['outer-rim-ledger-production']
| where run_id == 'REPLACE_WITH_RUN_ID'
| order by _time asc
```

### 11. Sources without a recent successful ingestion

```apl
['outer-rim-ledger-production']
| where event == 'ingestion_complete'
| summarize last_success=maxif(_time, status == 'success'), last_seen=max(_time) by source
| extend minutes_since_success=datetime_diff('minute', now(), last_success)
| where isnull(last_success) or minutes_since_success > 10
| order by minutes_since_success desc
```

## Recommended monitors

Create these under **Monitors → New monitor** and attach the Discord notifier described below. Threshold monitor queries must end with `summarize`.

### Ingestion failed

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', '')), run_status=tostring(column_ifexists('status', ''))
  | where event_name == 'ingestion_run_complete' and run_status == 'failed'
  ```
- Frequency/range: every `1` minute over `5` minutes

### Ingestion partial

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', '')), run_status=tostring(column_ifexists('status', ''))
  | where event_name == 'ingestion_run_complete' and run_status == 'partial'
  ```
- Frequency/range: every `1` minute over `5` minutes

### Source/schema changed

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', ''))
  | where event_name in ('source_schema_changed', 'source_fields_changed')
  ```
- Frequency/range: every `1` minute over `5` minutes

### Pagination incomplete

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', ''))
  | where event_name == 'pagination_incomplete'
  ```
- Frequency/range: every `1` minute over `5` minutes

### Database failure

- Type: match monitor
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', ''))
  | where event_name == 'database_transaction_failed'
  ```
- Frequency/range: every `1` minute over `5` minutes

### No successful ingestion within the expected interval

- Type: threshold
- Query:
  ```apl
  ['outer-rim-ledger-production']
  | extend event_name=tostring(column_ifexists('event', '')), run_status=tostring(column_ifexists('status', ''))
  | where event_name == 'ingestion_run_complete'
  | summarize successful_runs=countif(run_status == 'success')
  ```
- Operator/threshold: below `1`
- Frequency/range: every `5` minutes over `10` minutes
- Alert on no data: on

For per-source staleness, use the same settings with `event == 'ingestion_complete'`, summarize `countif(status == 'success') by source`, and enable **Notify by group**. The public `/api/health` endpoint remains an independent provider-neutral check for web, database, worker-failure, and worker-staleness state.

After enough history exists, add anomaly monitors for unusually high `duplicate_records` and unusually low `received_records`, grouped by `source` in five-minute bins. Add match monitors for `api_rate_limited` and for `ingestion_complete` where `rejected_records > 0`. Baseline these warnings before paging because unchanged snapshots legitimately produce duplicates.

## Discord notifier

Axiom supports Discord directly; no custom bot belongs in this repository.

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

If Axiom is unavailable, valid ingestion continues. Inspect `docker compose logs worker`, `/api/health`, `/admin/ingestion`, and the PostgreSQL `ingestion_runs`, `ingestion_errors`, and `data_quality_events` records while hosted delivery recovers.

When a source-change monitor fires, locate its `run_id` and `ingestion_id` in the protected ingestion console, inspect the raw response already preserved in PostgreSQL, update the Zod parser and unknown-field allow-list only after understanding the upstream change, and resolve the database quality event after validation.
