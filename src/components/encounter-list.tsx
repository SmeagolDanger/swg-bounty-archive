import Link from "next/link";
import { LocalDateTime } from "./local-date-time";

const credits = (value: number | string) => Number(value).toLocaleString("en-US");

function HunterLink({ id, name }: { id: unknown; name: unknown }) {
  return id ? <Link className="entity-link" href={`/hunter/${String(id)}`}>{String(name)}</Link> : <b>{String(name)}</b>;
}

export function EncounterList({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <div className="empty">No encounters are archived for this selection.</div>;
  return <div className="encounter-list">{rows.map((row) => <div className="encounter-row" key={String(row.id ?? `${row.event_at}-${row.hunter_name}-${row.target_name}`)}>
    <LocalDateTime value={row.event_at as string | Date} kind="compact" />
    <div className="encounter-story"><HunterLink id={row.hunter_participant_id} name={row.hunter_name}/><span>{row.outcome === "KILL" ? "collected" : "failed"}</span><HunterLink id={row.target_participant_id} name={row.target_name}/></div>
    <div className={row.outcome === "KILL" ? "credits" : "status failed"}>{row.outcome === "KILL" ? `${credits(row.credits as string)} cr` : "No payout"}</div>
  </div>)}</div>;
}
