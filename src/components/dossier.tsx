import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type React from "react";
import { BOARD_LABELS, GCW_BOARD_FACTIONS, GCW_BOARD_LABELS, getParticipant, type HunterHistoryFilters } from "@/lib/data";
import { HistoryChart } from "./history-chart";
import { HunterDossier } from "./hunter-dossier";
import { HunterActivityChart } from "./hunter-activity-chart";
import { LocalDateTime } from "./local-date-time";
import { latestLeaderboardRows } from "@/lib/leaderboard-history";

// Deduplicates the dossier query between generateMetadata and the page render.
export const loadParticipant = cache(getParticipant);

const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
// GCW score_raw is the source's faction-share percent string ("7.8584…%").
const gcwShare = (value: unknown) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "—";
};
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;
const date = (value: unknown) => value ? <LocalDateTime value={value as string | Date} kind="date"/> : "—";

export async function Dossier({ id, type, historyFilters = {} }: { id: string; type: "player" | "guild" | "city"; historyFilters?: HunterHistoryFilters }) {
  const data = await loadParticipant(id, type);
  if (!data) notFound();
  const latest = latestLeaderboardRows(data.history);
  // GCW standings arrive newest-period-first per board; index them for the panel.
  const gcwByBoard = new Map<string, typeof data.gcwStandings>();
  for (const row of data.gcwStandings ?? []) {
    const rows = gcwByBoard.get(row.leaderboard_id) ?? [];
    rows.push(row);
    gcwByBoard.set(row.leaderboard_id, rows);
  }
  const gcwWinsByBoard = new Map((data.gcwWins ?? []).map((row) => [row.leaderboard_id, row]));
  const gcwBoards = Object.keys(GCW_BOARD_LABELS);
  const salute = data.officerSalute;
  const saluteIsOfficer = salute && Number(salute.rank_index) >= 7;
  const corps = data.officerCorps;
  const isoDay = (value: unknown) => String(value ?? "").slice(0, 10);

  // Compact GCW badges: essentials on the chip, full detail in the tooltip.
  const gcwBadgeItems: Array<{ key: string; className: string; title: string; href?: string; label: React.ReactNode }> = [];
  for (const board of gcwBoards) {
    const rows = gcwByBoard.get(board) ?? [];
    const current = rows[0];
    if (!current) continue;
    const previous = rows[1];
    const delta = previous ? Number(previous.rank) - Number(current.rank) : null;
    const trend = delta === null ? "new" : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "=";
    const wins = gcwWinsByBoard.get(board);
    gcwBadgeItems.push({
      key: board,
      className: board === "GCW_IMPERIAL" ? "badge--imperial" : "badge--rebel",
      title: `${GCW_BOARD_LABELS[board]} — rank #${current.rank} at ${gcwShare(current.score_raw)} faction share (${integer(current.score)} GCW points), week of ${isoDay(current.starts_at)}.`
        + (previous ? ` Previous week #${previous.rank} at ${gcwShare(previous.score_raw)}.` : "")
        + ` Best observed rank #${current.best_rank}.`
        + (wins ? ` ${integer(wins.wins)} all-time weekly wins.` : ""),
      label: <>{GCW_BOARD_FACTIONS[board]} GCW <b>#{integer(current.rank)}</b> · {gcwShare(current.score_raw)} · {trend}</>,
    });
  }
  if (type === "player") {
    if (saluteIsOfficer) {
      gcwBadgeItems.push({
        key: "salute",
        className: "badge--officer",
        title: `Officers' Salute — ${salute.faction_name} ${salute.rank_name} (rank ${salute.rank_index} of 12). ${integer(salute.current_gcw_points)} GCW points and ${integer(salute.current_pvp_kills)} PvP kills this week${salute.profession ? ` · ${salute.profession}` : ""}. Observed ${isoDay(salute.observed_at)}.`,
        label: <>⌖ <b>{salute.rank_name}</b> · {integer(salute.current_gcw_points)} pts wk</>,
      });
    } else if (salute) {
      gcwBadgeItems.push({
        key: "salute-enlisted",
        className: "badge--muted",
        title: `Serving as ${salute.rank_name} (rank ${salute.rank_index} of 12) in the ${salute.faction_name} forces with ${integer(salute.current_gcw_points)} GCW points this week. The salute is reserved for commissioned officers — Lieutenant (rank 7) and above.`,
        label: <>{salute.rank_name} · {salute.rank_index}/12</>,
      });
    }
  }
  if (type === "guild" && corps) {
    if (corps.commissioned > 0) {
      gcwBadgeItems.push({
        key: "corps",
        className: "badge--officer",
        title: `${corps.commissioned} commissioned officer${corps.commissioned === 1 ? "" : "s"} (Lieutenant and above) and ${corps.enlisted} enlisted from this roster appear in the current Officers' Salute registry.`,
        label: <>⌖ <b>{corps.commissioned}</b> commissioned</>,
      });
      for (const officer of corps.top.slice(0, 3)) {
        gcwBadgeItems.push({
          key: `officer-${officer.participant_id}`,
          className: "",
          href: `/hunter/${officer.participant_id}`,
          title: `${officer.faction_name} ${officer.rank_name} — ${integer(officer.current_gcw_points)} GCW points this week.`,
          label: <>{officer.name} · {officer.rank_name}</>,
        });
      }
    }
  }
  const gcwBadges = gcwBadgeItems.length === 0 ? null : <div className="badge-row">{gcwBadgeItems.map((item) => item.href
    ? <Link key={item.key} className={`badge ${item.className}`} href={item.href} title={item.title} aria-label={item.title}>{item.label}</Link>
    : <span key={item.key} className={`badge ${item.className}`} title={item.title} aria-label={item.title}>{item.label}</span>)}</div>;
  // Hunters get a denser layout with the full opponent ledger and paginated history.
  if (type === "player") return <HunterDossier data={data} latest={latest} gcwBadges={gcwBadges} historyFilters={historyFilters}/>;
  const noun = type === "guild" ? "Guild" : "City";
  const guild = data.guildCompetition;

  const associationNotice = type === "guild"
      ? "Event statistics are derived by matching event names to tracked players and their latest guild abbreviation. The event source itself supplies no guild relationship or historical roster."
      : "The public encounter endpoint provides no city relationship, so encounters cannot be attributed to this entity.";

  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{`// ${noun} intelligence file`}</span></header>
    <div className="dossier">
      <aside className="identity-card"><span className="chip">{noun} dossier</span><h1>{data.participant.current_name || "Unnamed source entity"}</h1><div className="identity-meta">SOURCE ID {data.participant.source_participant_id}<br/>{data.participant.guild_abbreviation && <>GUILD {data.participant.guild_id ? <Link className="entity-link" href={`/guild/${data.participant.guild_id}`}>{data.participant.guild_abbreviation}</Link> : data.participant.guild_abbreviation}<br/></>}{data.participant.city_name && <>CITY {data.participant.city_name}<br/></>}{data.participant.planet && <>PLANET {data.participant.planet}<br/></>}FIRST SEEN {date(data.participant.first_seen_at)}</div></aside>
      <div><div className="notice">Leaderboard identity uses the stable SWG participant ID. {associationNotice}</div>
        <dl className="metrics">{Object.entries(BOARD_LABELS).map(([board, label]) => { const row = latest.get(board); return <div className="metric" key={board}><dt>{label}</dt><dd>{row ? integer(row.score_raw) : "—"}</dd><small>{row ? `latest observed rank #${row.rank}` : "not observed"}</small></div>; })}</dl>
        {gcwBadges}
      </div>
    </div>

    {type === "guild" && guild && <>
      <section className="section"><div className="section-head"><div><span className="kicker">Current roster · derived event association</span><h2>Guild competition record</h2></div><Link href="/guilds">All guilds →</Link></div><dl className="metrics profile-metrics">
        <div className="metric record-metric"><dt>Record</dt><dd><span className="health-good">{integer(guild.summary?.wins)}W</span> <span className="health-bad">{integer(guild.summary?.losses)}L</span></dd><small>{integer(guild.summary?.encounters)} member contracts</small></div><div className="metric"><dt>Win rate</dt><dd>{percent(guild.summary?.win_rate)}</dd><small>current-roster hunter activity</small></div><div className="metric"><dt>Credits claimed</dt><dd>{integer(guild.summary?.credits)}</dd><small>successful member contracts</small></div><div className="metric"><dt>Tracked roster</dt><dd>{integer(guild.summary?.roster_size)}</dd><small>{integer(guild.summary?.active_hunters)} active hunters</small></div><div className="metric"><dt>Target observations</dt><dd>{integer(guild.summary?.target_observations)}</dd><small>summed unique member targets</small></div><div className="metric"><dt>Last active</dt><dd className="compact-dd">{date(guild.summary?.last_active_at)}</dd><small>latest member hunter event</small></div>
      </dl></section>
      <section className="section"><div className="dashboard-grid"><div className="panel"><div className="panel-header"><h3>Guild activity</h3><span className="chip">Claims vs failures</span></div><HunterActivityChart data={guild.activity}/></div><div className="panel"><div className="panel-header"><h3>Rival guilds</h3><span className="chip">Tracked rosters only</span></div>{guild.rivals.length ? guild.rivals.map((row, index) => <div className="opponent-row" key={row.opponent_guild}><span className="rank">{index + 1}</span><span>{row.guild_id ? <Link className="entity-link" href={`/guild/${row.guild_id}`}><b>{row.opponent_guild}</b></Link> : <b>{row.opponent_guild}</b>}<small>{row.encounters} cross-guild encounters</small></span><span className="record"><b className="health-good">{row.wins}W</b> <b className="health-bad">{row.losses}L</b></span></div>) : <div className="empty">No encounters currently resolve to opposing tracked guild rosters.</div>}</div></div></section>
      <section className="section"><div className="panel"><div className="panel-header"><h3>Current tracked roster</h3><span className="chip">{guild.roster.length} hunters</span></div><div className="data-scroll"><table className="data-table mobile-cards"><thead><tr><th>Hunter</th><th>Archive record</th><th>Encounters</th><th className="numeric">Credits</th><th>Last active</th></tr></thead><tbody>{guild.roster.map((row) => <tr key={row.id}><td data-label="Hunter" className="card-title"><Link className="entity-link" href={`/hunter/${row.id}`}><b>{row.current_name}</b></Link><small>{row.city_name ?? "No current city"}</small></td><td data-label="Archive record"><span className="health-good">{row.wins}W</span> <span className="health-bad">{row.losses}L</span></td><td data-label="Encounters">{row.encounters}</td><td data-label="Credits" className="numeric credits">{integer(row.credits)} cr</td><td data-label="Last active">{date(row.last_active_at)}</td></tr>)}</tbody></table></div></div></section>
    </>}

    <section className="section"><div className="dashboard-grid"><div className="panel"><div className="panel-header"><h3>Rank history</h3><span className="chip">Source observations</span></div><HistoryChart rows={data.history}/></div><div className="panel"><div className="panel-header"><h3>Contract targets</h3><span className="chip">Hunter role only</span></div><div className="empty">Contract targets are available only for hunter profiles.</div></div>
    </div></section>
    <section className="section"><div className="panel"><div className="panel-header"><h3>Leaderboard observation history</h3><span className="chip">{data.history.length} rows</span></div><div className="data-scroll"><table className="data-table mobile-cards"><thead><tr><th>Observed</th><th>Board</th><th>Period</th><th>Rank</th><th className="numeric">Raw score</th></tr></thead><tbody>{data.history.map((row, index) => <tr key={`${row.leaderboard_id}-${row.source_fetched_at}-${index}`}><td data-label="Observed"><LocalDateTime value={row.source_fetched_at}/></td><td data-label="Board" className="card-title">{BOARD_LABELS[row.leaderboard_id] ?? row.leaderboard_id}</td><td data-label="Period">{date(row.starts_at)} – {date(row.ends_at)}</td><td data-label="Rank">#{row.rank}</td><td data-label="Raw score" className="numeric">{integer(row.score_raw)}</td></tr>)}</tbody></table></div></div></section>
  </div>;
}
