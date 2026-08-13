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

  it("never adds CORS headers to admin responses", async () => {
    const response = await proxy(new NextRequest("http://localhost/admin/ingestion", {
      headers: { accept: "text/html", origin: "https://community.example" },
    }));

    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });
});

describe("public API CORS", () => {
  it("allows any origin on API requests", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/encounters", {
      headers: { origin: "https://community.example" },
    }));

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("answers preflight requests without touching route handlers", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/encounters", {
      method: "OPTIONS",
      headers: { origin: "https://community.example", "access-control-request-method": "GET" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-max-age")).toBe("86400");
  });

  it("does not require admin credentials for API routes", async () => {
    const previousUsername = process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_USERNAME;
    try {
      const response = await proxy(new NextRequest("http://localhost/api/health"));
      expect(response.status).not.toBe(503);
      expect(response.status).not.toBe(401);
    } finally {
      if (previousUsername !== undefined) process.env.ADMIN_USERNAME = previousUsername;
    }
  });
});
