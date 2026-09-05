"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The only interactive piece of the account card; the card itself renders on
// the server.
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="button secondary" type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.refresh(); }
  }}>Sign out</button>;
}
