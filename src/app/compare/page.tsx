import type { Metadata } from "next";
import { CompareBuilder } from "@/components/compare-builder";
import { BOARD_LABELS, getParticipant } from "@/lib/data";
import { deriveActivityMetrics } from "@/lib/analytics/metrics";

export const metadata: Metadata = { title: "Compare hunters" };
export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ids?:string}> }) {
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean).slice(0,5);
  const dossiers = (await Promise.all(ids.map((id)=>getParticipant(id,"player")))).filter(Boolean);
  const rows = dossiers.map((dossier) => {
    const latest = new Map<string,Record<string,unknown>>(); for (const row of dossier!.history) if (!latest.has(row.leaderboard_id)) latest.set(row.leaderboard_id,row);
    const metrics=deriveActivityMetrics(dossier!.encounters.map((row)=>({outcome:row.outcome,credits:Number(row.credits),opponent:row.hunter_name.toLowerCase()===dossier!.participant.current_name.toLowerCase()?row.target_name:row.hunter_name})));
    return { dossier:dossier!,latest,metrics };
  });
  return <div className="shell"><header className="page-head"><span className="eyebrow">{"// Side-by-side intelligence"}</span><h1>Hunter comparison</h1><p>Compare only observations actually present in the archive. Empty cells mean the source has not supplied that metric.</p></header><CompareBuilder initialIds={ids}/>
    {rows.length>=2?<div className="panel data-scroll"><table className="data-table"><thead><tr><th>Metric</th>{rows.map((row)=><th key={row.dossier.participant.id}>{row.dossier.participant.current_name}</th>)}</tr></thead><tbody>
      {Object.entries(BOARD_LABELS).map(([id,label])=><tr key={id}><td>{label}</td>{rows.map((row)=>{const value=row.latest.get(id);return <td key={row.dossier.participant.id}>{value?`${Number(value.score_raw).toLocaleString("en-US")}${id.includes("VALUE")?" cr":""}`:"—"}</td>;})}</tr>)}
      {[ ["Archived encounters","encounters"],["Successful claims","kills"],["Success rate","successRate"],["Credits claimed","credits"],["Unique opponents","uniqueOpponents"] ].map(([label,key])=><tr key={key}><td>{label}</td>{rows.map((row)=><td key={row.dossier.participant.id}>{key==="successRate"?(row.metrics.successRate===null?"—":`${Math.round(row.metrics.successRate*100)}%`):Number(row.metrics[key as keyof typeof row.metrics]??0).toLocaleString("en-US")}</td>)}</tr>)}
    </tbody></table></div>:<div className="empty">Select at least two hunters to begin comparison.</div>}
  </div>;
}
