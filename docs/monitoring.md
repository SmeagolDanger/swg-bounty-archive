# Better Stack monitoring and alerting

Outer Rim Ledger treats PostgreSQL as its permanent audit and history store. Better Stack is an optional external layer for low-volume structured logs, collector heartbeats, uptime checks, and alerts. Collection does not call the Better Stack Logs API directly, and a Better Stack outage cannot stop or roll back ingestion.

## What is stored where

PostgreSQL retains every raw SWG response, response metadata, payload hash, typed schema signature, normalized immutable history, revisions, ingestion errors, and data-quality events. A parser failure is recorded only after the raw response has committed.

Schema baselines are separated by stable request path, including deterministic query parameters. This prevents legitimate nullable-field and empty-result differences between leaderboard variants from producing false schema-change alerts. Database events are still deduplicated by source and structural diff, so the same upstream change appearing across many leaderboard requests produces one unresolved alert rather than a flood.

An empty array proves that the field is still an array but provides no evidence about its member structure. Its raw signature is retained, but it is marked structurally inconclusive and neither replaces the last comparable baseline nor emits a removal alert for unseen members.

Application stdout/stderr contains compact JSON operational events: one run start, one run summary, exceptional request/parser/schema events, and worker lifecycle events. Logs deliberately exclude raw payloads, response/request headers, database URLs, credentials, cookies, and telemetry tokens. Better Stack receives only these operational logs when an external Docker log shipper is configured.

## 1. Create a log source and ship Docker output

In Better Stack, open **Telemetry → Sources → Connect source**, create a Docker source named `Outer Rim Ledger production`, then copy its source token and ingesting host. Store them outside Git; the example environment files provide blank `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_INGESTING_HOST` placeholders.

The application always emits JSON to standard stdout/stderr. On the VPS, use Better Stack's host-level Vector setup so network retries, buffering, and backpressure stay outside the collector process:

```bash
export SOURCE_TOKEN='paste-the-source-token-here'
curl -sSL "https://telemetry.betterstack.com/setup-vector/docker/$SOURCE_TOKEN" \
  -o /tmp/setup-vector.sh
less /tmp/setup-vector.sh
sudo bash /tmp/setup-vector.sh
sudo usermod -a -G docker vector
sudo systemctl restart vector
```

Verify in **Live tail**. Filter to the `outer-rim-ledger-worker` container and keep `debug` logs excluded. The worker emits no per-row and no routine per-request success logs, which keeps normal volume to roughly two run events plus one heartbeat every five minutes. The source token and ingesting host are shipper configuration; they are intentionally not passed into the application container.

To configure Vector manually, use an HTTP sink pointed at `https://$BETTERSTACK_INGESTING_HOST/` with bearer token `$BETTERSTACK_SOURCE_TOKEN`, JSON encoding, gzip compression, conservative disk buffering, and a `docker_logs` source filtered to the web and worker containers.

## 2. Configure the collector heartbeat

Create **Uptime → Heartbeats → Create heartbeat** named `Outer Rim Ledger collector`. Configure:

- expected frequency: 5 minutes;
- grace period: 4 minutes;
- escalation: immediate for a missed heartbeat;
- metadata: service `outer-rim-ledger`, component `collector`, severity `high`.

Put the secret URL into `.env.production`:

```dotenv
BETTERSTACK_HEARTBEAT_URL=https://uptime.betterstack.com/api/v1/heartbeat/REPLACE_ME
BETTERSTACK_HEARTBEAT_TIMEOUT_MS=3000
```

The worker sends the base URL only after a scheduled cycle finishes `SUCCEEDED`. `PARTIAL` and `FAILED` cycles call the same URL with `/fail`, using Better Stack's explicit failure semantics. Calls time out quickly; failures become local `betterstack_heartbeat_failed` warnings and are otherwise discarded. No heartbeat is sent when the URL is blank.

The 5-minute frequency plus 4-minute grace detects a dead or hung collector within approximately nine minutes while allowing retries and modest upstream latency. The public health endpoint independently uses a 15-minute default stale threshold (`HEALTH_WORKER_STALE_SECONDS=900`).

