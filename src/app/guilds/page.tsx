import type { Metadata } from "next";
import Link from "next/link";
import { getGuildDirectory } from "@/lib/data";

export const metadata: Metadata = { title: "Guild competition" };
export const dynamic = "force-dynamic";
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;

export default async function GuildsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const sort = ["score", "winRate", "claims", "credits", "roster"].includes(one(query.sort) ?? "") ? one(query.sort) as "score" | "winRate" | "claims" | "credits" | "roster" : "score";
  const q = one(query.q)?.slice(0, 100);
  const data = await getGuildDirectory({ q, sort });
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Current rosters and collective performance"}</span><h1>Guild competition</h1><p>Source guild standings combined with encounter activity from currently affiliated player identities. Historical membership is unavailable, so roster-derived figures use each player’s latest archived guild abbreviation.</p></header>
    <dl className="metrics">
      <div className="metric"><dt>Guilds with rosters</dt><dd>{number(data.summary.guilds)}</dd><small>current abbreviations represented</small></div>
      <div className="metric"><dt>Rostered hunters</dt><dd>{number(data.summary.rostered_hunters)}</dd><small>tracked player identities</small></div>
      <div className="metric"><dt>Active hunters</dt><dd>{number(data.summary.active_hunters)}</dd><small>seen as hunter in event feed</small></div>
      <div className="metric"><dt>Guild claims</dt><dd>{number(data.summary.claims)}</dd><small>{number(data.summary.credits)} credits collected</small></div>
    </dl>
    <div className="notice directory-notice">Guild event statistics are derived through two exact links: event name → current player identity → current guild abbreviation. Leaderboard rank and score remain direct source observations.</div>
    <form className="filters rivalry-filters"><input className="field wide" name="q" defaultValue={q} placeholder="Guild name or abbreviation"/><select className="field" name="sort" defaultValue={sort}><option value="score">Source rank</option><option value="winRate">Best win rate</option><option value="claims">Most claims</option><option value="credits">Most credits</option><option value="roster">Largest roster</option></select><button className="button" type="submit">Apply</button></form>
    <div className="panel"><div className="panel-header"><h3>{number(data.rows.length)} guild intelligence files</h3><Link className="chip" href="/leaderboards?subject=guild">Source standings →</Link></div><div className="data-scroll"><table className="data-table guild-table"><thead><tr><th>Guild</th><th>Source standing</th><th>Roster</th><th>Active</th><th>Record</th><th>Win rate</th><th className="numeric">Credits</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td><Link className="entity-link" href={`/guild/${row.id}`}><b>{row.current_name}</b></Link><small>{row.guild_abbreviation || "No abbreviation"}</small></td><td>{row.rank ? <>#{row.rank}<small>{number(row.score)} total-kills score</small></> : "—"}</td><td>{row.roster_size}</td><td>{row.active_hunters}</td><td><span className="health-good">{row.wins}W</span> <span className="health-bad">{row.losses}L</span></td><td>{percent(row.win_rate)}</td><td className="numeric credits">{number(row.credits)} cr</td></tr>)}</tbody></table></div>{!data.rows.length && <div className="empty">No guilds match this filter.</div>}</div>
  </div>;
}
