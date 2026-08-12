import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EncounterList } from "@/components/encounter-list";
import { getRivalryDetail } from "@/lib/data";

export const metadata: Metadata = { title: "Rivalry file" };
export const dynamic = "force-dynamic";
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");

export default async function RivalryPage({ params }: { params: Promise<{ hunterId: string; opponent: string }> }) {
  const { hunterId, opponent } = await params;
  let opponentName = opponent;
  try { opponentName = decodeURIComponent(opponent); } catch { notFound(); }
  const data = await getRivalryDetail(hunterId, opponentName);
  if (!data) notFound();
  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{"// Head-to-head intelligence file"}</span><h1 className="rivalry-title"><Link href={`/hunter/${data.hunter.id}`}>{data.hunter.current_name}</Link><span>vs</span>{data.opponent.id ? <Link href={`/hunter/${data.opponent.id}`}>{data.opponent.current_name}</Link> : data.opponent.current_name}</h1><p>This record counts success from either role: a collected contract wins for the hunter; a failed contract wins for the target.</p></header>
    <dl className="metrics profile-metrics">
      <div className="metric record-metric"><dt>Head-to-head</dt><dd><span className="health-good">{data.summary.hunterWins}W</span> <span className="health-bad">{data.summary.opponentWins}L</span></dd><small>{Math.round(Number(data.summary.winRate ?? 0) * 100)}% win rate</small></div>
      <div className="metric"><dt>Encounters</dt><dd>{data.summary.encounters}</dd><small>{new Date(data.summary.firstEventAt).toLocaleDateString("en-US")} – {new Date(data.summary.lastEventAt).toLocaleDateString("en-US")}</small></div>
      <div className="metric"><dt>Claims</dt><dd>{data.summary.hunterClaims}</dd><small>{number(data.summary.hunterCredits)} credits collected</small></div>
      <div className="metric"><dt>Survivals</dt><dd>{data.summary.hunterSurvivals}</dd><small>opponent contracts failed</small></div>
      <div className="metric"><dt>Revenge kills</dt><dd>{data.summary.revengeKills}</dd><small>killed the previous killer in this pair</small></div>
      <div className="metric"><dt>Opponent guild</dt><dd className="compact-dd">{data.opponent.guild_abbreviation || "—"}</dd><small>current leaderboard metadata</small></div>
    </dl>
    <section className="section"><div className="panel"><div className="panel-header"><h3>Rivalry timeline</h3><span className="chip">Newest first</span></div><EncounterList rows={data.events}/></div></section>
  </div>;
}
