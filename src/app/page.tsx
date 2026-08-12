import Link from "next/link";
import { ActivityChart } from "@/components/activity-chart";
import { EncounterList } from "@/components/encounter-list";
import { BOARD_LABELS, getDashboard } from "@/lib/data";

export const dynamic = "force-dynamic";

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const stamp = (value: unknown) => value ? new Date(value as string).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.APP_TIMEZONE ?? "UTC" }) : "Awaiting first collection";

export default async function Home() {
  const data = await getDashboard();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "UTC" });
  const boards = Object.entries(BOARD_LABELS).map(([id, label]) => ({ id, label, rows: data.top.filter((row) => row.leaderboard_id === id) }));
  return <>
    <section className="hero"><div className="shell hero-grid">
      <div><span className="eyebrow">{"// Public intelligence network · live archive"}</span><h1>Every contract leaves a trace.</h1><p>A permanent, independently verified record of public SWG Legends Bounty Hunter standings and encounters—built for hunters who want the whole story, not just this week&apos;s rank.</p></div>
      <div className="source-stamp"><b>Last verified with SWG Legends</b>{stamp(data.ingestion.last_verified)}<br/>{data.ingestion.failed_ingestions ? `${data.ingestion.failed_ingestions} parser error(s) require review` : "Collector integrity nominal"}</div>
    </div></section>
    <section className="section"><div className="shell">
      <div className="section-head"><div><span className="kicker">Archive telemetry</span><h2>Network status</h2></div></div>
      <div className="metrics">
        <Link className="metric metric-link" href={`/encounters?from=${today}`}><dt>Encounters today</dt><dd>{number(data.stats.encounters_today)}</dd><small>{number(data.stats.encounters_week)} this week · drill down →</small></Link>
        <Link className="metric metric-link" href="/encounters"><dt>Total archived</dt><dd>{number(data.stats.encounters)}</dd><small>immutable encounter records →</small></Link>
        <Link className="metric metric-link" href="/hunters"><dt>Leaderboard hunters</dt><dd>{number(data.stats.hunters)}</dd><small>stable identities · open directory →</small></Link>
        <Link className="metric metric-link" href="/stats"><dt>History begins</dt><dd style={{fontSize: "22px"}}>{data.stats.history_start ? new Date(data.stats.history_start).toLocaleDateString("en-US", { dateStyle: "medium" }) : "Pending"}</dd><small>definitions and drilldowns →</small></Link>
      </div>
    </div></section>
    <section className="section"><div className="shell dashboard-grid">
      <div className="panel"><div className="panel-header"><h3>Recent encounters</h3><Link href="/encounters" className="chip">Open archive →</Link></div><EncounterList rows={data.recent}/></div>
      <div className="panel"><div className="panel-header"><h3>30-day activity</h3><span className="chip">Source events</span></div><ActivityChart data={data.activity}/></div>
    </div></section>
    <section className="section"><div className="shell">
      <div className="section-head"><div><span className="kicker">Current weekly transmission</span><h2>Top hunters</h2></div><Link href="/leaderboards">All standings →</Link></div>
      <div className="board-grid">{boards.map((board) => <div className="mini-board" key={board.id}><h3>{board.label}</h3>{board.rows.length ? board.rows.map((row) => <Link className="rank-row" href={`/hunter/${row.participant_id}`} key={`${board.id}-${row.participant_id}`}><span className="rank">{row.rank}</span><span>{row.current_name}<small>{row.guild_abbreviation ?? row.city_name ?? "Unaligned"}</small></span><span className="credits">{Number(row.score_raw).toLocaleString("en-US")}{row.value_type === "CREDITS" ? " cr" : ""}</span></Link>) : <div className="empty">Awaiting first board snapshot.</div>}</div>)}</div>
    </div></section>
    <section className="section"><div className="shell dashboard-grid">
      {(["guild","city"] as const).map((type) => <div className="panel" key={type}><div className="panel-header"><h3>Active {type === "guild" ? "guilds" : "cities"}</h3>{type === "guild" ? <Link className="chip" href="/guilds">Competition →</Link> : <span className="chip">Total kills</span>}</div>{data.activeGroups.filter((row) => row.subject === type).map((row) => <Link className="rank-row" href={`/${type}/${row.id}`} key={row.id}><span className="rank">{row.rank}</span><span>{row.current_name}<small>{row.guild_abbreviation ?? row.planet ?? "Source metadata unavailable"}</small></span><span className="credits">{number(row.score)}</span></Link>)}</div>)}
    </div></section>
  </>;
}
