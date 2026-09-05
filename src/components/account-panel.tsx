"use client";

export function AccountPanel({ username, avatar }: { username: string; avatar: string | null }) {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/account";
  }

  return <div className="panel account-identity">
    <div className="panel-header"><h3>Signed in via Discord</h3><span className="chip">180-day session</span></div>
    <div className="account-user">
      {/* Discord CDN avatar; a one-off 44px image doesn't warrant next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {avatar && <img src={avatar} alt="" width={44} height={44} />}
      <b>{username}</b>
      <button className="button secondary" type="button" onClick={signOut}>Sign out</button>
    </div>
  </div>;
}
