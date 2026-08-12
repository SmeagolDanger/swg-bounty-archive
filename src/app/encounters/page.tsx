import type { Metadata } from "next";
import Link from "next/link";
import { getEncounters } from "@/lib/data";

export const metadata: Metadata = { title: "Encounter archive" };
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function EncountersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = Math.max(1, Number(one(query.page) ?? 1) || 1);
  const filters = {
    q: one(query.q)?.slice(0,100), outcome: one(query.outcome), from: one(query.from), to: one(query.to), page,
    minCredits: one(query.minCredits) ? Number(one(query.minCredits)) : undefined,
    maxCredits: one(query.maxCredits) ? Number(one(query.maxCredits)) : undefined,
  };
  const data = await getEncounters(filters);
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (next: number) => { const params = new URLSearchParams(); for (const [key,value] of Object.entries(query)) if (typeof value === "string" && key !== "page" && value) params.set(key,value); params.set("page",String(next)); return `?${params}`; };
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Immutable event log"}</span><h1>Encounter archive</h1><p>Every publicly exposed claim and failed contract captured by the collector. Filters reflect only fields actually supplied by SWG Legends.</p></header>
    <form className="filters">
      <input className="field wide" name="q" defaultValue={filters.q} placeholder="Hunter or target"/>
      <select className="field" name="outcome" defaultValue={filters.outcome ?? ""}><option value="">Any outcome</option><option value="KILL">Collected</option><option value="FAILED">Failed</option></select>
      <input className="field" name="minCredits" type="number" min="0" defaultValue={one(query.minCredits)} placeholder="Min bounty"/>
      <input className="field" name="maxCredits" type="number" min="0" defaultValue={one(query.maxCredits)} placeholder="Max bounty"/>
      <button className="button" type="submit">Filter log</button>
      <input className="field" name="from" type="date" defaultValue={filters.from}/><input className="field" name="to" type="date" defaultValue={filters.to}/>
    </form>
    <div className="panel"><div className="panel-header"><h3>{data.total.toLocaleString("en-US")} records</h3><span className="chip">Newest first</span></div><div className="data-scroll"><table className="data-table"><thead><tr><th>Timestamp</th><th>Hunter</th><th>Outcome</th><th>Target</th><th className="numeric">Payout</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{new Date(row.event_at).toLocaleString("en-US")}</td><td>{row.hunter_participant_id ? <Link className="entity-link" href={`/hunter/${row.hunter_participant_id}`}>{row.hunter_name}</Link> : row.hunter_name}</td><td><span className={`status ${row.outcome.toLowerCase()}`}>{row.outcome === "KILL" ? "Collected" : "Failed"}</span></td><td>{row.target_participant_id ? <Link className="entity-link" href={`/hunter/${row.target_participant_id}`}>{row.target_name}</Link> : row.target_name}</td><td className="numeric credits">{row.outcome === "KILL" ? `${Number(row.credits).toLocaleString("en-US")} cr` : "—"}</td></tr>)}</tbody></table></div>
      {!data.rows.length && <div className="empty">No encounters match these filters.</div>}
      <div className="pager"><span>Page {page} of {pageCount}</span><span>{page > 1 && <Link className="button secondary" href={href(page-1)}>Previous</Link>} {page < pageCount && <Link className="button secondary" href={href(page+1)}>Next</Link>}</span></div>
    </div>
  </div>;
}
