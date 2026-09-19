import Link from "next/link";
import type React from "react";
import { BOARD_LABELS, getHunterHistory, type HunterHistoryFilters, type getParticipant } from "@/lib/data";
import type { latestLeaderboardRows } from "@/lib/leaderboard-history";
import { HunterHistory } from "./hunter-history";
import { LocalDateTime } from "./local-date-time";
import { OpponentLedger } from "./opponent-ledger";

type ParticipantData = NonNullable<Awaited<ReturnType<typeof getParticipant>>>;

const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;
const date = (value: unknown) => value ? <LocalDateTime value={value as string | Date} kind="date"/> : "—";
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? "");

function Cell({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "good" | "bad" | "credits" }) {
  return <div className="stat-cell"><span>{label}</span><b className={tone === "good" ? "health-good" : tone === "bad" ? "health-bad" : tone === "credits" ? "stat-credits" : undefined}>{value}</b>{note !== undefined && <small>{note}</small>}</div>;
}

/**
 * Dense hunter layout: identity + one stat board above the fold, then the
 * complete opponent ledger and the full paginated encounter history.
 */
export async function HunterDossier({ data, latest, gcwBadges, historyFilters }: {
  data: ParticipantData;
  latest: ReturnType<typeof latestLeaderboardRows>;
  gcwBadges: React.ReactNode;
  historyFilters: HunterHistoryFilters;
}) {
  const participant = data.participant;
  const hunter = data.hunterSummary;
  const target = data.targetSummary;
  const history = await getHunterHistory(participant.current_name, historyFilters);
  const ledgerRows = data.rivalries.map((row) => ({ ...row, first_event_at: iso(row.first_event_at), last_event_at: iso(row.last_event_at) }));

  return <div className="shell hunter-dossier">
    <header className="page-head"><span className="eyebrow">{"// Hunter intelligence file"}</span></header>
    <div className="hunter-top">
      <aside className="identity-card identity-card--compact"><span className="chip">Hunter dossier</span><h1>{participant.current_name || "Unnamed source entity"}</h1>
        <div className="identity-meta">SOURCE ID {participant.source_participant_id}<br/>
          {participant.guild_abbreviation && <>GUILD {participant.guild_id ? <Link className="entity-link" href={`/guild/${participant.guild_id}`}>{participant.guild_abbreviation}</Link> : participant.guild_abbreviation}<br/></>}
          {participant.city_name && <>CITY {participant.city_name}<br/></>}
          {participant.planet && <>PLANET {participant.planet}<br/></>}
          FIRST SEEN {date(participant.first_seen_at)}<br/>
          {hunter?.last_active_at && <>LAST FIGHT {date(hunter.last_active_at)}</>}</div>
        {gcwBadges}
      </aside>
      <div className="stat-board">
        <div className="stat-group"><header><b>Leaderboards</b><small>latest observed rank</small></header>
          <div className="stat-cells">{Object.entries(BOARD_LABELS).map(([board, label]) => { const row = latest.get(board); return <Cell key={board} label={label} value={row ? integer(row.score_raw) : "—"} note={row ? `rank #${row.rank}` : "not observed"}/>; })}</div>
        </div>
        <div className="stat-group"><header><b>As hunter</b><small>exact-name association</small><Link href={`/encounters?q=${encodeURIComponent(participant.current_name)}`}>Event log →</Link></header>
          <div className="stat-cells stat-cells--6">
            <Cell label="Record" value={<span className="stat-record"><span className="health-good">{integer(hunter?.wins)}W</span> <span className="health-bad">{integer(hunter?.losses)}L</span></span>} note={`${integer(hunter?.encounters)} contracts`}/>
            <Cell label="Claim rate" value={percent(hunter?.win_rate)} note="claims ÷ contracts"/>
            <Cell label="Credits claimed" value={integer(hunter?.credits)} tone="credits" note={hunter?.average_bounty === null || hunter?.average_bounty === undefined ? "no successful claims" : `${integer(Math.round(Number(hunter.average_bounty)))} avg`}/>
            <Cell label="Highest bounty" value={hunter?.highest_bounty === null || hunter?.highest_bounty === undefined ? "—" : integer(hunter.highest_bounty)} tone="credits" note="largest payout"/>
            <Cell label="Unique targets" value={integer(hunter?.unique_targets)} note="exact names"/>
            <Cell label="Active days" value={integer(hunter?.active_days)} note={<>{date(hunter?.first_active_at)} – {date(hunter?.last_active_at)}</>}/>
          </div>
        </div>
        <div className="stat-group"><header><b>As target</b><small>a failed contract counts as a survival</small></header>
          <div className="stat-cells">
            <Cell label="Targeted" value={integer(target?.encounters)} note="contracts against"/>
            <Cell label="Survived" value={integer(target?.survived)} tone="good"/>
            <Cell label="Killed" value={integer(target?.killed)} tone="bad"/>
            <Cell label="Survival rate" value={percent(target?.survival_rate)} note="excluded from hunter win rate"/>
          </div>
        </div>
        <p className="stat-definition">Leaderboard identity uses the stable SWG participant ID. Encounter statistics use a case-insensitive exact-name match because the public encounter endpoint supplies no character IDs; they cover only the locally archived window, not the hunter’s lifetime career.</p>
      </div>
    </div>

    <section className="section"><div className="panel"><div className="panel-header"><h3>Opponent ledger</h3><span className="chip">{integer(data.rivalries.length)} names · both roles</span></div>
      <OpponentLedger rows={ledgerRows} hunterId={participant.id}/>
    </div></section>

    <section className="section" id="history"><div className="panel"><div className="panel-header"><h3>Complete encounter history</h3><span className="chip">Newest first</span></div>
      <HunterHistory hunterId={participant.id} hunterName={participant.current_name} rows={history.rows} total={history.total} filters={{ ...historyFilters, pageSize: history.pageSize, page: history.page }}/>
    </div></section>
  </div>;
}
