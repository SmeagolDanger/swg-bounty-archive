"use client";

// Purpose-built export composition for the weekly report — a fixed-width
// card rendered off-screen and captured to PNG, instead of screenshotting
// the live page (which inherits viewport quirks and interactive chrome).
// Mirrors the share-image approach in the Jawa Tracks apps.

export interface ReportShareVM {
  cycleLabel: string;
  verifiedLabel: string;
  metrics: { label: string; value: string; sub: string; tone?: "good" | "credits" }[];
  largestClaim?: { hunter: string; target: string; credits: string };
  topHunters: { name: string; guild: string; kills: string; record: string; credits: string }[];
  topTargets: { name: string; issued: string; survived: string; killed: string }[];
  leaders: { board: string; name: string; guild: string; score: string }[];
  activity: { day: string; contracts: string; claims: string; failures: string; credits: string }[];
}

export function ReportShareImage({ vm }: { vm: ReportShareVM }) {
  return <div className="report-share" data-report-share>
    <header className="rs-head">
      <div>
        <span className="rs-eyebrow">JAWA TRACKS // WEEKLY CYCLE REPORT</span>
        <h1>{vm.cycleLabel}</h1>
      </div>
      <div className="rs-verified">
        <span>LAST SOURCE VERIFICATION</span>
        <b>{vm.verifiedLabel}</b>
      </div>
    </header>

    <div className="rs-metrics">
      {vm.metrics.map((metric) => <div className="rs-metric" key={metric.label}>
        <span>{metric.label}</span>
        <b className={metric.tone === "good" ? "health-good" : metric.tone === "credits" ? "credits" : undefined}>{metric.value}</b>
        <small>{metric.sub}</small>
      </div>)}
    </div>

    {vm.largestClaim && <div className="rs-callout">
      <span>LARGEST VERIFIED CLAIM</span>
      <b>{vm.largestClaim.hunter} → {vm.largestClaim.target}</b>
      <strong>{vm.largestClaim.credits} cr</strong>
    </div>}

    <div className="rs-columns">
      <section>
        <h2>Top Hunter Records</h2>
        {vm.topHunters.map((hunter, index) => <div className="rs-row" key={hunter.name}>
          <span className="rs-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="rs-name"><b>{hunter.name}</b><small>{hunter.guild}</small></span>
          <span className="rs-record"><b className="health-good">{hunter.kills}</b><small>{hunter.record}</small></span>
          <span className="rs-credits">{hunter.credits} cr</span>
        </div>)}
      </section>
      <section>
        <h2>Most Wanted</h2>
        {vm.topTargets.map((target, index) => <div className="rs-row" key={target.name}>
          <span className="rs-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="rs-name"><b>{target.name}</b><small>{target.issued} contracts issued</small></span>
          <span className="rs-record"><b className="health-good">{target.survived}S</b><small>{target.killed} killed</small></span>
        </div>)}
      </section>
    </div>

    {vm.leaders.length > 0 && <div className="rs-leaders">
      {vm.leaders.map((leader) => <div className="rs-leader" key={leader.board}>
        <span>{leader.board}</span>
        <b>{leader.name}</b>
        <small>{leader.guild}</small>
        <strong>{leader.score}</strong>
      </div>)}
    </div>}

    {vm.activity.length > 0 && <table className="rs-activity">
      <thead><tr><th>DAY</th><th>CONTRACTS</th><th>CLAIMS</th><th>FAILURES</th><th className="rs-num">CREDITS</th></tr></thead>
      <tbody>
        {vm.activity.map((day) => <tr key={day.day}>
          <td>{day.day}</td><td>{day.contracts}</td>
          <td className="health-good">{day.claims}</td>
          <td className="health-bad">{day.failures}</td>
          <td className="rs-num credits">{day.credits} cr</td>
        </tr>)}
      </tbody>
    </table>}

    <footer className="rs-foot">
      <span>JAWA TRACKS — OUTER RIM LEDGER</span>
      <span>jawatracks.com · data: SWG Legends</span>
    </footer>
  </div>;
}
