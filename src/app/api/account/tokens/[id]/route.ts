import { z } from "zod";
import { pool } from "@/lib/db/client";
import { authedUser } from "@/lib/auth/session";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authedUser(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid token id" }, { status: 400 });
  await pool.query(
    "UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
    [id.data, user.id],
  );
  return Response.json({ ok: true });
}
