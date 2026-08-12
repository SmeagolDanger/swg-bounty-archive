import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
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
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="SWG Archive Admin", charset="UTF-8"' } });
}

export const config = { matcher: ["/admin/:path*"] };
