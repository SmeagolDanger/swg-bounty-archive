import { getWeeklyReport } from "@/lib/data";
import { buildReportShareVM } from "@/lib/report-share";
import { ReportShareImage } from "@/components/report-share-image";

// Renders only the share composition; the Discord poster screenshots the
// [data-report-share] element, so surrounding site chrome is irrelevant.
export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function WeeklyShareCardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const report = await getWeeklyReport("PREVIOUS_1", one(query.cycle));
  const vm = buildReportShareVM(report);
  if (!vm) return <div className="empty">This cycle has not been archived yet.</div>;
  return <ReportShareImage vm={vm}/>;
}
