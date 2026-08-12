import type { Metadata } from "next";
import Link from "next/link";
import { getRawData } from "@/lib/data";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = { title: "Raw data search" };
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const bytes = (value: unknown) => { const size = Number(value ?? 0); return size >= 1_048_576 ? `${(size / 1_048_576).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`; };

export default async function RawDataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const statusValue = one(query.status);
  const status = ["PROCESSED", "FAILED", "HTTP_ERROR", "RECEIVED"].includes(statusValue ?? "") ? statusValue as "PROCESSED" | "FAILED" | "HTTP_ERROR" | "RECEIVED" : undefined;
  const filters = { q: one(query.q)?.slice(0, 160), source: one(query.source)?.slice(0, 80), status, from: one(query.from), to: one(query.to), page: Math.max(1, Number(one(query.page) ?? 1) || 1) };
  const data = await getRawData(filters);
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (next: number) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "page" && value) params.set(key, value); params.set("page", String(next)); return `/raw-data?${params}`; };
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Lossless public source archive"}</span><h1>Raw data search</h1><p>Search the original JSON responses retained from the public SWG Legends endpoints. Payloads are shown exactly as received; normalization never replaces this source record.</p></header>
    <div className="notice">This public view exposes source payloads and verification metadata only. Response headers, internal errors, and operational diagnostics remain in the protected ingestion console.</div>
    <form className="filters raw-filters">
      <input className="field wide" name="q" defaultValue={filters.q} placeholder="Search payload names, values, or keys"/>
      <select className="field" name="source" defaultValue={filters.source ?? ""}><option value="">Every source</option>{data.sources.map((source) => <option value={source.source_key} key={source.source_key}>{source.source_key} ({source.responses})</option>)}</select>
      <select className="field" name="status" defaultValue={filters.status ?? ""}><option value="">Any status</option><option value="PROCESSED">Processed</option><option value="FAILED">Failed</option><option value="HTTP_ERROR">HTTP error</option><option value="RECEIVED">Received</option></select>
      <input className="field" name="from" type="date" defaultValue={filters.from}/><input className="field" name="to" type="date" defaultValue={filters.to}/>
      <button className="button" type="submit">Search source</button>
    </form>
    <div className="tabbar"><Link className={!filters.source ? "active" : ""} href="/raw-data">All responses</Link>{data.sources.map((source) => <Link key={source.source_key} className={filters.source === source.source_key ? "active" : ""} href={`/raw-data?source=${encodeURIComponent(source.source_key)}`}>{source.source_key} · {source.responses}</Link>)}</div>
    <div className="panel"><div className="panel-header"><h3>{data.total.toLocaleString("en-US")} source responses</h3><span className="chip">Newest first</span></div><div className="data-scroll"><table className="data-table raw-table"><thead><tr><th>Received</th><th>Source response</th><th>Status</th><th>Size</th><th>Verification</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td><LocalDateTime value={row.response_received_at}/></td><td><Link className="entity-link" href={`/raw-data/${row.id}`}><b>{row.source_key}</b></Link><small>{row.endpoint}</small>{filters.q && <code className="raw-preview">{row.preview}</code>}</td><td><span className={`status ${row.processing_status === "PROCESSED" ? "kill" : "error"}`}>{row.http_status} {row.processing_status}</span><small>{row.duration_ms} ms</small></td><td>{bytes(row.payload_bytes)}</td><td><code>{String(row.payload_hash ?? "unhashed").slice(0, 16)}…</code><small>parser {row.parser_version}</small></td></tr>)}</tbody></table></div>{!data.rows.length && <div className="empty">No raw responses match this search.</div>}<div className="pager"><span>Page {data.page} of {pageCount}</span><span>{data.page > 1 && <Link className="button secondary" href={href(data.page - 1)}>Previous</Link>} {data.page < pageCount && <Link className="button secondary" href={href(data.page + 1)}>Next</Link>}</span></div></div>
  </div>;
}
