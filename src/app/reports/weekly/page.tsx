import type { Metadata } from "next";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { ReportCycleSelect } from "@/components/report-cycle-select";
import { ReportExportButton } from "@/components/report-export-button";
import { ALL_BOARD_LABELS, getWeeklyReport, type WeeklyReportPeriod } from "@/lib/data";
import { PERIODS } from "@/lib/ingestion/config";

export const metadata: Metadata = { title: "Weekly cycle report" };
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export default async function WeeklyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requestedPeriod = one(query.period);
  const period = (PERIODS as readonly string[]).includes(requestedPeriod ?? "") ? requestedPeriod as WeeklyReportPeriod : "CURRENT";
  const report = await getWeeklyReport(period, one(query.cycle));
  const cycles = report.availableCycles.map((cycle) => ({
    startsAt: new Date(cycle.starts_at).toISOString(),
    endsAt: new Date(cycle.ends_at).toISOString(),
  }));
  const selectedStart = report.cycle ? new Date(report.cycle.starts_at).toISOString() : cycles[0]?.startsAt ?? "";
  const selectedIndex = cycles.findIndex((cycle) => cycle.startsAt === selectedStart);
  const leaderboardPeriod = (["CURRENT", "PREVIOUS_1", "PREVIOUS_2"] as const)[selectedIndex];

  return <div className="shell weekly-report">
    <header className="page-head report-page-head">
      <span className="eyebrow">{"Jawa Tracks // Cycle intelligence"}</span>
      <div className="report-title-row"><div><h1>Weekly cycle report</h1><p>A bounded report using the exact weekly dates supplied by the SWG Legends leaderboard source.</p></div><ReportExportButton/></div>
    </header>

    {cycles.length > 0 && <ReportCycleSelect cycles={cycles} selected={selectedStart}/>}

    {!report.cycle || !report.summary ? <div className="empty">This weekly cycle has not been archived yet.</div> : <>
      <section className="report-hero">
        <div><span className="kicker">{selectedIndex === 0 ? "Current cycle" : "Archived cycle"}</span><h2><span className="report-cycle-bound"><LocalDateTime value={report.cycle.starts_at} kind="date"/></span><span className="report-cycle-arrow" aria-hidden="true">→</span><span className="report-cycle-bound"><LocalDateTime value={report.cycle.ends_at} kind="date"/></span></h2></div>
        <div className="report-verified"><span>Last source verification</span><b><LocalDateTime value={report.cycle.verified_at}/></b></div>
      </section>

      <dl className="metrics report-metrics">
        <div className="metric"><dt>Contracts</dt><dd>{number(report.summary.encounters)}</dd><small>{number(report.summary.active_hunters)} active hunters</small></div>
        <div className="metric"><dt>Claims</dt><dd className="health-good">{number(report.summary.claims)}</dd><small>{number(report.summary.failures)} failed contracts</small></div>
        <div className="metric"><dt>Credits collected</dt><dd className="credits">{number(report.summary.credits)} cr</dd><small>{number(report.summary.average_bounty)} average claim</small></div>
        <div className="metric"><dt>Unique targets</dt><dd>{number(report.summary.unique_targets)}</dd><small>{number(report.summary.active_days)} active days</small></div>
      </dl>

      {Number(report.summary.encounters) === 0 && <div className="notice report-empty-notice">This source cycle is archived, but no encounter-feed rows were captured within its boundaries.</div>}

      {report.largestClaim && <section className="report-callout"><div><span>Largest verified claim</span><b>{report.largestClaim.hunter_name} <i>→</i> {report.largestClaim.target_name}</b></div><strong>{number(report.largestClaim.credits)} cr</strong></section>}

      {(report.topHunters.length > 0 || report.topTargets.length > 0) && <section className="section"><div className="dashboard-grid">
        <div className="panel"><div className="panel-header"><h3>Top hunter records</h3><span className="chip">Deaths include failed contracts</span></div>
          {report.topHunters.map((hunter, index) => <div className="report-record" key={hunter.hunter_name}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span><b>{hunter.participant_id ? <Link className="entity-link" href={`/hunter/${hunter.participant_id}`}>{hunter.hunter_name}</Link> : hunter.hunter_name}</b><small>{hunter.guild_abbreviation || "Unaligned"}</small></span><span><b className="health-good">{hunter.kills}K</b><small>{hunter.deaths}D · {hunter.failures} failed</small></span><span className="credits">{number(hunter.credits)} cr</span></div>)}
        </div>
        <div className="panel"><div className="panel-header"><h3>Most wanted</h3><span className="chip">Target role</span></div>
          {report.topTargets.map((target, index) => <div className="report-record report-record--target" key={target.target_name}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span><b>{target.participant_id ? <Link className="entity-link" href={`/hunter/${target.participant_id}`}>{target.target_name}</Link> : target.target_name}</b><small>{target.targeted} contracts issued</small></span><span><b className="health-good">{target.survived}S</b><small>{target.killed} killed</small></span></div>)}
        </div>
      </div></section>}

      {report.leaders.length > 0 && <section className="section"><div className="section-head"><div><span className="kicker">Source standings</span><h2>Cycle leaders</h2></div>{leaderboardPeriod && <Link href={`/leaderboards?period=${leaderboardPeriod}`}>Open full boards →</Link>}</div>
        <div className="report-board-grid">{report.leaders.map((leader) => <div className="panel report-board" key={leader.leaderboard_id}><span>{ALL_BOARD_LABELS[leader.leaderboard_id] ?? leader.leaderboard_id}</span><b>{leader.current_name}</b><small>{leader.guild_abbreviation || "Unaligned"}</small><strong>{number(leader.score_raw ?? leader.score)}{leader.value_type === "CREDITS" ? " cr" : ""}</strong></div>)}</div>
      </section>}

      {report.activity.length > 0 && <section className="section"><div className="section-head"><div><span className="kicker">Encounter feed</span><h2>Daily activity</h2></div></div>
        <div className="panel"><div className="data-scroll"><table className="data-table mobile-cards"><thead><tr><th>Day</th><th>Contracts</th><th>Claims</th><th>Failures</th><th className="numeric">Credits</th></tr></thead><tbody>{report.activity.map((day) => <tr key={day.day}><td data-label="Day" className="card-title">{day.day}</td><td data-label="Contracts">{day.encounters}</td><td data-label="Claims" className="health-good">{day.claims}</td><td data-label="Failures" className="health-bad">{day.failures}</td><td data-label="Credits" className="numeric credits">{number(day.credits)} cr</td></tr>)}</tbody></table></div></div>
      </section>}
    </>}
  </div>;
}
