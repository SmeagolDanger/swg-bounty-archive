import Link from "next/link";
import type { EncounterHunterStats } from "@/lib/data";
import { LocalDateTime } from "./local-date-time";

const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const credits = (value: unknown) => `${integer(value)} cr`;
const rate = (wins: unknown, encounters: unknown) => {
  const total = Number(encounters ?? 0);
  return total ? `${Math.round((Number(wins ?? 0) / total) * 100)}%` : "—";
};

function HunterLink({ id, name }: { id: unknown; name: unknown }) {
  return id ? <Link className="entity-link" href={`/hunter/${String(id)}`}>{String(name)}</Link> : <b>{String(name)}</b>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "credits" }) {
  return <div className="encounter-stat"><span>{label}</span><b className={tone === "good" ? "health-good" : tone === "bad" ? "health-bad" : tone === "credits" ? "credits" : undefined}>{value}</b></div>;
}

function HunterStats({ row }: { row: Record<string, unknown> }) {
  const stats = row.hunter_stats as EncounterHunterStats | null | undefined;
  if (!stats) return <div className="encounter-detail-empty">No hunter-role summary is available for this name.</div>;
  const cycleDates = stats.cycle_starts_at
    ? <><LocalDateTime value={stats.cycle_starts_at} kind="date"/> – {stats.cycle_ends_at ? <LocalDateTime value={stats.cycle_ends_at} kind="date"/> : "present"}</>
    : "Period unavailable";

  return <div className="encounter-detail">
    <div className="encounter-detail-head">
      <div><span>Hunter record</span><strong>{String(row.hunter_name)}</strong></div>
      <small>Deaths include failed contracts and times killed while targeted</small>
    </div>
    <div className="encounter-stat-groups">
      <section className="encounter-stat-group">
        <header><b>Current cycle</b><small>{cycleDates}</small></header>
        <div className="encounter-stat-grid">
          <Stat label="Kills" value={integer(stats.cycle_kills)} tone="good"/>
          <Stat label="Deaths" value={integer(stats.cycle_deaths)} tone="bad"/>
          <Stat label="Claim rate" value={rate(stats.cycle_kills, stats.cycle_encounters)}/>
          <Stat label="Credits" value={credits(stats.cycle_credits)} tone="credits"/>
        </div>
      </section>
      <section className="encounter-stat-group">
        <header><b>Archive total</b><small>{integer(stats.overall_encounters)} contracts</small></header>
        <div className="encounter-stat-grid">
          <Stat label="Kills" value={integer(stats.overall_kills)} tone="good"/>
          <Stat label="Deaths" value={integer(stats.overall_deaths)} tone="bad"/>
          <Stat label="Claim rate" value={rate(stats.overall_kills, stats.overall_encounters)}/>
          <Stat label="Credits" value={credits(stats.overall_credits)} tone="credits"/>
        </div>
      </section>
    </div>
    {Boolean(row.hunter_participant_id) && <Link className="encounter-profile-link" href={`/hunter/${String(row.hunter_participant_id)}`}>Open hunter dossier →</Link>}
  </div>;
}

function ArchiveSummary({ row }: { row: Record<string, unknown> }) {
  const kill = row.outcome === "KILL";
  return <summary className="encounter-summary encounter-summary--archive">
    <span className="encounter-cell encounter-cell--time" data-label="Timestamp"><LocalDateTime value={row.event_at as string | Date}/></span>
    <span className="encounter-cell" data-label="Hunter"><HunterLink id={row.hunter_participant_id} name={row.hunter_name}/></span>
    <span className="encounter-cell" data-label="Outcome"><span className={`status ${kill ? "kill" : "failed"}`}>{kill ? "Collected" : "Failed"}</span></span>
    <span className="encounter-cell" data-label="Target"><HunterLink id={row.target_participant_id} name={row.target_name}/></span>
    <span className="encounter-cell encounter-cell--payout" data-label="Payout">{kill ? credits(row.credits) : "—"}</span>
    <span className="encounter-chevron" aria-hidden="true">⌄</span>
  </summary>;
}

function CompactSummary({ row }: { row: Record<string, unknown> }) {
  const kill = row.outcome === "KILL";
  return <summary className="encounter-summary encounter-summary--compact">
    <LocalDateTime value={row.event_at as string | Date} kind="compact" />
    <span className="encounter-story"><HunterLink id={row.hunter_participant_id} name={row.hunter_name}/><span>{kill ? "collected" : "failed"}</span><HunterLink id={row.target_participant_id} name={row.target_name}/></span>
    <span className={kill ? "credits" : "status failed"}>{kill ? credits(row.credits) : "No payout"}</span>
    <span className="encounter-chevron" aria-hidden="true">⌄</span>
  </summary>;
}

export function EncounterList({ rows, variant = "compact" }: { rows: Array<Record<string, unknown>>; variant?: "compact" | "archive" }) {
  if (!rows.length) return <div className="empty">No encounters are archived for this selection.</div>;
  return <div className={`encounter-list encounter-list--${variant}`}>
    {variant === "archive" && <div className="encounter-list-head" aria-hidden="true"><span>Timestamp</span><span>Hunter</span><span>Outcome</span><span>Target</span><span>Payout</span><span/></div>}
    {rows.map((row) => <details className="encounter-row" key={String(row.id ?? `${row.event_at}-${row.hunter_name}-${row.target_name}`)}>
      {variant === "archive" ? <ArchiveSummary row={row}/> : <CompactSummary row={row}/>}
      <HunterStats row={row}/>
    </details>)}
  </div>;
}
