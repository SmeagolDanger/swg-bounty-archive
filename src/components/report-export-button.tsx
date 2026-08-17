"use client";

export function ReportExportButton() {
  return <button className="button report-export" type="button" onClick={() => window.print()}>
    Export / save PDF
  </button>;
}
