import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const originalUsername = process.env.ADMIN_USERNAME;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;
const backgroundHeaders: Array<Record<string, string>> = [
  { "next-router-prefetch": "1" },
  { purpose: "prefetch" },
  { "sec-purpose": "prefetch" },
  { rsc: "1", accept: "text/x-component" },
];

describe("admin authentication challenge", () => {
  beforeEach(() => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD_HASH = "$2b$12$not-used-without-an-authorization-header";
  });

  afterAll(() => {
    if (originalUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = originalUsername;
    if (originalPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = originalPasswordHash;
  });

  it("challenges an intentional document request", async () => {
    const response = await proxy(new NextRequest("http://localhost/admin/ingestion", {
      headers: { accept: "text/html" },
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it.each(backgroundHeaders)("does not open a browser dialog for background request %o", async (headers) => {
    const response = await proxy(new NextRequest("http://localhost/admin/ingestion", { headers }));

    expect(response.status).toBe(401);
    expect(response.headers.has("www-authenticate")).toBe(false);
  });
});
