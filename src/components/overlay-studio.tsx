"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rankByName } from "@/lib/discord/commands";
import { overlayImageHref, overlayPageHref, type StudioState } from "@/lib/overlay/studio";

// Overlay studio: build the OBS browser-source URL and the dynamic PNG for a
// hunter, with a live transparent preview. Image generation takes a few
// seconds server-side (headless Chromium), so waits get a spinner.

type Suggestion = { id: string; participant_type: string; current_name: string };

const PERIODS = [
  { value: "recent", label: "Recent — rolling last contracts" },
  { value: "today", label: "Today — the full local day" },
  { value: "cycle", label: "Cycle — the full leaderboard week" },
] as const;

function Spinner({ label }: { label: string }) {
  return <span className="studio-wait" role="status"><i aria-hidden="true"/>{label}</span>;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="studio-copy">
    <span>{label}</span>
    <code>{value}</code>
    <button type="button" className="button secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
    }}>{copied ? "Copied ✓" : "Copy"}</button>
  </div>;
}

export function OverlayStudio() {
  // The day boundary defaults to the game server's zone (SWG Legends runs on
  // US Eastern), matching what the overlay itself defaults to.
  const [state, setState] = useState<StudioState>({ name: "", period: "recent", tz: "America/New_York" });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; href: string; blob: Blob; width: number; height: number } | null>(null);
  const [imageCopied, setImageCopied] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  // Hunter autocomplete from the archive directory (players only).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (confirmed || state.name.trim().length < 2) { setSuggestions([]); return; }
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(state.name.trim())}`, { signal: controller.signal });
        if (!response.ok) return;
        const players = ((await response.json()).results as Suggestion[]).filter((row) => row.participant_type === "player");
        setSuggestions(rankByName(players, state.name.trim()).slice(0, 8));
      } catch { /* aborted */ }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [state.name, confirmed]);

  const ready = state.name.trim().length > 0;
  const pageHref = useMemo(() => ready ? overlayPageHref(state) : "", [ready, state]);
  const imageHref = useMemo(() => ready ? overlayImageHref(state) : "", [ready, state]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // Debounce the live preview so it doesn't reload on every keystroke. The
  // preview shrinks the panel a notch so it fits the stage without clipping;
  // an explicit user scale wins.
  const previewSource = useMemo(() => !ready ? "" : overlayPageHref({ ...state, scale: state.scale && state.scale !== 1 ? state.scale : 0.88 }), [ready, state]);
  const [previewHref, setPreviewHref] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewHref(previewSource);
      if (previewSource) setPreviewLoading(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [previewSource]);

  const set = (patch: Partial<StudioState>) => setState((s) => ({ ...s, ...patch }));

  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerated(null);
    try {
      const response = await fetch(imageHref);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `The renderer answered HTTP ${response.status}`);
      }
      const blob = await response.blob();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      const size = await new Promise<{ width: number; height: number }>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
        probe.onerror = () => resolve({ width: 0, height: 0 });
        probe.src = objectUrl.current!;
      });
      setGenerated({ url: objectUrl.current, href: `${origin}${imageHref}`, blob, ...size });
    } catch (cause) {
      setGenerateError(cause instanceof Error ? cause.message : "Image rendering failed");
    } finally {
      setGenerating(false);
    }
  };

  return <div className="overlay-studio">
    <div className="studio-grid">
      <div className="panel studio-form">
        <div className="panel-header"><h3>Configure</h3><span className="chip">Live from the archive</span></div>
        <label>Hunter
          <div className="studio-name">
            <input className="field" value={state.name} placeholder="Start typing a hunter name…" autoFocus
              onChange={(event) => { setConfirmed(false); set({ name: event.target.value }); }}/>
            {suggestions.length > 0 && <ul className="studio-suggestions">
              {suggestions.map((row) => <li key={row.id}>
                <button type="button" onClick={() => { set({ name: row.current_name }); setConfirmed(true); setSuggestions([]); }}>{row.current_name}</button>
              </li>)}
            </ul>}
          </div>
        </label>
        <label>Window
          <select className="field" value={state.period} onChange={(event) => set({ period: event.target.value as StudioState["period"] })}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        {state.period === "today" && <label>Day boundary timezone <small>(default: Legends server time)</small>
          <input className="field" value={state.tz ?? ""} onChange={(event) => set({ tz: event.target.value })} placeholder="America/Halifax"/>
        </label>}
        <div className="studio-row">
          <label>Rows <small>(blank = default)</small>
            <input className="field" type="number" min={1} max={100} value={state.rows ?? ""}
              onChange={(event) => set({ rows: event.target.value ? Number(event.target.value) : undefined })}/>
          </label>
          <label>Scale
            <input className="field" type="number" step={0.1} min={0.4} max={3} value={state.scale ?? 1}
              onChange={(event) => set({ scale: Number(event.target.value) || 1 })}/>
          </label>
        </div>
        <label>Title <small>(the red // line)</small>
          <input className="field" value={state.title ?? ""} placeholder="Recent bounties / Today's ledger / Cycle report" maxLength={40}
            onChange={(event) => set({ title: event.target.value })}/>
        </label>
        <label>Portrait image URL <small>(optional)</small>
          <input className="field" value={state.avatar ?? ""} placeholder="https://…/your-character.png"
            onChange={(event) => set({ avatar: event.target.value })}/>
        </label>

        {ready && <div className="studio-outputs">
          <CopyField label="OBS browser source" value={`${origin}${pageHref}`}/>
          <CopyField label="Dynamic PNG" value={`${origin}${imageHref}`}/>
          <div className="studio-generate">
            <button type="button" className="button" disabled={generating} onClick={generate}>
              {generating ? <Spinner label="Rendering on the server…"/> : "Generate image"}
            </button>
            {generateError && <span className="studio-error">{generateError}</span>}
          </div>
        </div>}
      </div>

      <div className="panel studio-preview">
        <div className="panel-header"><h3>{generated ? "Generated image" : "Live preview"}</h3>
          <span className="chip">{generated ? "PNG · transparent" : "Transparent over your gameplay"}</span></div>
        <div className="studio-stage">
          {!ready && <div className="empty">Pick a hunter to see the overlay.</div>}
          {ready && !generated && <>
            {previewLoading && <div className="studio-stage-wait"><Spinner label="Loading overlay…"/></div>}
            {previewHref && <iframe title="Overlay preview" src={previewHref} onLoad={() => setPreviewLoading(false)}/>}
          </>}
          {generated && <div className="studio-image">
            {/* Freshly rendered blob; next/image can't optimize an object URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={generated.url} alt="Generated overlay panel"/>
            <small className="studio-image-meta">
              {generated.width > 0 && `${generated.width} × ${generated.height} px · `}{Math.max(1, Math.round(generated.blob.size / 1024))} KB · transparent PNG
            </small>
            <div className="studio-image-actions">
              <a className="button" href={generated.url} download={`bounty-overlay-${state.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}>Download PNG</a>
              <button type="button" className="button secondary" onClick={async () => {
                try {
                  await navigator.clipboard.write([new ClipboardItem({ "image/png": generated.blob })]);
                  setImageCopied(true); setTimeout(() => setImageCopied(false), 1500);
                } catch { /* clipboard image not supported in this browser */ }
              }}>{imageCopied ? "Copied ✓" : "Copy image"}</button>
              <a className="button secondary" href={generated.href} target="_blank" rel="noreferrer">Open live URL ↗</a>
              <button type="button" className="button secondary" onClick={() => setGenerated(null)}>Back to live preview</button>
            </div>
          </div>}
        </div>
      </div>
    </div>
  </div>;
}
