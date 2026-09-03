# OBS stream overlay

`/overlay` renders a game-HUD "recent bounties" panel for one hunter, driven
by the public JSON API, on a fully transparent page — made to be an OBS
**Browser** source composited over gameplay.

## Setup

1. In OBS: **Sources → + → Browser**.
2. URL: `https://jawatracks.com/overlay?name=YourHunter`
3. Width/height: `1000 × 700` works well (the panel is ~896 px wide at scale 1).
4. Leave **Custom CSS** as the default (`body { background: transparent; }` is
   harmless — the page is already transparent).

The panel refreshes itself from the archive; no OBS refresh needed.

## URL options

| Param | Default | Meaning |
| --- | --- | --- |
| `name` | required | Hunter name (case-insensitive; resolved via archive search) |
| `rows` | 4 | Encounter rows, 1–10 |
| `refresh` | 30 | Poll interval in seconds (min 10; API responses are cached ~30 s) |
| `title` | Recent bounties | The red `// …` subtitle |
| `avatar` | — | Image URL for the circular portrait (defaults to a skull emblem) |
| `scale` | 1 | 0.4–3, scales the whole panel |

Example:
`/overlay?name=ChickenRat&rows=4&title=Recent%20bounties&avatar=https://example.com/chickenrat.png&scale=0.9`

## What it shows

- One row per recent encounter, from the streamer's perspective:
  **CLAIMED** (green) and **FAILED** (grey) as the hunter, **ESCAPED**
  (orange) and **SLAIN** (red) as the target, with payout and a relative
  time that keeps ticking between polls.
- Footer tiles: **Today: n claimed** (viewer-local day), **Cycle contracts**
  (contracts attempted in the current leaderboard cycle), **Best payout**
  (largest archived claim).

## Dynamic PNG

The same panel is also served as a **dynamically rendered image**:

```
GET /api/overlay/image?name=ChickenRat&rows=4
```

Headless Chromium (already in the container for the weekly Discord card)
loads `/overlay` against localhost, waits for the archive data, and
screenshots the panel with a transparent background. Same options as the
page; `scale` changes the output resolution. Renders are cached ~30 s and
deduplicated per parameter set, and the endpoint is rate-limited like the
rest of the public API. Use it for Discord embeds, stream widgets that only
take image URLs, or anywhere the HTML page can't run — for OBS itself the
Browser source above stays the better choice (ticking times, no re-render).

`OVERLAY_RENDER_BASE_URL` overrides where Chromium fetches the page
(default `http://127.0.0.1:3000`, the app itself inside the container).

## How it works

`src/app/overlay/page.tsx` hides the site chrome and paints only the panel;
`src/components/bounty-overlay.tsx` resolves the name via `/api/search`, then
polls `/api/hunters/{id}`; `src/lib/overlay/model.ts` is the pure, unit-tested
mapping from dossier JSON to rows and footer stats. Everything rides the
public API — read-only, rate-limited, no credentials.
