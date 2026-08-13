import type { Metadata } from "next";
import Link from "next/link";
import { getRivalries } from "@/lib/data";

export const metadata: Metadata = { title: "Rivalries" };
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const span = (start: unknown, end: unknown) => `${Math.max(0, Math.ceil((new Date(end as string).getTime() - new Date(start as string).getTime()) / 86_400_000))}d`;

export default async function RivalriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const sort = ["encounters", "closest", "revenge", "longest", "recent"].includes(one(query.sort) ?? "") ? one(query.sort) as "encounters" | "closest" | "revenge" | "longest" | "recent" : "encounters";
  const page = Math.max(1, Number(one(query.page) ?? 1) || 1);
  const q = one(query.q)?.slice(0, 100);
  const data = await getRivalries({ q, sort, page });
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (next: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "page" && value) params.set(key, value); params.set("page", String(next)); return `/rivalries?${params}`; };
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Repeat encounters and reversals"}</span><h1>Rivalry network</h1><p>Every pair with at least two archived encounters. A victory means either collecting the opposing bounty or surviving their failed contract.</p></header>
    <dl className="metrics">
      <div className="metric"><dt>Active rivalries</dt><dd>{number(data.summary.rivalries)}</dd><small>pairs with 2+ encounters</small></div>
      <div className="metric"><dt>Most encounters</dt><dd>{number(data.summary.most_encounters)}</dd><small>largest head-to-head series</small></div>
      <div className="metric"><dt>Revenge kills</dt><dd>{number(data.summary.revenge_kills)}</dd><small>killing the pair’s previous killer</small></div>
      <div className="metric"><dt>Longest span</dt><dd>{Math.ceil(Number(data.summary.longest_span_seconds ?? 0) / 86_400)}d</dd><small>first event to latest event</small></div>
    </dl>
    <form className="filters rivalry-filters"><input className="field wide" name="q" defaultValue={q} placeholder="Either rival"/><select className="field" name="sort" defaultValue={sort}><option value="encounters">Most encounters</option><option value="closest">Closest record</option><option value="revenge">Most revenge kills</option><option value="longest">Longest-running</option><option value="recent">Most recent</option></select><button className="button" type="submit">Apply</button></form>
    <div className="panel"><div className="panel-header"><h3>{number(data.total)} rivalry files</h3><span className="chip">Both encounter roles</span></div><div className="data-scroll"><table className="data-table rivalry-table mobile-cards"><thead><tr><th>Matchup</th><th>Head-to-head</th><th>Encounters</th><th>Revenge</th><th>Span</th><th className="numeric">Claims</th></tr></thead><tbody>{data.rows.map((row) => {
      const detail = row.side_a_participant_id ? `/rivalry/${row.side_a_participant_id}/${encodeURIComponent(row.side_b_name)}` : row.side_b_participant_id ? `/rivalry/${row.side_b_participant_id}/${encodeURIComponent(row.side_a_name)}` : null;
      const content = <><b>{row.side_a_name}</b><span className="versus">VS</span><b>{row.side_b_name}</b></>;
      return <tr key={`${row.side_a_key}-${row.side_b_key}`}><td data-label="Matchup" className="card-title">{detail ? <Link className="entity-link matchup" href={detail}>{content}</Link> : <span className="matchup">{content}</span>}</td><td data-label="Head-to-head"><span className="health-good">{row.side_a_wins}</span>–<span className="health-bad">{row.side_b_wins}</span></td><td data-label="Encounters">{row.encounters}</td><td data-label="Revenge">{row.revenge_kills}</td><td data-label="Span">{span(row.first_event_at, row.last_event_at)}</td><td data-label="Claims" className="numeric credits">{row.claims} · {number(row.credits)} cr</td></tr>;
    })}</tbody></table></div>{!data.rows.length && <div className="empty">No repeated matchups match this filter yet.</div>}<div className="pager"><span>Page {page} of {pageCount}</span><span>{page > 1 && <Link className="button secondary" href={href(page - 1)}>Previous</Link>} {page < pageCount && <Link className="button secondary" href={href(page + 1)}>Next</Link>}</span></div></div>
  </div>;
}
