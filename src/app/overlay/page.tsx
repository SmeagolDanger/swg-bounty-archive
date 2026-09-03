import type { Metadata } from "next";
import { BountyOverlay } from "@/components/bounty-overlay";

// OBS browser-source overlay. Add a Browser source in OBS pointing at
//   https://jawatracks.com/overlay?name=YourHunter
// with a transparent background; the panel polls the public API and keeps
// itself current. Options: rows (1-10), refresh (seconds), title, avatar
// (image URL for the portrait), scale.
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
    --hud-metal: #16130f;
    --hud-metal-2: #201c16;
    --hud-line: #3a332a;
    --hud-line-2: #57503f;
    --hud-ink: #efe9dc;
    --hud-dim: #9d947f;
    --hud-red: #e33b2e;
    --hud-green: #7ad03c;
    --hud-orange: #f07f1f;
    --hud-gold: #f2a93b;
    --hud-slate: #8b8b8b;
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
      linear-gradient(160deg, #ffffff09 0%, transparent 30%),
      repeating-linear-gradient(115deg, transparent 0 22px, #00000033 22px 23px),
      linear-gradient(180deg, var(--hud-metal-2), var(--hud-metal));
    border: 2px solid var(--hud-line-2);
    outline: 1px solid #000000cc;
    box-shadow: 0 0 0 4px #0e0c09e0, 0 1.4rem 3rem #000000b0, inset 0 0 4rem #000000a0;
    clip-path: polygon(2.2rem 0, calc(100% - 4.5rem) 0, 100% 3rem, 100% calc(100% - 2.2rem), calc(100% - 2.2rem) 100%, 2.2rem 100%, 0 calc(100% - 2.2rem), 0 2.2rem);
    padding: 1.6rem 1.8rem 1.4rem;
  }
  .panel-frame::before {
    content: ""; position: absolute; inset: 0.55rem;
    border: 1px solid var(--hud-line); pointer-events: none;
    clip-path: polygon(1.8rem 0, calc(100% - 4rem) 0, 100% 2.6rem, 100% calc(100% - 1.8rem), calc(100% - 1.8rem) 100%, 1.8rem 100%, 0 calc(100% - 1.8rem), 0 1.8rem);
  }
  .panel-frame::after {
    content: ""; position: absolute; top: 0; right: 2.2rem; width: 8rem; height: 0.45rem;
    background: repeating-linear-gradient(90deg, var(--hud-red) 0 0.7rem, transparent 0.7rem 1.1rem);
    opacity: 0.85;
  }

  .panel-head { display: flex; gap: 1.4rem; align-items: center; padding: 0.4rem 0.4rem 1.1rem; }
  .portrait {
    flex: none; width: 7.2rem; height: 7.2rem; border-radius: 50%;
    border: 3px solid var(--hud-line-2); outline: 2px solid #000;
    box-shadow: 0 0 0 6px #241f18, 0 0 1.6rem #000 inset;
    overflow: hidden; background: radial-gradient(circle at 40% 30%, #2c261d, #0c0a07);
    display: grid; place-items: center;
  }
  .portrait img { width: 100%; height: 100%; object-fit: cover; }
  .portrait--emblem svg { width: 58%; height: 58%; color: var(--hud-red); filter: drop-shadow(0 0 0.5rem #e33b2e55); }
  .headline { min-width: 0; }
  .headline h1 {
    margin: 0; font-size: 3.4rem; line-height: 1; font-weight: 700;
    color: #f5f1e6; text-shadow: 0 2px 0 #000, 0 0 1.4rem #00000090;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .subtitle { margin-top: 0.35rem; font-size: 1.55rem; font-weight: 700; color: var(--hud-red); text-shadow: 0 1px 0 #000; }
  .source-line { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.5rem; color: var(--hud-dim); font-size: 0.85rem; letter-spacing: 0.14em; }
  .source-line i { flex: 1; height: 1px; background: linear-gradient(90deg, var(--hud-line-2), transparent); }

  .board { border: 1px solid var(--hud-line); background: #00000055; }
  .board-head, .board-row {
    display: grid; grid-template-columns: 1.35fr 1fr 0.9fr 0.55fr;
    align-items: center; gap: 0.6rem; padding: 0 1rem;
  }
  .board-head {
    height: 2.1rem; font-size: 0.8rem; letter-spacing: 0.18em; color: var(--hud-dim);
    border-bottom: 1px solid var(--hud-line); background: #ffffff06;
  }
  .board-head span:last-child, .cell-time { text-align: right; }
  .board-head span:nth-child(3), .cell-payout { text-align: right; }
  .board-row { height: 3.6rem; border-bottom: 1px solid #ffffff10; background: linear-gradient(180deg, #ffffff05, transparent); position: relative; }
  .board-row:last-child { border-bottom: 0; }
  .board-note { color: var(--hud-dim); font-size: 1rem; grid-template-columns: 1fr; }

  .cell-target { display: flex; align-items: center; gap: 0.7rem; min-width: 0; font-size: 1.35rem; font-weight: 600; }
  .cell-target b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell-target .edge { position: absolute; left: 0; top: 0.45rem; bottom: 0.45rem; width: 0.28rem; background: var(--hud-slate); }
  .tone-good .edge { background: var(--hud-green); box-shadow: 0 0 0.5rem #7ad03c66; }
  .tone-warn .edge { background: var(--hud-orange); box-shadow: 0 0 0.5rem #f07f1f66; }
  .tone-bad .edge { background: var(--hud-red); box-shadow: 0 0 0.5rem #e33b2e66; }
  .crosshair { width: 1.15rem; height: 1.15rem; color: var(--hud-gold); flex: none; }

  .cell-result { display: flex; align-items: center; gap: 0.55rem; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.12em; }
  .cell-result svg { width: 1.5rem; height: 1.5rem; flex: none; }
  .cell-result.tone-good { color: var(--hud-green); text-shadow: 0 0 0.8rem #7ad03c40; }
  .cell-result.tone-warn { color: var(--hud-orange); text-shadow: 0 0 0.8rem #f07f1f40; }
  .cell-result.tone-bad { color: var(--hud-red); text-shadow: 0 0 0.8rem #e33b2e40; }
  .cell-result.tone-muted { color: var(--hud-slate); }

  .cell-payout { font-size: 1.35rem; font-weight: 700; color: var(--hud-gold); font-variant-numeric: tabular-nums; }
  .cell-payout small { font-size: 0.8rem; color: var(--hud-dim); }
  .cell-time { font-size: 0.95rem; color: var(--hud-ink); opacity: 0.85; font-variant-numeric: tabular-nums; text-transform: none; }

  .panel-foot {
    margin-top: 1rem; border: 1px solid var(--hud-line); background: #00000055;
    display: grid; grid-template-columns: 1fr 1fr 1.2fr; align-items: center;
  }
  .panel-foot > div { display: flex; align-items: center; gap: 0.6rem; padding: 0.8rem 1rem; border-right: 1px solid var(--hud-line); font-size: 0.95rem; }
  .panel-foot > div:last-child { border-right: 0; }
  .panel-foot svg { width: 1.4rem; height: 1.4rem; color: var(--hud-gold); flex: none; }
  .panel-foot span { color: var(--hud-dim); letter-spacing: 0.12em; }
  .panel-foot b { font-size: 1.25rem; font-weight: 700; }
  .tone-good { color: var(--hud-green); }
  .tone-gold { color: var(--hud-gold); }
`;

export default async function OverlayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const name = one(query.name)?.trim().slice(0, 100);
  const rows = Math.max(1, Math.min(10, Number(one(query.rows)) || 4));
  const refresh = Math.max(10, Math.min(600, Number(one(query.refresh)) || 30));
  const scale = Math.max(0.4, Math.min(3, Number(one(query.scale)) || 1));
  const avatar = one(query.avatar)?.slice(0, 500);
  const title = (one(query.title) ?? "Recent bounties").slice(0, 40);

  return <>
    <style dangerouslySetInnerHTML={{ __html: css }} />
    <div style={{ ["--overlay-scale" as never]: String(scale) }}>
      {name
        ? <BountyOverlay name={name} rows={rows} refresh={refresh} avatar={avatar} title={title} />
        : <div className="bounty-overlay"><div className="panel-frame"><div className="board-note" style={{ padding: "1rem" }}>
            Add ?name=YourHunter to the URL — e.g. /overlay?name=ChickenRat&rows=4
          </div></div></div>}
    </div>
  </>;
}
