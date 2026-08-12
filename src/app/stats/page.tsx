import type { Metadata } from "next";
import Link from "next/link";
import { getArchiveStats } from "@/lib/data";

export const metadata: Metadata = { title: "Archive statistics" };
export const dynamic = "force-dynamic";

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");

function EntityName({ id, name }: { id: unknown; name: unknown }) {
  return id ? <Link className="entity-link" href={`/hunter/${String(id)}`}>{String(name)}</Link> : <>{String(name)}</>;
}

export default async function StatsPage() {
  const data = await getArchiveStats();
  const kills = data.outcomes.find((row) => row.outcome === "KILL");
  const failures = data.outcomes.find((row) => row.outcome === "FAILED");
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Counts, scopes, and source boundaries"}</span><h1>Archive statistics</h1><p>A drilldown of what the dashboard counts. Leaderboard identities, encounter rows, and names found inside those rows are separate populations.</p></header>
    <dl className="metrics">
      <div className="metric"><dt>Leaderboard hunters</dt><dd>{number(data.summary.leaderboard_hunters)}</dd><small>unique stable player IDs</small></div>
      <div className="metric"><dt>Archived encounters</dt><dd>{number(data.summary.encounters)}</dd><small>one immutable row per event</small></div>
      <div className="metric"><dt>Encounter hunters</dt><dd>{number(data.summary.encounter_hunters)}</dd><small>distinct hunter names in events</small></div>
      <div className="metric"><dt>Encounter targets</dt><dd>{number(data.summary.encounter_targets)}</dd><small>distinct target names in events</small></div>
    </dl>
    <section className="section"><div className="dashboard-grid">
      <div className="panel"><div className="panel-header"><h3>Why the totals differ</h3><span className="chip">Source semantics</span></div><div className="definition-list"><p><b>Leaderboard hunters</b> are identities returned in weekly standings. A single board response can track dozens of hunters without creating any encounter.</p><p><b>Archived encounters</b> are individual events returned by the rolling activity feed. Each row has one hunter and one target.</p><p><b>Profile event stats</b> use exact-name matching because event rows do not include the stable participant IDs used by leaderboards.</p></div></div>
      <div className="panel"><div className="panel-header"><h3>Archive window</h3><span className="chip">Event time</span></div><div className="target-summary"><div><span>First event</span><b className="compact-value">{data.summary.history_start ? new Date(data.summary.history_start).toLocaleString("en-US") : "Pending"}</b></div><div><span>Latest event</span><b className="compact-value">{data.summary.history_end ? new Date(data.summary.history_end).toLocaleString("en-US") : "Pending"}</b></div><div><span>Claims</span><b className="health-good">{number(kills?.encounters)}</b></div><div><span>Failures</span><b className="health-bad">{number(failures?.encounters)}</b></div><div><span>Unique event names</span><b>{number(data.summary.unique_names)}</b></div><div><span>Groups tracked</span><b>{number(data.summary.guilds)} guilds · {number(data.summary.cities)} cities</b></div></div></div>
    </div></section>
    <section className="section"><div className="dashboard-grid">
      <div className="panel"><div className="panel-header"><h3>Most active hunters</h3><Link className="chip" href="/hunters">Full directory →</Link></div>{data.topHunters.map((row, index) => <div className="opponent-row" key={`${row.hunter_name}-${index}`}><span className="rank">{index + 1}</span><span><b><EntityName id={row.participant_id} name={row.hunter_name}/></b><small>{number(row.encounters)} events · {number(row.credits)} cr</small></span><span className="record"><b className="health-good">{row.wins}W</b> <b className="health-bad">{row.losses}L</b></span></div>)}</div>
      <div className="panel"><div className="panel-header"><h3>Most targeted</h3><Link className="chip" href="/encounters">Event log →</Link></div>{data.topTargets.map((row, index) => <div className="opponent-row" key={`${row.target_name}-${index}`}><span className="rank">{index + 1}</span><span><b><EntityName id={row.participant_id} name={row.target_name}/></b><small>{number(row.encounters)} times targeted</small></span><span className="record"><b className="health-good">{row.survived}S</b> <b className="health-bad">{row.killed}K</b></span></div>)}</div>
    </div></section>
  </div>;
}
