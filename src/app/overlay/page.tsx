import type { Metadata } from "next";
import { BountyOverlay } from "@/components/bounty-overlay";
import type { OverlayPeriod } from "@/lib/overlay/model";

// OBS browser-source overlay. Add a Browser source in OBS pointing at
//   https://jawatracks.com/overlay?name=YourHunter
// with a transparent background; the panel polls the public API and keeps
// itself current. Options: period (recent | today | cycle), rows (1-20),
// refresh (seconds), title, avatar
// (image URL for the portrait), scale. today/cycle show that full window.
//
// The site chrome is hidden and the body made transparent by the styles
// below — everything outside the panel composites over gameplay.

export const metadata: Metadata = { title: "Stream overlay", robots: { index: false } };

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

const css = `
  .site-header, .site-footer, .scanlines, .skip-link { display: none !important; }
  html, body { background: transparent !important; }
  main { padding: 0 !important; }

  .bounty-overlay {
    --hud-void: #0a0e16;
    --hud-panel: #101623;
    --hud-panel-2: #161d2c;
    --hud-line: #263045;
    --hud-line-2: #45526e;
    --hud-ink: #e6ecf7;
    --hud-dim: #8d97b0;
    --hud-signal: #3fd6ff;
    --hud-red: #ff4455;
    --hud-green: #2ee06c;
    --hud-orange: #ffa02b;
    --hud-gold: #ffb648;
    --hud-slate: #7d8699;
    font-family: var(--font-display), "Arial Narrow", sans-serif;
    color: var(--hud-ink);
    width: min(56rem, 96vw);
    margin: 2vh auto;
    transform: scale(var(--overlay-scale, 1));
    transform-origin: top center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .bounty-overlay * { box-sizing: border-box; }

  .panel-frame {
    position: relative;
    background:
      linear-gradient(160deg, #7fd8ff0a 0%, transparent 32%),
      repeating-linear-gradient(0deg, transparent 0 3px, #00000026 3px 4px),
      radial-gradient(46rem 20rem at 82% -10%, #1c2c4699, transparent 70%),
      linear-gradient(180deg, var(--hud-panel-2), var(--hud-panel) 55%, var(--hud-void));
    border: 1px solid var(--hud-line-2);
    outline: 1px solid #000000d8;
    box-shadow: 0 0 0 4px #0b101ae8, 0 1.4rem 3rem #000000b8, 0 0 2.6rem #3fd6ff14, inset 0 0 5rem #060a12c0;
    clip-path: polygon(2.2rem 0, calc(100% - 4.5rem) 0, 100% 3rem, 100% calc(100% - 2.2rem), calc(100% - 2.2rem) 100%, 2.2rem 100%, 0 calc(100% - 2.2rem), 0 2.2rem);
    padding: 1.6rem 1.8rem 1.4rem;
  }
  .panel-frame::before {
    content: ""; position: absolute; inset: 0.55rem;
    border: 1px solid var(--hud-line); pointer-events: none;
    clip-path: polygon(1.8rem 0, calc(100% - 4rem) 0, 100% 2.6rem, 100% calc(100% - 1.8rem), calc(100% - 1.8rem) 100%, 1.8rem 100%, 0 calc(100% - 1.8rem), 0 1.8rem);
  }
  .panel-frame::after {
    content: ""; position: absolute; top: 0; right: 2.2rem; width: 8rem; height: 0.4rem;
    background: repeating-linear-gradient(90deg, var(--hud-signal) 0 0.7rem, transparent 0.7rem 1.1rem);
    opacity: 0.9; box-shadow: 0 0 0.8rem #3fd6ff66;
  }

  .panel-head { display: flex; gap: 1.4rem; align-items: center; padding: 0.4rem 0.4rem 1.1rem; }
  .portrait {
    flex: none; width: 7.2rem; height: 7.2rem; border-radius: 50%;
    border: 2px solid var(--hud-line-2); outline: 2px solid #05080e;
    box-shadow: 0 0 0 5px #131a29, 0 0 1.4rem #3fd6ff22, 0 0 1.6rem #000 inset;
    overflow: hidden; background: radial-gradient(circle at 40% 30%, #1d2740, #090d16);
    display: grid; place-items: center;
  }
  .portrait img { width: 100%; height: 100%; object-fit: cover; }
  .portrait--emblem svg { width: 56%; height: 56%; color: var(--hud-signal); filter: drop-shadow(0 0 0.6rem #3fd6ff66); }
  .headline { min-width: 0; }
  .headline h1 {
    margin: 0; font-size: 3.4rem; line-height: 1; font-weight: 700;
    color: #ff3540;
    text-shadow: 0 2px 0 #45060b, 0 0 0.9rem #ff1e2e59, 0 0 2.4rem #ff1e2e38;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .subtitle { margin-top: 0.35rem; font-size: 1.55rem; font-weight: 700; color: var(--hud-signal); text-shadow: 0 1px 0 #000, 0 0 1rem #3fd6ff55; }
  .source-line { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.5rem; color: var(--hud-dim); font-size: 0.85rem; letter-spacing: 0.14em; }
  .source-line i { flex: 1; height: 1px; background: linear-gradient(90deg, #3fd6ff88, var(--hud-line-2) 40%, transparent); }

  .board { border: 1px solid var(--hud-line); background: #060a1266; }
  .board-head, .board-row {
    display: grid; grid-template-columns: 1.35fr 1fr 0.9fr 0.55fr;
    align-items: center; gap: 0.6rem; padding: 0 1rem;
  }
  .board-head {
    height: 2.1rem; font-size: 0.8rem; letter-spacing: 0.18em; color: var(--hud-signal);
    border-bottom: 1px solid var(--hud-line); background: linear-gradient(180deg, #3fd6ff10, #3fd6ff04);
  }
  .board-head span:last-child, .cell-time { text-align: right; }
  .board-head span:nth-child(3), .cell-payout { text-align: right; }
  .board-row { height: 3.6rem; border-bottom: 1px solid #7fa2ff12; background: linear-gradient(180deg, #ffffff05, transparent); position: relative; }
  .board-row:last-child { border-bottom: 0; }
  .board-note { color: var(--hud-dim); font-size: 1rem; grid-template-columns: 1fr; }

  .cell-target { display: flex; align-items: center; gap: 0.7rem; min-width: 0; font-size: 1.35rem; font-weight: 600; }
  .cell-target b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell-target .edge { position: absolute; left: 0; top: 0.45rem; bottom: 0.45rem; width: 0.28rem; background: var(--hud-slate); }
  .tone-good .edge { background: var(--hud-green); box-shadow: 0 0 0.6rem #2ee06c77; }
  .tone-warn .edge { background: var(--hud-orange); box-shadow: 0 0 0.6rem #ffa02b77; }
  .tone-bad .edge { background: var(--hud-red); box-shadow: 0 0 0.6rem #ff445577; }
  .crosshair { width: 1.15rem; height: 1.15rem; color: var(--hud-signal); flex: none; opacity: 0.9; }

  .cell-result { display: flex; align-items: center; gap: 0.55rem; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.12em; }
  .cell-result svg { width: 1.5rem; height: 1.5rem; flex: none; }
  .cell-result.tone-good { color: var(--hud-green); text-shadow: 0 0 0.9rem #2ee06c44; }
  .cell-result.tone-warn { color: var(--hud-orange); text-shadow: 0 0 0.9rem #ffa02b44; }
  .cell-result.tone-bad { color: var(--hud-red); text-shadow: 0 0 0.9rem #ff445544; }
  .cell-result.tone-muted { color: var(--hud-slate); }

  .cell-payout { font-size: 1.35rem; font-weight: 700; color: var(--hud-gold); text-shadow: 0 0 0.9rem #ffb64833; font-variant-numeric: tabular-nums; }
  .cell-payout small { font-size: 0.8rem; color: var(--hud-dim); }
  .cell-time { font-size: 0.95rem; color: var(--hud-ink); opacity: 0.8; font-variant-numeric: tabular-nums; text-transform: none; }

  .panel-foot {
    margin-top: 1rem; border: 1px solid var(--hud-line); background: #060a1266;
    display: grid; grid-template-columns: 0.95fr 0.8fr 1.1fr 1.1fr; align-items: center;
  }
  .panel-foot > div { display: flex; align-items: center; gap: 0.5rem; padding: 0.8rem 0.8rem; border-right: 1px solid var(--hud-line); font-size: 0.85rem; white-space: nowrap; }
  .panel-foot > div:last-child { border-right: 0; }
  .panel-foot svg { width: 1.25rem; height: 1.25rem; color: var(--hud-signal); flex: none; opacity: 0.9; }
  .panel-foot span { color: var(--hud-dim); letter-spacing: 0.12em; }
  .panel-foot b { font-size: 1.1rem; font-weight: 700; }
  .tone-good { color: var(--hud-green); }
  .tone-gold { color: var(--hud-gold); }
`;

