import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

function isBackgroundNavigation(request: NextRequest) {
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`;
  return purpose.includes("prefetch")
    || request.headers.get("next-router-prefetch") === "1"
    || request.headers.get("x-middleware-prefetch") === "1"
    || request.headers.get("rsc") === "1"
    || request.headers.get("accept")?.includes("text/x-component") === true;
}

// The public API is read-only and serves data that is already public at its source,
// so any origin may call it. Admin routes are excluded: they never receive CORS
// headers, and the wildcard is safe because credentials are never allowed with it.
const publicApiCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) {
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: publicApiCors });
    const response = NextResponse.next();
    for (const [header, value] of Object.entries(publicApiCors)) response.headers.set(header, value);
    return response;
  }
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!username || !passwordHash) return new NextResponse("Admin access is disabled until credentials are configured.", { status: 503 });
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const suppliedUser = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (separator > 0 && suppliedUser === username && await bcrypt.compare(password, passwordHash)) return NextResponse.next();
    } catch { /* malformed credentials */ }
  }
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Authorization" };
  if (!isBackgroundNavigation(request)) headers["WWW-Authenticate"] = 'Basic realm="SWG Archive Admin", charset="UTF-8"';
  return new NextResponse("Authentication required", { status: 401, headers });
}

export const config = { matcher: ["/admin/:path*", "/api/:path*"] };
