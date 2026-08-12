import Link from "next/link";
import { notFound } from "next/navigation";
import { BOARD_LABELS, getParticipant } from "@/lib/data";
import { EncounterList } from "./encounter-list";
import { HistoryChart } from "./history-chart";
import { HunterActivityChart } from "./hunter-activity-chart";

const integer = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;
const date = (value: unknown) => value ? new Date(value as string).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: process.env.APP_TIMEZONE ?? "UTC" }) : "—";

export async function Dossier({ id, type }: { id: string; type: "player" | "guild" | "city" }) {
  const data = await getParticipant(id, type);
  if (!data) notFound();
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of data.history) if (!latest.has(row.leaderboard_id)) latest.set(row.leaderboard_id, row);
  const noun = type === "player" ? "Hunter" : type === "guild" ? "Guild" : "City";
  const hunter = data.hunterSummary;
  const target = data.targetSummary;
  const guild = data.guildCompetition;

  const associationNotice = type === "player"
    ? "Encounter statistics use a case-insensitive exact-name match because the public encounter endpoint supplies no character IDs. They describe only the locally archived window, not the hunter’s lifetime career."
    : type === "guild"
      ? "Event statistics are derived by matching event names to tracked players and their latest guild abbreviation. The event source itself supplies no guild relationship or historical roster."
      : "The public encounter endpoint provides no city relationship, so encounters cannot be attributed to this entity.";

  return <div className="shell">
    <header className="page-head"><span className="eyebrow">{`// ${noun} intelligence file`}</span></header>
    <div className="dossier">
      <aside className="identity-card"><span className="chip">{noun} dossier</span><h1>{data.participant.current_name || "Unnamed source entity"}</h1><div className="identity-meta">SOURCE ID {data.participant.source_participant_id}<br/>{data.participant.guild_abbreviation && <>GUILD {data.participant.guild_id ? <Link className="entity-link" href={`/guild/${data.participant.guild_id}`}>{data.participant.guild_abbreviation}</Link> : data.participant.guild_abbreviation}<br/></>}{data.participant.city_name && <>CITY {data.participant.city_name}<br/></>}{data.participant.planet && <>PLANET {data.participant.planet}<br/></>}FIRST SEEN {date(data.participant.first_seen_at)}</div></aside>
      <div><div className="notice">Leaderboard identity uses the stable SWG participant ID. {associationNotice}</div>
        <dl className="metrics">{Object.entries(BOARD_LABELS).map(([board, label]) => { const row = latest.get(board); return <div className="metric" key={board}><dt>{label}</dt><dd>{row ? integer(row.score_raw) : "—"}</dd><small>{row ? `latest observed rank #${row.rank}` : "not observed"}</small></div>; })}</dl>
      </div>
    </div>

    {type === "player" && hunter && <>
      <section className="section"><div className="section-head"><div><span className="kicker">Hunter role · exact-name association</span><h2>Archived encounter record</h2></div><Link href={`/encounters?q=${encodeURIComponent(data.participant.current_name)}`}>Filter event log →</Link></div>
        <dl className="metrics profile-metrics">
          <div className="metric record-metric"><dt>Record</dt><dd><span className="health-good">{integer(hunter.wins)}W</span> <span className="health-bad">{integer(hunter.losses)}L</span></dd><small>{integer(hunter.encounters)} contracts attempted</small></div>
          <div className="metric"><dt>Win rate</dt><dd>{percent(hunter.win_rate)}</dd><small>claims ÷ hunter-role encounters</small></div>
          <div className="metric"><dt>Credits claimed</dt><dd>{integer(hunter.credits)}</dd><small>{hunter.average_bounty === null ? "no successful claims" : `${integer(Math.round(Number(hunter.average_bounty)))} average`}</small></div>
          <div className="metric"><dt>Highest bounty</dt><dd>{hunter.highest_bounty === null ? "—" : integer(hunter.highest_bounty)}</dd><small>largest archived payout</small></div>
          <div className="metric"><dt>Unique targets</dt><dd>{integer(hunter.unique_targets)}</dd><small>exact target names</small></div>
          <div className="metric"><dt>Active days</dt><dd>{integer(hunter.active_days)}</dd><small>{date(hunter.first_active_at)} – {date(hunter.last_active_at)}</small></div>
        </dl>
      </section>
      <section className="section"><div className="panel"><div className="panel-header"><h3>When targeted</h3><span className="chip">Separate role</span></div><div className="target-summary"><div><span>Targeted</span><b>{integer(target?.encounters)}</b></div><div><span>Survived</span><b className="health-good">{integer(target?.survived)}</b></div><div><span>Killed</span><b className="health-bad">{integer(target?.killed)}</b></div><div><span>Survival rate</span><b>{percent(target?.survival_rate)}</b></div></div><p className="stat-definition">A failed contract counts as a target survival. These events are deliberately excluded from the hunter-role win rate.</p></div></section>
    </>}

    {type === "guild" && guild && <>
      <section className="section"><div className="section-head"><div><span className="kicker">Current roster · derived event association</span><h2>Guild competition record</h2></div><Link href="/guilds">All guilds →</Link></div><dl className="metrics profile-metrics">
        <div className="metric record-metric"><dt>Record</dt><dd><span className="health-good">{integer(guild.summary?.wins)}W</span> <span className="health-bad">{integer(guild.summary?.losses)}L</span></dd><small>{integer(guild.summary?.encounters)} member contracts</small></div><div className="metric"><dt>Win rate</dt><dd>{percent(guild.summary?.win_rate)}</dd><small>current-roster hunter activity</small></div><div className="metric"><dt>Credits claimed</dt><dd>{integer(guild.summary?.credits)}</dd><small>successful member contracts</small></div><div className="metric"><dt>Tracked roster</dt><dd>{integer(guild.summary?.roster_size)}</dd><small>{integer(guild.summary?.active_hunters)} active hunters</small></div><div className="metric"><dt>Target observations</dt><dd>{integer(guild.summary?.target_observations)}</dd><small>summed unique member targets</small></div><div className="metric"><dt>Last active</dt><dd className="compact-dd">{date(guild.summary?.last_active_at)}</dd><small>latest member hunter event</small></div>
      </dl></section>
      <section className="section"><div className="dashboard-grid"><div className="panel"><div className="panel-header"><h3>Guild activity</h3><span className="chip">Claims vs failures</span></div><HunterActivityChart data={guild.activity}/></div><div className="panel"><div className="panel-header"><h3>Rival guilds</h3><span className="chip">Tracked rosters only</span></div>{guild.rivals.length ? guild.rivals.map((row, index) => <div className="opponent-row" key={row.opponent_guild}><span className="rank">{index + 1}</span><span>{row.guild_id ? <Link className="entity-link" href={`/guild/${row.guild_id}`}><b>{row.opponent_guild}</b></Link> : <b>{row.opponent_guild}</b>}<small>{row.encounters} cross-guild encounters</small></span><span className="record"><b className="health-good">{row.wins}W</b> <b className="health-bad">{row.losses}L</b></span></div>) : <div className="empty">No encounters currently resolve to opposing tracked guild rosters.</div>}</div></div></section>
      <section className="section"><div className="panel"><div className="panel-header"><h3>Current tracked roster</h3><span className="chip">{guild.roster.length} hunters</span></div><div className="data-scroll"><table className="data-table"><thead><tr><th>Hunter</th><th>Archive record</th><th>Encounters</th><th className="numeric">Credits</th><th>Last active</th></tr></thead><tbody>{guild.roster.map((row) => <tr key={row.id}><td><Link className="entity-link" href={`/hunter/${row.id}`}><b>{row.current_name}</b></Link><small>{row.city_name ?? "No current city"}</small></td><td><span className="health-good">{row.wins}W</span> <span className="health-bad">{row.losses}L</span></td><td>{row.encounters}</td><td className="numeric credits">{integer(row.credits)} cr</td><td>{date(row.last_active_at)}</td></tr>)}</tbody></table></div></div></section>
    </>}

    <section className="section"><div className={type === "player" ? "" : "dashboard-grid"}>{type !== "player" && <div className="panel"><div className="panel-header"><h3>Rank history</h3><span className="chip">Source observations</span></div><HistoryChart rows={data.history}/></div>}<div className="panel"><div className="panel-header"><h3>Contract targets</h3><span className="chip">Hunter role only</span></div>{type === "player" && data.opponents.length ? data.opponents.map((row, index) => <div className="opponent-row" key={row.opponent}><span className="rank">{index + 1}</span><span><b>{row.opponent}</b><small>{integer(row.encounters)} contracts · {percent(row.win_rate)} claim rate</small></span><span className="record"><b className="health-good">{row.wins}W</b> <b className="health-bad">{row.losses}L</b></span></div>) : <div className="empty">{type === "player" ? "No hunter-role matchups are available from the archive." : "Contract targets are available only for hunter profiles."}</div>}</div></div></section>
    {type === "player" && <section className="section"><div className="panel"><div className="panel-header"><h3>Recent history</h3><span className="chip">Both encounter roles</span></div><EncounterList rows={data.encounters.slice(0, 25)}/></div></section>}
    {type !== "player" && <section className="section"><div className="panel"><div className="panel-header"><h3>Leaderboard observation history</h3><span className="chip">{data.history.length} rows</span></div><div className="data-scroll"><table className="data-table"><thead><tr><th>Observed</th><th>Board</th><th>Period</th><th>Rank</th><th className="numeric">Raw score</th></tr></thead><tbody>{data.history.map((row, index) => <tr key={`${row.leaderboard_id}-${row.source_fetched_at}-${index}`}><td>{new Date(row.source_fetched_at).toLocaleString("en-US")}</td><td>{BOARD_LABELS[row.leaderboard_id] ?? row.leaderboard_id}</td><td>{date(row.starts_at)} – {date(row.ends_at)}</td><td>#{row.rank}</td><td className="numeric">{integer(row.score_raw)}</td></tr>)}</tbody></table></div></div></section>}
  </div>;
}
