import type { Metadata } from "next";
import { CompareBuilder } from "@/components/compare-builder";
import { ALL_BOARD_LABELS, getParticipant } from "@/lib/data";

export const metadata: Metadata = { title: "Compare hunters" };
export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ids?:string}> }) {
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean).slice(0,5);
  const dossiers = (await Promise.all(ids.map((id)=>getParticipant(id,"player")))).filter(Boolean);
  const rows = dossiers.map((dossier) => {
    const latest = new Map<string,Record<string,unknown>>(); for (const row of dossier!.history) if (!latest.has(row.leaderboard_id)) latest.set(row.leaderboard_id,row);
    return { dossier:dossier!,latest,hunter:dossier!.hunterSummary };
  });
  const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
  const metricRows: Array<[string, (hunter: Record<string, unknown> | null) => string]> = [
    ["Contracts attempted", (hunter) => integer(hunter?.encounters)],
    ["Successful claims", (hunter) => integer(hunter?.wins)],
    ["Win rate", (hunter) => hunter?.win_rate === null || hunter?.win_rate === undefined ? "—" : `${Math.round(Number(hunter.win_rate) * 100)}%`],
    ["Credits claimed", (hunter) => integer(hunter?.credits)],
    ["Unique targets", (hunter) => integer(hunter?.unique_targets)],
  ];
  return <div className="shell"><header className="page-head"><span className="eyebrow">{"// Side-by-side intelligence"}</span><h1>Hunter comparison</h1><p>Compare only observations actually present in the archive. Empty cells mean the source has not supplied that metric. Encounter rows count the hunter role only.</p></header><CompareBuilder initialIds={ids}/>
    {rows.length>=2?<div className="panel"><div className="data-scroll"><table className="data-table compare-table"><thead><tr><th>Metric</th>{rows.map((row)=><th key={row.dossier.participant.id}>{row.dossier.participant.current_name}</th>)}</tr></thead><tbody>
      {Object.entries(ALL_BOARD_LABELS).map(([id,label])=><tr key={id}><td>{label}</td>{rows.map((row)=>{const value=row.latest.get(id);if(!value)return <td key={row.dossier.participant.id}>—</td>;const raw=String(value.score_raw);const display=raw.endsWith("%")?`${Number.parseFloat(raw).toFixed(2)}%`:`${Number(raw).toLocaleString("en-US")}${id.includes("VALUE")?" cr":""}`;return <td key={row.dossier.participant.id}>{display}</td>;})}</tr>)}
      {metricRows.map(([label,render])=><tr key={label}><td>{label}</td>{rows.map((row)=><td key={row.dossier.participant.id}>{render(row.hunter)}</td>)}</tr>)}
    </tbody></table></div></div>:<div className="empty">Select at least two hunters to begin comparison.</div>}
  </div>;
}
