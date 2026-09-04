// URL assembly for the overlay studio (/overlay/builder). Pure so the
// query-string logic is unit-testable; the studio component only renders.

export interface StudioState {
  name: string;
  period: "recent" | "today" | "cycle";
  rows?: number;
  title?: string;
  avatar?: string;
  scale?: number;
  tz?: string;
  refresh?: number;
}

const clean = (state: StudioState): StudioState => ({
  ...state,
  name: state.name.trim(),
  title: state.title?.trim() || undefined,
  avatar: state.avatar?.trim() || undefined,
  tz: state.tz?.trim() || undefined,
});

function sharedParams(state: StudioState): URLSearchParams {
  const params = new URLSearchParams({ name: state.name });
  if (state.period !== "recent") params.set("period", state.period);
  if (state.rows && Number.isFinite(state.rows)) params.set("rows", String(Math.max(1, Math.min(100, Math.floor(state.rows)))));
  if (state.title) params.set("title", state.title.slice(0, 40));
  if (state.avatar) params.set("avatar", state.avatar.slice(0, 500));
  // The day boundary zone matters only for "today"; keep other URLs clean.
  if (state.period === "today" && state.tz) params.set("tz", state.tz);
  return params;
}

// The OBS browser-source URL. scale affects on-screen size; refresh the poll.
export function overlayPageHref(raw: StudioState): string {
  const state = clean(raw);
  const params = sharedParams(state);
  if (state.scale && state.scale !== 1) params.set("scale", String(state.scale));
  if (state.refresh && state.refresh !== 30) params.set("refresh", String(Math.max(10, Math.min(600, Math.floor(state.refresh)))));
  return `/overlay?${params}`;
}

// The dynamic PNG. scale sets output resolution; refresh doesn't apply.
export function overlayImageHref(raw: StudioState): string {
  const state = clean(raw);
  const params = sharedParams(state);
  if (state.scale && state.scale !== 1) params.set("scale", String(state.scale));
  return `/api/overlay/image?${params}`;
}
