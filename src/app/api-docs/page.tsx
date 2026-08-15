import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Public API" };

interface Endpoint {
  path: string;
  summary: string;
  parameters: Array<[name: string, description: string]>;
  returns: string;
}

const endpoints: Endpoint[] = [
  {
    path: "/api/encounters",
    summary: "The immutable encounter log, newest first.",
    parameters: [
      ["q", "substring match on hunter or target name (≤100 chars)"],
      ["outcome", "KILL | FAILED"],
      ["minCredits / maxCredits", "inclusive payout bounds, non-negative integers"],
      ["from / to", "YYYY-MM-DD day bounds, interpreted in tz"],
      ["tz", "IANA timezone for day bounds (default UTC)"],
      ["page / pageSize", "pagination; pageSize 10–100 (default 25)"],
    ],
    returns: "{ rows, total, page, pageSize } — each row has event_at, outcome, hunter_name, target_name, credits, fingerprint, and participant ids when the name matches a leaderboard identity",
  },
  {
    path: "/api/hunters",
    summary: "Hunter directory: every player identity seen on a bounty leaderboard, with derived encounter stats.",
    parameters: [
      ["q", "substring match on hunter name or guild abbreviation"],
      ["activity", "all | seen | unseen (seen = has hunter-role events)"],
      ["sort", "name | winRate | encounters | credits | lastActive"],
      ["page", "pagination (25 per page)"],
    ],
    returns: "{ rows, total, page, pageSize, summary } — rows include current board ranks and archive record",
  },
  {
    path: "/api/hunters/{id}",
    summary: "Full dossier for one player identity (UUID from other endpoints).",
    parameters: [["id", "participant UUID (path segment)"]],
    returns: "{ participant, history, encounters, opponents, rivalries, hunterSummary, targetSummary, dailyActivity, gcwStandings, officerSalute } — gcwStandings holds the latest observation per GCW board per weekly period (rank, points, faction-share percent, best rank); officerSalute is the player's row in the current Officers' Salute registry or null; 404 when unknown",
  },
  {
    path: "/api/guilds",
    summary: "Guild competition table combining source standings with roster-derived encounter activity.",
    parameters: [
      ["q", "substring match on guild name or abbreviation"],
      ["sort", "score | winRate | claims | credits | roster"],
    ],
    returns: "{ rows, summary }",
  },
  {
    path: "/api/leaderboards",
    summary: "One archived source leaderboard snapshot with per-entry rank movement.",
    parameters: [
      ["board", "BOUNTY_HUNTER_GROUND_VALUE | BOUNTY_HUNTER_SPACE_VALUE | BOUNTY_HUNTER_UNIQUE_KILLS | BOUNTY_HUNTER_TOTAL_KILLS | GCW_IMPERIAL | GCW_REBEL (required)"],
      ["period", "CURRENT | PREVIOUS_1 | PREVIOUS_2 (default CURRENT)"],
      ["subject", "player | guild | city (default player)"],
    ],
    returns: "{ snapshot, entries } — score is the source display value, score_raw the raw source value (credits on value boards; a faction-share percent string on GCW boards)",
  },
  {
    path: "/api/rivalries",
    summary: "Every pair with at least two archived encounters, with head-to-head records and revenge kills.",
    parameters: [
      ["q", "substring match on either rival"],
      ["sort", "encounters | closest | revenge | longest | recent"],
      ["page", "pagination (25 per page)"],
    ],
    returns: "{ rows, total, page, pageSize, summary }",
  },
  {
    path: "/api/search",
    summary: "Trigram search across hunters, guilds, and cities.",
    parameters: [["q", "1–100 characters (required)"]],
    returns: "{ results } — id, participant_type, current_name, guild_abbreviation, planet, city_name, relevance",
  },
  {
    path: "/api/raw-data",
    summary: "Search the lossless archive of original SWG Legends JSON responses.",
    parameters: [
      ["q", "full-text search over payload keys and values (websearch syntax)"],
      ["source", "board_catalog | bounty_activity | leaderboard | leaderboard_wins | gcw_officers"],
      ["status", "PROCESSED | FAILED | HTTP_ERROR | RECEIVED"],
      ["from / to", "YYYY-MM-DD day bounds on response time, interpreted in tz"],
      ["tz", "IANA timezone for day bounds (default UTC)"],
      ["page", "pagination (25 per page)"],
    ],
    returns: "{ rows, total, page, pageSize, sources } — rows carry SHA-256 payload hash, schema signature, and parser version",
  },
  {
    path: "/api/raw-data/{id}",
    summary: "One archived source response with its exact original payload.",
    parameters: [["id", "ingestion UUID (path segment)"]],
    returns: "verification metadata plus the byte-exact archived JSON payload — 404 when unknown",
  },
  {
    path: "/api/dashboard",
    summary: "Aggregate snapshot: totals, recent encounters, top boards, 30-day activity series.",
    parameters: [["—", "no parameters"]],
    returns: "{ stats, recent, top, activity, activeGroups, ingestion }",
  },
  {
    path: "/api/health",
    summary: "Liveness of the web process, database, and collector worker.",
    parameters: [["—", "no parameters"]],
    returns: "{ status, database, worker, timestamp } — HTTP 503 while degraded; never cached",
  },
];

