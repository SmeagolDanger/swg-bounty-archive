import type { Metadata } from "next";
import { OverlayStudio } from "@/components/overlay-studio";

// Overlay studio: point-and-click builder for the stream overlay page and the
// dynamically rendered PNG. Unlike /overlay itself, this page keeps the
// normal site chrome; only the preview iframe is chrome-less.

export const metadata: Metadata = {
  title: "Image studio",
  description: "Build the Outer Rim Ledger stream overlay: live preview, OBS URL, and server-rendered PNG.",
};

const css = `
  .overlay-studio label { display: grid; gap: 0.3rem; margin: 0.9rem 0 0; font-size: 0.85rem; color: var(--muted); }
  .overlay-studio label small { color: var(--dim); font-weight: 400; }
  .studio-grid { display: grid; grid-template-columns: minmax(20rem, 26rem) 1fr; gap: 1.25rem; align-items: start; }
  @media (max-width: 60rem) { .studio-grid { grid-template-columns: 1fr; } }
  .studio-form { padding-bottom: 1.25rem; }
  .studio-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
  .studio-name { position: relative; }
  .studio-name .field { width: 100%; }
  .studio-suggestions { position: absolute; z-index: 5; inset: 100% 0 auto; margin: 0.25rem 0 0; padding: 0.25rem;
    list-style: none; background: var(--panel-2); border: 1px solid var(--line-bright); border-radius: 0.4rem;
    box-shadow: 0 0.8rem 2rem #000a; display: grid; }
  .studio-suggestions button { all: unset; cursor: pointer; padding: 0.45rem 0.6rem; border-radius: 0.3rem; color: var(--ink); width: 100%; box-sizing: border-box; }
  .studio-suggestions button:hover, .studio-suggestions button:focus-visible { background: var(--signal-soft); color: var(--signal); outline: none; }
  .studio-outputs { margin-top: 1.25rem; border-top: 1px solid var(--line); padding-top: 1rem; display: grid; gap: 0.8rem; }
  .studio-copy { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 0.6rem; align-items: center; font-size: 0.8rem; color: var(--dim); }
  .studio-copy span { grid-column: 1 / -1; letter-spacing: 0.08em; text-transform: uppercase; }
  .studio-copy code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink);
    background: var(--deep); border: 1px solid var(--line); border-radius: 0.3rem; padding: 0.4rem 0.55rem; font-size: 0.78rem; }
  .studio-generate { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.25rem; }
  .studio-error { color: var(--danger); font-size: 0.85rem; }
  .studio-wait { display: inline-flex; align-items: center; gap: 0.55rem; }
  .studio-wait i { width: 1.05em; height: 1.05em; border-radius: 50%; flex: none;
    background: conic-gradient(from 0turn, transparent 0 25%, var(--signal) 85%, transparent 100%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 0.2em), #000 calc(100% - 0.19em));
    mask: radial-gradient(farthest-side, transparent calc(100% - 0.2em), #000 calc(100% - 0.19em));
    animation: studio-spin 0.8s linear infinite; }
  @keyframes studio-spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .studio-wait i { animation-duration: 2.4s; } }
  .studio-stage { position: relative; min-height: 30rem; border: 1px solid var(--line); border-radius: 0.4rem; overflow: auto;
    background:
      radial-gradient(40rem 18rem at 20% 110%, #ff6b2b14, transparent 70%),
      radial-gradient(46rem 22rem at 85% -10%, #00d4ff12, transparent 70%),
      repeating-conic-gradient(#0d1017 0% 25%, #10141d 0% 50%) 0 0 / 26px 26px; }
  .studio-stage iframe { width: 100%; height: 52rem; border: 0; display: block; }
  .studio-stage .empty { position: absolute; inset: 0; display: grid; place-items: center; }
  .studio-stage-wait { position: absolute; inset: 0; display: grid; place-items: center; z-index: 2;
    color: var(--signal); font-size: 1rem; letter-spacing: 0.06em; pointer-events: none; }
  .studio-image { padding: 1.25rem; display: grid; gap: 1rem; justify-items: start; }
  .studio-image img { max-width: 100%; height: auto; }
  .studio-image-meta { color: var(--dim); letter-spacing: 0.05em; }
  .studio-image-actions { display: flex; flex-wrap: wrap; gap: 0.8rem; }
`;

export default function OverlayBuilderPage() {
  return <div className="shell">
    <style dangerouslySetInnerHTML={{ __html: css }}/>
    <header className="page-head">
      <span className="eyebrow">{"// Stream tools"}</span>
      <h1>Image studio</h1>
      <p>Build the bounty HUD for your stream: a transparent OBS browser source that keeps itself current, or a server-rendered PNG for anything that only takes an image URL. Times on the live overlay tick between polls; images are rendered on demand.</p>
    </header>
    <OverlayStudio/>
  </div>;
}
