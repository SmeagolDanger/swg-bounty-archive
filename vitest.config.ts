import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: { environment: "node", testTimeout: 60_000, hookTimeout: 60_000, coverage: { reporter: ["text", "json-summary"] } },
});
