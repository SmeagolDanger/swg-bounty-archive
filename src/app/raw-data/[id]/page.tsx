import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getRawIngestion } from "@/lib/data";
import { LocalDateTime } from "@/components/local-date-time";

export const metadata: Metadata = { title: "Raw source response" };
export const dynamic = "force-dynamic";

export default async function RawDataDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const row = await getRawIngestion(parsed.data);
  if (!row) notFound();
  const metadata = { source: row.source_key, runType: row.run_type, parameters: row.request_parameters, requestedAt: row.requested_at,
    responseReceivedAt: row.response_received_at, durationMs: row.duration_ms, httpStatus: row.http_status,
    schemaSignature: row.schema_signature, processingStatus: row.processing_status };
  return <div className="shell"><header className="page-head"><span className="eyebrow">{"// Immutable public source response"}</span><h1>Raw ingestion</h1><p>{row.endpoint}</p></header>
    <div className="notice">Ingestion {row.id} · parser {row.parser_version} · SHA-256 {row.payload_hash}</div>
    <div className="panel"><div className="panel-header"><h3>Public provenance</h3><Link className="button secondary" href="/raw-data">Back to search</Link></div><div className="target-summary"><div><span>Requested</span><b className="compact-value"><LocalDateTime value={row.requested_at}/></b></div><div><span>Response received</span><b className="compact-value"><LocalDateTime value={row.response_received_at}/></b></div></div><pre className="raw-json metadata-json">{JSON.stringify(metadata, null, 2)}</pre></div>
    <div className="panel raw-payload-panel"><div className="panel-header"><h3>Original JSON payload</h3><span className="chip">Exact archived source</span></div><pre className="raw-json">{JSON.stringify(row.payload, null, 2)}</pre></div>
  </div>;
}