const exampleRequest = `curl -s "https://YOUR-HOST/api/encounters?outcome=KILL&minCredits=50000&page=1"`;
const exampleResponse = `{
  "rows": [
    {
      "id": "5b9c…",
      "event_at": "2026-08-13T00:10:09.000Z",
      "outcome": "KILL",
      "hunter_name": "-Eternal-",
      "target_name": "Eahi",
      "credits": 29549,
      "fingerprint": "89f2…",
      "hunter_participant_id": "8496…",
      "target_participant_id": null
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 25
}`;

export default function ApiDocsPage() {
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Machine-readable archive"}</span><h1>Public API</h1><p>Every dataset on this site is available as read-only JSON for community projects — no key, no registration. Responses allow any origin (CORS), so browser apps can call it directly.</p></header>
    <div className="notice">Data originates from the public SWG Legends endpoints and is republished here as an independent archive. Please credit “Outer Rim Ledger” with a link, keep request rates modest, and prefer cached responses — most endpoints allow 30-second caching.</div>

    <section className="section"><div className="dashboard-grid">
      <div className="panel"><div className="panel-header"><h3>Conventions</h3><span className="chip">GET only</span></div><div className="definition-list">
        <p><b>Requests.</b> Plain HTTPS GET with query parameters. Only GET and OPTIONS are served; nothing on this API can modify the archive.</p>
        <p><b>Responses.</b> JSON. Numbers are plain JSON numbers; timestamps are ISO&nbsp;8601 UTC. Unknown or unsupplied source fields are <code>null</code> — they are never guessed.</p>
        <p><b>Errors.</b> <code>400</code> invalid query (with zod issues where useful), <code>404</code> unknown id, <code>429</code> rate limited with a <code>Retry-After</code> header.</p>
        <p><b>Rate limit.</b> Per client IP per minute (default 120). Back off when you receive <code>429</code>.</p>
        <p><b>Caching.</b> List endpoints send <code>Cache-Control: public, max-age=30</code>; archived raw responses cache for an hour. Honoring these is the polite default.</p>
        <p><b>Stability.</b> The API is unversioned. New fields may appear at any time; renames or removals are avoided and announced in the repository’s release notes when unavoidable.</p>
      </div></div>
      <div className="panel"><div className="panel-header"><h3>Example</h3><span className="chip">Encounters</span></div>
        <pre className="raw-json">{exampleRequest}</pre>
        <pre className="raw-json" style={{ marginTop: 14 }}>{exampleResponse}</pre>
      </div>
    </div></section>

    <section className="section"><div className="section-head"><div><span className="kicker">Read-only endpoints</span><h2>Endpoint reference</h2></div><Link href="/raw-data">Browse raw archive →</Link></div>
      {endpoints.map((endpoint) => <div className="panel endpoint-panel" key={endpoint.path}>
        <div className="panel-header"><h3><code>GET {endpoint.path}</code></h3></div>
        <p className="endpoint-summary">{endpoint.summary}</p>
        <div className="data-scroll"><table className="data-table endpoint-table"><thead><tr><th>Parameter</th><th>Meaning</th></tr></thead><tbody>
          {endpoint.parameters.map(([name, description]) => <tr key={name}><td className="endpoint-param"><code>{name}</code></td><td>{description}</td></tr>)}
        </tbody></table></div>
        <p className="stat-definition"><b>Returns</b> {endpoint.returns}.</p>
      </div>)}
    </section>
  </div>;
}
