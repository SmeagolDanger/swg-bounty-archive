import type { Metadata } from "next";
import Link from "next/link";
import { BOARD_LABELS, getLeaderboard, isBoard, isPeriod, isSubject } from "@/lib/data";
import { BOUNTY_BOARD_IDS, PERIODS, SUBJECTS } from "@/lib/ingestion/config";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = { title: "Leaderboards" };
export const dynamic = "force-dynamic";
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const query = await searchParams;
  const board = isBoard(one(query.board) ?? "") ? one(query.board)! : BOUNTY_BOARD_IDS[0];
  const period = isPeriod(one(query.period) ?? "") ? one(query.period)! : "CURRENT";
  const subject = isSubject(one(query.subject) ?? "") ? one(query.subject)! : "player";
  const data = await getLeaderboard(board,period,subject);
  const selection = (overrides: Record<string,string>) => `/leaderboards?${new URLSearchParams({ board,period,subject,...overrides })}`;
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Weekly source standings"}</span><h1>Leaderboards</h1><p>Current and every historical weekly period made available by the public SWG Legends API. Raw scores are retained alongside display values.</p></header>
    <div className="tabbar">{BOUNTY_BOARD_IDS.map((id) => <Link key={id} className={id===board?"active":""} href={selection({board:id})}>{BOARD_LABELS[id]}</Link>)}</div>
    <div className="tabbar">{PERIODS.map((id,index) => <Link key={id} className={id===period?"active":""} href={selection({period:id})}>{["This week","Last week","2 weeks ago"][index]}</Link>)}</div>
    <div className="tabbar">{SUBJECTS.map((id) => <Link key={id} className={id===subject?"active":""} href={selection({subject:id})}>{id}</Link>)}</div>
    <div className="panel"><div className="panel-header"><div><h3>{BOARD_LABELS[board]} · {subject}</h3>{data.snapshot && <small style={{color:"var(--dim)"}}>Verified <LocalDateTime value={data.snapshot.source_fetched_at}/></small>}</div><span className="chip">{data.snapshot?.value_type ?? "Pending"}</span></div>
      {data.entries.length ? <div className="data-scroll"><table className="data-table"><thead><tr><th>Rank</th><th>Name</th><th>Affiliation</th><th>Movement</th><th className="numeric">Score</th></tr></thead><tbody>{data.entries.map((entry) => { const change = entry.previous_rank ? Number(entry.previous_rank)-Number(entry.rank) : null; return <tr key={entry.participant_id}><td className="rank">#{entry.rank}</td><td><Link href={`/${subject === "player" ? "hunter" : subject}/${entry.participant_id}`}>{entry.current_name}</Link></td><td>{entry.guild_abbreviation ?? entry.city_name ?? entry.planet ?? "—"}</td><td className={change && change > 0 ? "health-good" : change && change < 0 ? "health-bad" : ""}>{change === null ? "new" : change === 0 ? "—" : change > 0 ? `↑ ${change}` : `↓ ${Math.abs(change)}`}</td><td className="numeric credits">{Number(entry.score_raw).toLocaleString("en-US")}{data.snapshot.value_type === "CREDITS" ? " cr" : ""}</td></tr>;})}</tbody></table></div> : <div className="empty">This source period has not been archived yet.</div>}
    </div>
  </div>;
}
