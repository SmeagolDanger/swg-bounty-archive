import type { Metadata } from "next";
import Link from "next/link";
import { getHunterDirectory } from "@/lib/data";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = { title: "Hunter directory" };
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;

export default async function HuntersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const activity = ["seen", "unseen"].includes(one(query.activity) ?? "") ? one(query.activity) as "seen" | "unseen" : "all";
  const sort = ["name", "winRate", "encounters", "credits", "lastActive"].includes(one(query.sort) ?? "") ? one(query.sort) as "name" | "winRate" | "encounters" | "credits" | "lastActive" : "encounters";
  const page = Math.max(1, Number(one(query.page) ?? 1) || 1);
  const q = one(query.q)?.slice(0, 100);
  const data = await getHunterDirectory({ q, activity, sort, page });
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (next: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "page" && value) params.set(key, value); params.set("page", String(next)); return `/hunters?${params}`; };
  const unmatched = Number(data.summary.leaderboard_hunters) - Number(data.summary.matched_hunters);

  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Stable identities and derived activity"}</span><h1>Hunter directory</h1><p>The directory starts with every player identity seen on a bounty leaderboard. Encounter columns are added only when the event feed contains an exact matching hunter name.</p></header>
    <dl className="metrics">
      <div className="metric"><dt>Leaderboard hunters</dt><dd>{number(data.summary.leaderboard_hunters)}</dd><small>stable SWG participant IDs</small></div>
      <div className="metric"><dt>Matched to events</dt><dd>{number(data.summary.matched_hunters)}</dd><small>exact current-name matches</small></div>
      <div className="metric"><dt>No hunter events yet</dt><dd>{number(unmatched)}</dd><small>still have leaderboard profiles</small></div>
      <div className="metric"><dt>Archived events</dt><dd>{number(data.summary.encounters)}</dd><small>{number(data.summary.encounter_hunters)} distinct hunter names</small></div>
    </dl>
    <div className="notice directory-notice">One event can add activity to one hunter, while one leaderboard snapshot can introduce many hunter identities. These totals measure different things and are not expected to match.</div>
    <form className="filters hunter-filters">
      <input className="field wide" name="q" defaultValue={q} placeholder="Hunter or guild"/>
      <select className="field" name="activity" defaultValue={activity}><option value="all">Any activity</option><option value="seen">Seen as hunter</option><option value="unseen">No hunter events</option></select>
      <select className="field" name="sort" defaultValue={sort}><option value="encounters">Most encounters</option><option value="winRate">Best win rate</option><option value="credits">Most credits</option><option value="lastActive">Most recent</option><option value="name">Name</option></select>
      <button className="button" type="submit">Apply</button>
    </form>
    <div className="panel"><div className="panel-header"><h3>{number(data.total)} hunter profiles</h3><Link className="chip" href="/stats">Stat definitions →</Link></div>
      <div className="data-scroll"><table className="data-table hunter-table mobile-cards"><thead><tr><th>Hunter</th><th>Total-kills board</th><th>Archive record</th><th>Win rate</th><th className="numeric">Credits</th><th>Last active</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td data-label="Hunter" className="card-title"><Link className="entity-link" href={`/hunter/${row.id}`}><b>{row.current_name}</b></Link><small>{row.guild_id ? <Link href={`/guild/${row.guild_id}`}>{row.guild_abbreviation}</Link> : row.guild_abbreviation ?? row.city_name ?? "Unaligned"}</small></td><td data-label="Total-kills board">{row.total_kills_rank ? <>#{row.total_kills_rank}<small>{number(row.total_kills_score)} score</small></> : "—"}</td><td data-label="Archive record"><span className="health-good">{number(row.wins)}W</span> <span className="health-bad">{number(row.losses)}L</span><small>{number(row.encounters)} events</small></td><td data-label="Win rate">{percent(row.win_rate)}</td><td data-label="Credits" className="numeric credits">{number(row.credits_claimed)} cr</td><td data-label="Last active">{row.last_active_at ? <LocalDateTime value={row.last_active_at} kind="date"/> : "Not observed"}</td></tr>)}</tbody></table></div>
      {!data.rows.length && <div className="empty">No hunters match these filters.</div>}
      <div className="pager"><span>Page {page} of {pageCount}</span><span>{page > 1 && <Link className="button secondary" href={href(page - 1)}>Previous</Link>} {page < pageCount && <Link className="button secondary" href={href(page + 1)}>Next</Link>}</span></div>
    </div>
  </div>;
}
