"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LocalDateTime } from "./local-date-time";

/** Serialised HunterOpponentRow: dates as ISO strings so the server can hand it to this client component. */
export interface OpponentLedgerRow {
  opponent_key: string;
  opponent: string;
  encounters: number;
  wins: number;
  losses: number;
  claims: number;
  survivals: number;
  contracts_taken: number;
  contracts_against: number;
  credits: number;
  credits_lost: number;
  first_event_at: string;
  last_event_at: string;
  win_rate: number | null;
  revenge_kills: number;
  participant_id: string | null;
  guild_abbreviation: string | null;
}

type SortKey = "encounters" | "wins" | "losses" | "winRate" | "credits" | "creditsLost" | "revenge" | "recent" | "name";
type Role = "all" | "hunted" | "huntedBy";

const PREVIEW_ROWS = 25;
const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;

const sorters: Record<SortKey, (a: OpponentLedgerRow, b: OpponentLedgerRow) => number> = {
  encounters: (a, b) => b.encounters - a.encounters || b.losses - a.losses,
  wins: (a, b) => b.wins - a.wins || b.encounters - a.encounters,
  losses: (a, b) => b.losses - a.losses || b.encounters - a.encounters,
  winRate: (a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1) || b.encounters - a.encounters,
  credits: (a, b) => b.credits - a.credits || b.encounters - a.encounters,
  creditsLost: (a, b) => b.credits_lost - a.credits_lost || b.encounters - a.encounters,
  revenge: (a, b) => b.revenge_kills - a.revenge_kills || b.encounters - a.encounters,
  recent: (a, b) => b.last_event_at.localeCompare(a.last_event_at),
  name: (a, b) => a.opponent.localeCompare(b.opponent, "en", { sensitivity: "base" }),
};

export function OpponentLedger({ rows, hunterId }: { rows: OpponentLedgerRow[]; hunterId: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("encounters");
  const [role, setRole] = useState<Role>("all");
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows
      .filter((row) => role === "all" || (role === "hunted" ? row.contracts_taken > 0 : row.contracts_against > 0))
      .filter((row) => !needle || row.opponent_key.includes(needle) || (row.guild_abbreviation ?? "").toLocaleLowerCase().includes(needle))
      .sort(sorters[sort]);
  }, [rows, query, sort, role]);

  const shown = expanded ? visible : visible.slice(0, PREVIEW_ROWS);

  if (!rows.length) return <div className="empty">No opponents are archived for this hunter yet.</div>;

  return <>
    <div className="ledger-toolbar">
      <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an opponent or guild" aria-label="Filter opponents"/>
      <select className="field" value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="Encounter role">
        <option value="all">Either role</option><option value="hunted">Targets I hunted</option><option value="huntedBy">Hunters who came for me</option>
      </select>
      <select className="field" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort opponents">
        <option value="encounters">Most encounters</option><option value="wins">Most wins</option><option value="losses">Most losses</option><option value="winRate">Best win rate</option>
        <option value="credits">Most credits taken</option><option value="creditsLost">Most credits lost</option><option value="revenge">Most revenge kills</option><option value="recent">Most recent</option><option value="name">Name</option>
      </select>
    </div>
    <div className="data-scroll"><table className="data-table ledger-table mobile-cards">
      <thead><tr><th>#</th><th>Opponent</th><th>Fights</th><th>Record</th><th>Win rate</th><th>Hunted them</th><th>Hunted me</th><th className="numeric">Taken</th><th className="numeric">Lost</th><th>Revenge</th><th>Span</th><th/></tr></thead>
      <tbody>{shown.map((row, index) => <tr key={row.opponent_key}>
        <td data-label="#" className="rank">{index + 1}</td>
        <td data-label="Opponent" className="card-title">{row.participant_id ? <Link className="entity-link" href={`/hunter/${row.participant_id}`}><b>{row.opponent}</b></Link> : <b>{row.opponent}</b>}{row.guild_abbreviation && <small>{row.guild_abbreviation}</small>}</td>
        <td data-label="Fights">{integer(row.encounters)}</td>
        <td data-label="Record" className="record"><b className="health-good">{integer(row.wins)}W</b> <b className="health-bad">{integer(row.losses)}L</b></td>
        <td data-label="Win rate">{percent(row.win_rate)}</td>
        <td data-label="Hunted them">{row.contracts_taken ? <><span className="health-good">{integer(row.claims)}</span> <span className="ledger-sub">claimed of {integer(row.contracts_taken)}</span></> : <span className="ledger-sub">never</span>}</td>
        <td data-label="Hunted me">{row.contracts_against ? <><span className="health-good">{integer(row.survivals)}</span> <span className="ledger-sub">survived of {integer(row.contracts_against)}</span></> : <span className="ledger-sub">never</span>}</td>
        <td data-label="Taken" className="numeric credits">{row.credits ? `${integer(row.credits)} cr` : "—"}</td>
        <td data-label="Lost" className="numeric">{row.credits_lost ? <span className="health-bad credits-lost">{integer(row.credits_lost)} cr</span> : "—"}</td>
        <td data-label="Revenge">{row.revenge_kills ? integer(row.revenge_kills) : "—"}</td>
        <td data-label="Span"><LocalDateTime value={row.first_event_at} kind="date"/>{row.first_event_at.slice(0, 10) !== row.last_event_at.slice(0, 10) && <small>to <LocalDateTime value={row.last_event_at} kind="date"/></small>}</td>
        <td data-label="Rivalry file"><Link className="entity-link ledger-file" href={`/rivalry/${hunterId}/${encodeURIComponent(row.opponent)}`}>File →</Link></td>
      </tr>)}</tbody>
    </table></div>
    <div className="pager"><span>{expanded || visible.length <= PREVIEW_ROWS ? `${integer(visible.length)} of ${integer(rows.length)} opponents${query || role !== "all" ? " match" : ""}` : `Top ${PREVIEW_ROWS} of ${integer(visible.length)} opponents`}</span><span>{visible.length > PREVIEW_ROWS && <button type="button" className="button secondary" onClick={() => setExpanded((value) => !value)}>{expanded ? `Show top ${PREVIEW_ROWS}` : `Show all ${integer(visible.length)}`}</button>} Sorted by {{ encounters: "encounters", wins: "wins", losses: "losses", winRate: "win rate", credits: "credits taken", creditsLost: "credits lost", revenge: "revenge kills", recent: "last encounter", name: "name" }[sort]}</span></div>
  </>;
}