export default async function OverlayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const name = one(query.name)?.trim().slice(0, 100);
  const periodRaw = one(query.period);
  const period: OverlayPeriod = periodRaw === "today" || periodRaw === "cycle" ? periodRaw : "recent";
  const defaults: Record<OverlayPeriod, { rows: number; title: string }> = {
    recent: { rows: 4, title: "Recent bounties" },
    today: { rows: 10, title: "Today's ledger" },
    cycle: { rows: 10, title: "Cycle report" },
  };
  const rows = Math.max(1, Math.min(20, Number(one(query.rows)) || defaults[period].rows));
  const refresh = Math.max(10, Math.min(600, Number(one(query.refresh)) || 30));
  const scale = Math.max(0.4, Math.min(3, Number(one(query.scale)) || 1));
  const avatar = one(query.avatar)?.slice(0, 500);
  const title = (one(query.title) ?? defaults[period].title).slice(0, 40);

  return <>
    <style dangerouslySetInnerHTML={{ __html: css }} />
    <div style={{ ["--overlay-scale" as never]: String(scale) }}>
      {name
        ? <BountyOverlay name={name} rows={rows} refresh={refresh} avatar={avatar} title={title} period={period} />
        : <div className="bounty-overlay"><div className="panel-frame"><div className="board-note" style={{ padding: "1rem" }}>
            Add ?name=YourHunter to the URL — e.g. /overlay?name=ChickenRat&rows=4
          </div></div></div>}
    </div>
  </>;
}
