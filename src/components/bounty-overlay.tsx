"use client";

import { useEffect, useMemo, useState } from "react";
import { overlayView, type OverlayDossier, type OverlayPeriod, type OverlayResult, type OverlayTileIcon } from "@/lib/overlay/model";

// OBS browser-source overlay: a game-HUD bounty panel driven by the public
// dossier API. The page body is transparent; only the panel is painted, so it
// composites cleanly over gameplay. period selects the window: recent (last
// contracts), today (the viewer-local day in full), or cycle (this
// leaderboard week in full).

const RESULT_STYLE: Record<OverlayResult, { label: string; tone: string }> = {
  CLAIMED: { label: "CLAIMED", tone: "good" },
  FAILED: { label: "FAILED", tone: "bad" },
  ESCAPED: { label: "ESCAPED", tone: "warn" },
  SLAIN: { label: "SLAIN", tone: "bad" },
};

function ResultIcon({ result }: { result: OverlayResult }) {
  if (result === "CLAIMED" || result === "SLAIN") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 21 6.75v10.5L12 22.5 3 17.25V6.75Z" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M12 6c-2.8 0-4.6 1.9-4.6 4.3 0 1.5.8 2.5 1.7 3.1v1.7h1.6v1.4h2.6v-1.4h1.6v-1.7c.9-.6 1.7-1.6 1.7-3.1C16.6 7.9 14.8 6 12 6Zm-2 5.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm4 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" fill="currentColor"/></svg>;
  }
  if (result === "ESCAPED") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 21.8 12 12 21.8 2.2 12Z" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M13.6 7.4a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM9 19l2.2-3.6-1.4-2.6L7 15l-1.2-1.1 3.4-2.9 2.6.4 1.3-2-2-.5L8.6 10 7.5 8.9l3.4-2.3 3.3.8 1.6 2.7 2.7.8-.5 1.5-3.2-.9-1 1.7 2 2.6L14.5 20l-1.4-.9 1-3-1.9-2-2 4.2Z" fill="currentColor"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m8.4 8.4 7.2 7.2M15.6 8.4l-7.2 7.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

const Crosshair = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="crosshair"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
const Star = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.6 6.2 6.7.5-5.1 4.4 1.6 6.6L12 16.1l-5.8 3.6 1.6-6.6-5.1-4.4 6.7-.5Z" fill="currentColor"/></svg>;
const Clipboard = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><rect x="8.5" y="2" width="7" height="4" rx="1" fill="currentColor"/><path d="M8 10h8M8 13.5h8M8 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
const Trophy = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v2h4v2.5C21 10 19.4 12 17 12.4A5.5 5.5 0 0 1 13 15v3h3v3H8v-3h3v-3a5.5 5.5 0 0 1-4-2.6C4.6 12 3 10 3 7.5V5h4Zm-2 4v.5C5 8.9 5.7 10 7 10.3V7Zm14 0h-2v3.3c1.3-.3 2-1.4 2-2.8Z" fill="currentColor"/></svg>;
const Emblem = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 22 12l-10 10.2L2 12Z" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M12 5.4c-3.1 0-5 2-5 4.7 0 1.6.8 2.7 1.8 3.4v1.8h1.7v1.5h3v-1.5h1.7v-1.8c1-.7 1.8-1.8 1.8-3.4 0-2.7-1.9-4.7-5-4.7Zm-2.1 5.7a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.2 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z" fill="currentColor"/></svg>;

const TILE_ICONS: Record<OverlayTileIcon, () => React.ReactNode> = { aim: Crosshair, list: Clipboard, star: Star, trophy: Trophy };

interface Search { results: Array<{ id: string; participant_type: string; current_name: string }> }

export function BountyOverlay({ name, rows: rowCount, refresh, avatar, title, period, tz }: {
  name: string; rows?: number; refresh: number; avatar?: string; title: string; period: OverlayPeriod; tz?: string;
}) {
  const [dossier, setDossier] = useState<OverlayDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let participantId: string | null = null;
    const load = async () => {
      try {
        if (!participantId) {
          const search = await fetch(`/api/search?q=${encodeURIComponent(name)}`);
          if (!search.ok) throw new Error(`search HTTP ${search.status}`);
          const players = ((await search.json()) as Search).results.filter((row) => row.participant_type === "player");
          participantId = (players.find((row) => row.current_name.toLowerCase() === name.toLowerCase()) ?? players[0])?.id ?? null;
          if (!participantId) throw new Error(`No hunter named “${name}” in the archive`);
        }
        const response = await fetch(`/api/hunters/${participantId}`);
        if (!response.ok) throw new Error(`dossier HTTP ${response.status}`);
        const data = (await response.json()) as OverlayDossier;
        if (!cancelled) { setDossier(data); setError(null); }
      } catch (cause) {
        if (!cancelled) setError((current) => current ?? (cause instanceof Error ? cause.message : "Archive unreachable"));
      }
    };
    void load();
    const poll = setInterval(load, Math.max(10, refresh) * 1000);
    const clock = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => { cancelled = true; clearInterval(poll); clearInterval(clock); };
  }, [name, refresh]);

  const now = useMemo(() => new Date(), [dossier, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = dossier ? overlayView(dossier, period, rowCount, now, tz) : null;
  const displayName = dossier?.participant.current_name ?? name;

  // data-overlay-ready lets the server-side PNG renderer (/api/overlay/image)
  // wait until the archive has answered before screenshotting.
  return <div className="bounty-overlay" data-overlay-root data-overlay-ready={dossier || error ? "" : undefined}>
    <div className="panel-frame">
      <header className="panel-head">
        <div className={`portrait${avatar ? "" : " portrait--emblem"}`}>
          {/* Remote art is streamer-supplied; next/image would proxy it through the app for no benefit here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatar ? <img src={avatar} alt="" /> : <Emblem/>}
        </div>
        <div className="headline">
          <h1>{displayName}</h1>
          <div className="subtitle">{"// "}{title}</div>
          <div className="source-line"><span>Outer Rim Ledger feed</span><i aria-hidden="true"/></div>
        </div>
      </header>

      <div className="board">
        <div className="board-head"><span>Target</span><span>Result</span><span>Payout</span><span>Time</span></div>
        {error && !dossier && <div className="board-row board-note">{error}</div>}
        {!error && !dossier && <div className="board-row board-note">Contacting the Ledger…</div>}
        {view && view.rows.length === 0 && <div className="board-row board-note">{view.emptyNote}</div>}
        {view?.rows.map((row) => {
          const style = RESULT_STYLE[row.result];
          return <div className={`board-row tone-${style.tone}`} key={row.key}>
            <span className="cell-target"><i className="edge" aria-hidden="true"/><Crosshair/><b>{row.target}</b></span>
            <span className={`cell-result tone-${style.tone}`}><ResultIcon result={row.result}/>{style.label}</span>
            <span className="cell-payout">{row.payout ? <>{row.payout} <small>cr</small></> : "—"}</span>
            <span className="cell-time">{row.time}</span>
          </div>;
        })}
        {view && view.omitted > 0 && <div className="board-row board-note">… {view.omitted} more this window</div>}
      </div>

      {view && <footer className="panel-foot" style={{ gridTemplateColumns: `repeat(${view.tiles.length}, 1fr)` }}>
        {view.tiles.map((tile) => {
          const Icon = TILE_ICONS[tile.icon];
          return <div key={tile.label}><Icon/><span>{tile.label}:</span><b className={tile.tone ? `tone-${tile.tone}` : undefined}>{tile.value}</b></div>;
        })}
      </footer>}
    </div>
  </div>;
}
