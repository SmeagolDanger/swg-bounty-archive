import { BOUNTY_BOARD_IDS, PERIODS, SUBJECTS, swgBaseUrl } from "../src/lib/ingestion/config";
import { fetchJson } from "../src/lib/ingestion/fetcher";
import { schemaSignature } from "../src/lib/ingestion/hash";

const base = swgBaseUrl();
const routes = ["/api/game/leaderboards", "/api/game/bounty-hunting"];
for (const id of BOUNTY_BOARD_IDS) {
  routes.push(`/api/game/leaderboard?${new URLSearchParams({ id, period: PERIODS[0], subject: SUBJECTS[0] })}`);
  routes.push(`/api/game/leaderboard-wins?${new URLSearchParams({ id })}`);
}

for (const route of routes) {
  const response = await fetchJson(`${base}${route}`, { maxRetries: 1 });
  const shape = response.payload === null ? null : schemaSignature(response.payload);
  process.stdout.write(`${JSON.stringify({ route, status: response.status, durationMs: response.durationMs, cacheControl: response.headers["cache-control"], schemaSignature: shape?.signature, fields: shape?.paths }, null, 2)}\n`);
}
