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
| `GET /api/encounters` | Immutable encounter log with name, outcome, payout, and date filters (`tz`-aware); rows include `hunter_stats` (current-cycle + archive-total record for the hunter) |
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
curl -s "https://jawatracks.com/api/encounters?outcome=KILL&minCredits=50000" | jq '.rows[0]'
```

```json
{
  "event_at": "2026-08-13T00:10:09.000Z",
  "outcome": "KILL",
  "hunter_name": "-Eternal-",
  "target_name": "Eahi",
  "credits": 29549,
  "hunter_stats": {
    "cycle_starts_at": "2026-08-15T22:00:00.000Z",
    "cycle_ends_at": "2026-08-22T22:00:00.000Z",
    "cycle_encounters": 2, "cycle_kills": 2, "cycle_deaths": 0, "cycle_failures": 0, "cycle_credits": 45082,
    "overall_encounters": 3, "overall_kills": 3, "overall_deaths": 0, "overall_failures": 0, "overall_credits": 68025
  }
}
```

`cycle_deaths` and `overall_deaths` count both failed contracts by the hunter and successful claims against that player while they were the target. `cycle_failures` and `overall_failures` remain hunter-role failures only; `cycle_encounters` and `overall_encounters` remain hunter-role contract attempts, which are the denominators for claim rate.
