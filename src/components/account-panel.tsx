"use client";

import { useEffect, useState } from "react";

interface ApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export function AccountPanel({ username, avatar }: { username: string; avatar: string | null }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/account/tokens");
    if (response.ok) setTokens((await response.json()).tokens);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/account/tokens");
      if (!cancelled && response.ok) setTokens((await response.json()).tokens);
    })();
    return () => { cancelled = true; };
  }, []);

  async function createToken() {
    const name = newTokenName.trim() || "Mail companion";
    setBusy(true);
    try {
      const response = await fetch("/api/account/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        const created = await response.json();
        setFreshToken(created.token);
        setNewTokenName("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/account/tokens/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/account";
  }

  return <>
    <div className="panel account-identity">
      <div className="panel-header"><h3>Signed in via Discord</h3><span className="chip">180-day session</span></div>
      <div className="account-user">
        {avatar && <img src={avatar} alt="" width={44} height={44} />}
        <b>{username}</b>
        <button className="button secondary" type="button" onClick={signOut}>Sign out</button>
      </div>
    </div>

    <div className="panel">
      <div className="panel-header"><h3>Mail companion tokens</h3><span className="chip">Shown once</span></div>
      <p className="account-hint">Create a token, paste it into the Jawa Tracks mail companion on your gaming PC, and your in-game sale mails upload automatically. Revoke a token any time to cut that machine off.</p>
      {freshToken && <div className="notice account-fresh-token">
        <b>Copy this token now — it will not be shown again.</b>
        <code>{freshToken}</code>
      </div>}
      <div className="account-token-create">
        <input className="field" placeholder="Token name (e.g. Gaming PC)" value={newTokenName} maxLength={60}
          onChange={(event) => setNewTokenName(event.target.value)} />
        <button className="button" type="button" disabled={busy} onClick={createToken}>Create token</button>
      </div>
      {tokens.length > 0 && <div className="account-token-list">
        {tokens.map((token) => <div className="account-token" key={token.id}>
          <span><b>{token.name}</b><small>created {new Date(token.created_at).toLocaleDateString()}{token.last_used_at ? ` · last used ${new Date(token.last_used_at).toLocaleDateString()}` : " · never used"}</small></span>
          <button className="button secondary" type="button" onClick={() => revoke(token.id)}>Revoke</button>
        </div>)}
      </div>}
    </div>
  </>;
}