## 3. External HTTP monitor

Create an HTTP status monitor for:

```text
https://YOUR_PUBLIC_HOST/api/health
```

The response contains only safe state:

- `200`: web can reach PostgreSQL and the worker is starting, healthy, intentionally disabled, or reporting a recent partial run in the response body;
- `503` with `database: unavailable`: web cannot query PostgreSQL;
- `503` with `worker.status: stale`: neither a completed poll nor a recent initial worker heartbeat is within the configured threshold;
- `503` with `worker.status: failed`: the latest scheduled collection failed.

No exception traces, database addresses, tokens, or credentials are returned. Use the heartbeat monitor as the faster collector-loop signal and the HTTP monitor as the independent web/database/staleness signal.

## 4. Structured events and alert rules

Every event includes `timestamp`, `level`, and `event`. Relevant events also include `runId`, `ingestionId`, `sourceKey`, `endpoint`, `httpStatus`, `durationMs`, `parserVersion`, `schemaSignature`, `errorCode`, and `errorMessage`.

Recommended immediate/high-priority alerts:

- any `swg_api_schema_changed`;
- `swg_api_validation_failed` repeated at least twice in 15 minutes, or once when paired with `swg_api_schema_changed`;
- any `ingestion_run_failed`;
- collector heartbeat missing or explicitly failed;
- `/api/health` returning `503` on consecutive checks.

Recommended warning alerts:

- any new `swg_api_unknown_fields` (the application suppresses the same unresolved field set);
- `ingestion_run_partial`;
- `swg_api_http_error` or `swg_api_timeout` only after at least three occurrences across two or more distinct `runId` values in 15 minutes;
- repeated `swg_api_transport_error` across collection cycles.

Do not page on one timeout or one upstream HTTP 500. Run summaries make it possible to escalate transport noise only when it affects a whole run.

`swg_api_schema_changed` includes `previousSignature`, `newSignature`, `addedPaths`, `removedPaths`, and `changedTypes`. Paths inside arrays use stable `[]` notation, never numeric item indexes. Type arrays are sorted unions such as `null|string`; a new observed signature alerts only once, preventing five-minute alert repetition when known nullable shapes alternate.

## 5. Safe testing

Test log shipping before enabling paging by creating a temporary low-priority presence alert for `event = monitoring_test`, then emit a synthetic, payload-free Docker log:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  node -e 'process.stdout.write(JSON.stringify({timestamp:new Date().toISOString(),level:"warn",event:"monitoring_test"})+"\n")'
```

Confirm it appears in Live tail, then delete the temporary rule. To test heartbeat escalation, first route the monitor to email-only or put the service in a maintenance window, call the heartbeat URL with `/fail`, confirm the incident, and restore the desired escalation policy.

To exercise schema detection without touching production data, run the PostgreSQL integration suite against a disposable database. It imports synthetic payloads and verifies the raw response, schema diff, unknown-field deduplication, and structured events.

## 6. Disabling telemetry

To disable all external telemetry:

1. leave `BETTERSTACK_HEARTBEAT_URL`, `BETTERSTACK_SOURCE_TOKEN`, and `BETTERSTACK_INGESTING_HOST` blank;
2. stop/disable the host Vector service if no other workload uses it;
3. recreate the worker container.

Local JSON logging and PostgreSQL audit records remain active. No Better Stack component is a runtime dependency.

## Event investigation runbook

When `swg_api_schema_changed` fires:

1. note `runId`, `ingestionId`, source, signatures, and structural diff in Better Stack;
2. open `/admin/ingestion` and locate the data-quality event;
3. open the matching raw ingestion or query `/raw-data/{ingestionId}`;
4. inspect the complete payload preserved in PostgreSQL;
5. update the Zod parser and unknown-field allow-list only after understanding the upstream change;
6. deploy a new parser version and resolve the data-quality event after validation.

The alert intentionally contains the structural diagnosis but never the full upstream response.
