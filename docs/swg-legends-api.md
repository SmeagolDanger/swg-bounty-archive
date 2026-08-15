# SWG Legends public Bounty Hunter API discovery

Investigation date: 2026-08-12 UTC. Source: the public [SWG Legends leaderboards](https://swglegends.com/game/leaderboards) page, its server-rendered state, and its public JavaScript bundle `LeaderboardsPage-D5TgJnAC.js`. No authentication, restricted route, or access-control bypass was used.

## Findings

The site is a Vue client served by Express with server-rendered/dehydrated query data. Its JSON endpoints are same-origin under `/api`. The leaderboards page bundle calls exactly four relevant read-only GET shapes. No GraphQL, WebSocket, SSE, Next.js data endpoint, server action, character profile endpoint, encounter-detail endpoint, or public pagination parameter is used for Bounty Hunter data.

Responses currently carry `Cache-Control: public, max-age=60`. The client applies a 10 minute stale time to the bounty activity aggregate, 15 minutes to the board catalog, 5 minutes to leaderboard rows, and 30 minutes to wins. Those client values are UI cache behavior, not a server update guarantee. This archive defaults to a conservative five-minute cycle and honors `Retry-After` if returned.

### `GET /api/game/leaderboards`

- Parameters: none.
- Response: `{ boards: Board[], fetchedAt: ISO-8601 }`.
- Board identifiers are uppercase strings. The Bounty Hunter boards found were `BOUNTY_HUNTER_GROUND_VALUE` (`trackerOid` `60516`, `CREDITS`), `BOUNTY_HUNTER_SPACE_VALUE` (`60517`, `CREDITS`), `BOUNTY_HUNTER_UNIQUE_KILLS` (`60518`, `RAW`), and `BOUNTY_HUNTER_TOTAL_KILLS` (`60519`, `RAW`).
- GCW boards (verified 2026-08-15, category `GCW`): `GCW_IMPERIAL` (`60500`, `PERCENT`) and `GCW_REBEL` (`60501`, `PERCENT`). Both expose all three subjects (`player`, `guild`, `city`) and the same three weekly periods. For `PERCENT` boards, `score` is the raw GCW point total and `scoreRaw` is the faction-share **percent string** (e.g. `"7.8584846559953885%"`) — the only board family whose `scoreRaw` is not a plain decimal string. Guild-subject entries carry `faction` (`Imperial`/`Rebel`); the wins feed works for GCW board ids and returns guild and city wins only.
- Each board includes `id`, `trackerOid`, `name`, `category`, `valueType`, `periodStartTime`, and `periodEndTime`. Period timestamps are Unix seconds.
- Pagination: none.
- Relationship: discovers boards and the current period used by the parameterized feeds.

### `GET /api/game/leaderboard`

- Required query parameters: `id`, `period`, `subject`.
- Public UI values: `period=CURRENT|PREVIOUS_1|PREVIOUS_2`; `subject=player|guild|city`. Arena boards restrict subjects, but all three are used for Bounty Hunter boards.
- Response: `{ id, period, subject, valueType, totalScore, periodStartTime, periodEndTime, entries, fetchedAt }`.
- Entry: `{ rank, participantId, name, score, scoreRaw, guildAbbreviation, faction, planet, cityName }`; nullable context fields depend on subject.
- `participantId` is the stable source identity. Names are not identities.
- `scoreRaw` is a decimal string. For `CREDITS` boards, `score` is heca-credits and `scoreRaw` is credits (`score * 100` in inspected responses). Both are archived without recomputation. The Legends UI renders `score * 100`.
- Pagination: none; the full available list is returned.
- History: the public UI exposes exactly the current week and two prior weekly periods. Arbitrary timestamps/ranges were not discovered and are not invented by this project.

Example (trimmed):

```json
{"id":"BOUNTY_HUNTER_GROUND_VALUE","period":"CURRENT","subject":"player","valueType":"CREDITS","entries":[{"rank":1,"participantId":"...","name":"...","score":114383,"scoreRaw":"11438300","guildAbbreviation":"...","faction":null,"planet":null,"cityName":"..."}],"fetchedAt":"2026-08-12T01:14:11.491Z"}
```

### `GET /api/game/leaderboard-wins`

- Required query parameter: `id`.
- Response: `{ id, cityWins, guildWins, fetchedAt }`.
- Win entry: `{ rank, participantId, name, wins, guildAbbreviation, faction, planet }`.
- Pagination: none.
- Relationship: all-time/retained weekly win counts presented beside a selected board. The response does not include player wins.

### `GET /api/game/bounty-hunting`

- Parameters: none were used or discoverable in the public client.
- Response: `{ windowDays, summary, hunters, targets, survivors, recent, fetchedAt }`.
- `windowDays` was 14. The response contained top-ten aggregate arrays and 12 recent encounters at inspection time.
- Summary: `kills`, `failures`, `encounters`, `successRate`, `creditsPaid`, `averageBounty`, `distinctHunters`, `distinctTargets`, and nullable `largestBounty`.
- Hunter aggregate: `rank`, `name`, `kills`, `failures`, `encounters`, `successRate`, `creditsEarned`.
- Target/survivor aggregate: `rank`, `name`, `timesKilled`, `timesSurvived`, `encounters`, `survivalRate`.
- Recent encounter: `timestamp`, `outcome` (`KILL` or `FAILED` observed), `hunterName`, `targetName`, `credits`.
- No encounter ID, character ID, guild, city, faction, profession, location, planet, system, or ground/space field is exposed. These are therefore not populated as facts.
- Pagination/history: none exposed. Only the rolling aggregate and 12 recent rows are public. Continuous polling is required to build an archive; a complete pre-launch encounter backfill is impossible from this public endpoint.
- Deduplication: because no encounter ID exists, this project hashes the exact stable source tuple `(source, timestamp, outcome, hunterName, targetName, credits)`. Collection time is excluded.

Example:

```json
{"timestamp":"2026-08-12T00:56:07.000Z","outcome":"KILL","hunterName":"Shepard EffectMass","targetName":"Yigo Shiddo","credits":27065}
```

### `GET /api/game/gcw-officers`

- Discovered 2026-08-15 from the public "Officers' Salute" page (`/game/gcw-officers`) and its bundle.
- Required query parameter: `faction` (`IMPERIAL` or `REBEL`). No pagination parameter is used by the public client; the response is capped at 250 rows per faction while `totalResults` reports the full population.
- Response: `{ faction, officers, totalResults, fetchedAt }`.
- Officer entry: `{ oid, name, factionName, rankIndex, rankName, currentGcwPoints, currentPvpKills, lifetimeGcwPoints, lifetimePvpKills, profession, guildName, guildAbbreviation, residentPlanet, residentCityName }`.
- `oid` is the same stable participant identity used by the leaderboard feeds. Rows span every GCW rank (1 Private through 12 General), with faction-specific rank names; commissioned officers are `rankIndex >= 7` (Lieutenant and above).
- `currentGcwPoints`/`currentPvpKills` are the running weekly totals; `lifetime*` fields are all-time. This archive snapshots the registry state per faction and dedupes identical observations on a content hash.

## Headers and validation behavior

No custom request headers or credentials are required beyond ordinary JSON `Accept`. Responses are JSON and include `fetchedAt`. Collection records preserve all response headers, status, request parameters, payload, SHA-256, timing, parser version, and schema signature. Parameter values are allow-listed locally; invalid combinations are never forwarded.

## Refresh and archive limitations

The public endpoint gives no authoritative last-modified timestamp for an individual encounter or entry. `fetchedAt` is recorded separately from collection time. Encounter event timestamps are never replaced with collection time. Because the rolling encounter response is capped, an outage can create an unrecoverable gap; the health dashboard calls this out and the default schedule is intentionally more frequent than the UI's ten-minute stale window.

The application stores unknown properties in raw JSON and records schema-signature changes. A changed historical row creates a revision instead of overwriting the earlier snapshot.
