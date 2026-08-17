"use client";

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import { ReportShareImage, type ReportShareVM } from "./report-share-image";

// Mounts the purpose-built share composition off-screen, captures it to a
// 2x PNG, and downloads it — the Share Image behavior from the apps.
export function ReportExportButton({ vm }: { vm: ReportShareVM }) {
  const [busy, setBusy] = useState(false);

  async function saveImage() {
    if (busy) return;
    setBusy(true);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;pointer-events:none;";
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await new Promise<void>((resolve) => {
        root.render(<ReportShareImage vm={vm}/>);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await document.fonts.ready;
      const node = host.querySelector<HTMLElement>("[data-report-share]");
      if (!node) return;
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: "#070810",
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      const link = document.createElement("a");
      link.download = `JawaTracks-Weekly-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      root.unmount();
      host.remove();
      setBusy(false);
    }
  }

  return <button className="button report-export" type="button" onClick={saveImage} disabled={busy}>
    {busy ? "Rendering…" : "Save image"}
  </button>;
}
