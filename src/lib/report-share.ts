import { ALL_BOARD_LABELS, type getWeeklyReport } from "@/lib/data";
import type { ReportShareVM } from "@/components/report-share-image";

type WeeklyReport = Awaited<ReturnType<typeof getWeeklyReport>>;

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const utcDate = (value: Date | string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const utcStamp = (value: Date | string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));

/// One view-model for the share composition, used by the report page's
/// Save-image button and the share-card route the Discord poster captures.
export function buildReportShareVM(report: WeeklyReport): ReportShareVM | null {
  if (!report.cycle || !report.summary) return null;
  return {
    cycleLabel: `${utcDate(report.cycle.starts_at)} → ${utcDate(report.cycle.ends_at)}`,
    verifiedLabel: utcStamp(report.cycle.verified_at),
    metrics: [
      { label: "CONTRACTS", value: number(report.summary.encounters), sub: `${number(report.summary.active_hunters)} active hunters` },
      { label: "CLAIMS", value: number(report.summary.claims), sub: `${number(report.summary.failures)} failed contracts`, tone: "good" as const },
      { label: "CREDITS COLLECTED", value: `${number(report.summary.credits)} cr`, sub: `${number(report.summary.average_bounty)} average claim`, tone: "credits" as const },
      { label: "UNIQUE TARGETS", value: number(report.summary.unique_targets), sub: `${number(report.summary.active_days)} active days` },
    ],
    largestClaim: report.largestClaim ? {
      hunter: report.largestClaim.hunter_name,
      target: report.largestClaim.target_name,
      credits: number(report.largestClaim.credits),
    } : undefined,
    topHunters: report.topHunters.map((hunter) => ({
      name: hunter.hunter_name,
      guild: hunter.guild_abbreviation || "Unaligned",
      kills: `${hunter.kills}K`,
      record: `${hunter.deaths}D · ${hunter.failures} failed`,
      credits: number(hunter.credits),
    })),
    topTargets: report.topTargets.map((target) => ({
      name: target.target_name,
      issued: String(target.targeted),
      survived: String(target.survived),
      killed: String(target.killed),
    })),
    leaders: report.leaders.map((leader) => ({
      board: ALL_BOARD_LABELS[leader.leaderboard_id] ?? leader.leaderboard_id,
      name: leader.current_name,
      guild: leader.guild_abbreviation || "Unaligned",
      score: `${number(leader.score_raw ?? leader.score)}${leader.value_type === "CREDITS" ? " cr" : ""}`,
    })),
    activity: report.activity.map((day) => ({
      day: day.day,
      contracts: String(day.encounters),
      claims: String(day.claims),
      failures: String(day.failures),
      credits: number(day.credits),
    })),
  };
}
