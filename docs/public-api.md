# Public API

Outer Rim Ledger exposes every dataset on the site as read-only JSON for community projects. There is no key and no registration; responses allow any origin (CORS `*`), so browser applications can call the API directly. The canonical, always-current reference lives on the site itself at **`/api-docs`**.

Data originates from the public SWG Legends endpoints and is republished as an independent archive. Please credit "Outer Rim Ledger" with a link, keep request rates modest, and honor the `Cache-Control` headers.

## Guarantees

- **Read-only.** Only `GET` and `OPTIONS` are served. Nothing on the public API can modify the archive. Administrative surfaces live under `/admin`, require credentials, and never receive CORS headers.
- **Validated input.** Every query parameter is schema-validated; invalid input returns `400` with details, unknown ids return `404`, and malformed values are never interpolated into SQL (all queries are parameterized).
- **Rate limited.** Per client IP per minute (`PUBLIC_API_RATE_LIMIT_PER_MINUTE`, default 120). Exceeding it returns `429` with a `Retry-After` header.
- **Cached.** List endpoints send `Cache-Control: public, max-age=30, stale-while-revalidate=300`; archived raw responses cache for an hour; `/api/health` is never cached.
- **Stable, unversioned.** New fields may appear at any time. Renames and removals are avoided; when unavoidable they are called out in release notes.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/encounters` | Immutable encounter log with name, outcome, payout, and date filters (`tz`-aware) |
| `GET /api/hunters` | Hunter directory with board ranks and derived archive records |
| `GET /api/hunters/{id}` | Full dossier: history, encounters, opponents, rivalries, summaries, weekly GCW standings (`gcwStandings`), Officers' Salute commission (`officerSalute`) |
| `GET /api/guilds` | Guild standings combined with roster-derived activity |
| `GET /api/leaderboards` | Archived source leaderboards (`board`, `period`, `subject`) — Bounty Hunter and GCW boards (`GCW_IMPERIAL`, `GCW_REBEL`) |
| `GET /api/rivalries` | Repeat matchups with head-to-head records and revenge kills |
| `GET /api/search` | Trigram search across hunters, guilds, and cities |
| `GET /api/raw-data` | Full-text search over the lossless raw-response archive |
| `GET /api/raw-data/{id}` | One archived source response with its exact original payload |
| `GET /api/dashboard` | Aggregate snapshot: totals, recent activity, top boards |
| `GET /api/health` | Liveness of web, database, and collector (503 while degraded) |

Parameter tables, defaults, and worked examples for each endpoint are documented at `/api-docs` on the running site.

## Example

```bash
curl -s "https://YOUR-HOST/api/encounters?outcome=KILL&minCredits=50000" | jq '.rows[0]'
```

```json
{
  "event_at": "2026-08-13T00:10:09.000Z",
  "outcome": "KILL",
  "hunter_name": "-Eternal-",
  "target_name": "Eahi",
  "credits": 29549
}
```
