"use client";

import { useState } from "react";
import { toPng } from "html-to-image";

// Renders the report itself to a PNG download — the same "Share Image"
// behavior as the Jawa Tracks apps, instead of routing through print.
// Interactive controls opt out of the capture with data-export-exclude.
export function ReportExportButton() {
  const [busy, setBusy] = useState(false);

  async function saveImage() {
    const node = document.querySelector<HTMLElement>(".weekly-report");
    if (!node || busy) return;
    setBusy(true);
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: "#070810",
        filter: (child) => !(child instanceof HTMLElement && "exportExclude" in child.dataset),
      });
      const link = document.createElement("a");
      link.download = `JawaTracks-Weekly-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setBusy(false);
    }
  }

  return <button className="button report-export" type="button" onClick={saveImage} disabled={busy} data-export-exclude>
    {busy ? "Rendering…" : "Save image"}
  </button>;
}
