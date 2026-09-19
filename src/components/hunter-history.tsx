import Link from "next/link";
import { HISTORY_PAGE_SIZES, type HunterHistoryFilters } from "@/lib/data";
import { LocalDateTime } from "./local-date-time";

const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

/** Reads the ?role/?outcome/?per/?page query into a history filter. Unknown values fall back to defaults. */
export function parseHistoryQuery(query: Record<string, string | string[] | undefined>): HunterHistoryFilters {
  const role = one(query.role);
  const outcome = one(query.outcome);
  return {
    role: role === "hunter" || role === "target" ? role : undefined,
    outcome: outcome === "KILL" || outcome === "FAILED" ? outcome : undefined,
    pageSize: Number(one(query.per) ?? HISTORY_PAGE_SIZES[0]) || HISTORY_PAGE_SIZES[0],
    page: Math.max(1, Number(one(query.page) ?? 1) || 1),
  };
}

interface HistoryRow { id: unknown; event_at: string | Date; outcome: string; hunter_name: string; target_name: string; credits: number; hunter_participant_id: string | null; target_participant_id: string | null }

export function HunterHistory({ hunterId, hunterName, rows, total, filters }: { hunterId: string; hunterName: string; rows: HistoryRow[]; total: number; filters: HunterHistoryFilters }) {
  const pageSize = filters.pageSize ?? HISTORY_PAGE_SIZES[0];
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const me = hunterName.toLocaleLowerCase();
  const href = (patch: Partial<HunterHistoryFilters & { role: "hunter" | "target" | undefined; outcome: "KILL" | "FAILED" | undefined }>) => {
    const next = { ...filters, page: 1, ...patch };
    const params = new URLSearchParams();
    if (next.role) params.set("role", next.role);
    if (next.outcome) params.set("outcome", next.outcome);
    if (next.pageSize && next.pageSize !== HISTORY_PAGE_SIZES[0]) params.set("per", String(next.pageSize));
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    return `/hunter/${hunterId}${search ? `?${search}` : ""}#history`;
  };
  const tab = (active: boolean, label: string, patch: Parameters<typeof href>[0]) => <Link key={label} className={active ? "active" : undefined} href={href(patch)} scroll={false}>{label}</Link>;

  return <>
    <div className="history-filters">
      <span className="label">Role</span>
      <nav className="tabbar" aria-label="Encounter role">{tab(!filters.role, "Both", { role: undefined })}{tab(filters.role === "hunter", "As hunter", { role: "hunter" })}{tab(filters.role === "target", "As target", { role: "target" })}</nav>
      <span className="label">Outcome</span>
      <nav className="tabbar" aria-label="Outcome">{tab(!filters.outcome, "Any", { outcome: undefined })}{tab(filters.outcome === "KILL", "Collected", { outcome: "KILL" })}{tab(filters.outcome === "FAILED", "Failed", { outcome: "FAILED" })}</nav>
      <span className="label">Per page</span>
      <nav className="tabbar" aria-label="Rows per page">{HISTORY_PAGE_SIZES.map((size) => tab(pageSize === size, String(size), { pageSize: size }))}</nav>
    </div>
    {rows.length ? <div className="data-scroll"><table className="data-table history-table mobile-cards">
      <thead><tr><th>When</th><th>Role</th><th>Opponent</th><th>Result</th><th className="numeric">Bounty</th></tr></thead>
      <tbody>{rows.map((row) => {
        const asHunter = row.hunter_name.toLocaleLowerCase() === me;
        const kill = row.outcome === "KILL";
        const won = asHunter ? kill : !kill;
        const opponentName = asHunter ? row.target_name : row.hunter_name;
        const opponentId = asHunter ? row.target_participant_id : row.hunter_participant_id;
        const result = asHunter ? (kill ? "Claimed" : "Failed") : (kill ? "Killed" : "Survived");
        return <tr key={String(row.id)}>
          <td data-label="When" className="history-time"><LocalDateTime value={row.event_at} kind="compact"/></td>
          <td data-label="Role"><span className={`role-tag role-tag--${asHunter ? "hunter" : "target"}`}>{asHunter ? "Hunter" : "Target"}</span></td>
          <td data-label="Opponent" className="card-title">{opponentId ? <Link className="entity-link" href={`/hunter/${opponentId}`}>{opponentName}</Link> : <b>{opponentName}</b>}</td>
          <td data-label="Result"><span className={`status ${won ? "kill" : "failed"}`}>{result}</span></td>
          <td data-label="Bounty" className="numeric">{kill ? <span className={asHunter ? "credits" : "health-bad credits-lost"}>{asHunter ? "+" : "−"}{integer(row.credits)} cr</span> : <span className="ledger-sub">no payout</span>}</td>
        </tr>;
      })}</tbody>
    </table></div> : <div className="empty">No archived encounters match this filter.</div>}
    <div className="pager"><span>{integer(total)} encounters · page {page} of {pageCount}</span><span>{page > 1 && <Link className="button secondary" href={href({ page: page - 1 })} scroll={false}>Previous</Link>} {page < pageCount && <Link className="button secondary" href={href({ page: page + 1 })} scroll={false}>Next</Link>}</span></div>
  </>;
}
