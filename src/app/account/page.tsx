import type { Metadata } from "next";
import { authedUser } from "@/lib/auth/session";
import { discordConfigured } from "@/lib/auth/discord";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const user = await authedUser();

  return <div className="shell">
    <header className="page-head">
      <span className="eyebrow">{"Jawa Tracks // Account"}</span>
      <h1>Account</h1>
      <p>One Discord sign-in connects the Jawa Tracks app on your devices. The public archive never requires an account.</p>
    </header>

    <section className="section"><div className="account-grid">
      {user ? <div className="panel account-identity">
        <div className="panel-header"><h3>Signed in via Discord</h3><span className="chip">180-day session</span></div>
        <div className="account-user">
          {/* Discord CDN avatar; a one-off 44px image doesn't warrant next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {user.discordAvatar && <img src={user.discordAvatar} alt="" width={44} height={44} />}
          <b>{user.discordUsername}</b>
          <SignOutButton/>
        </div>
      </div> : <div className="panel">
        <div className="panel-header"><h3>Sign in</h3></div>
        {typeof query.error === "string" && <div className="notice">Sign-in didn&apos;t complete — try again.</div>}
        {discordConfigured()
          ? <a className="button account-signin" href="/api/auth/discord/start?client=web">Sign in with Discord</a>
          : <p className="account-hint">Discord sign-in is not configured on this server yet.</p>}
        <p className="account-hint">Signing in enables loadout &amp; component sync in the app. You stay signed in for 180 days of activity.</p>
      </div>}
    </div></section>
  </div>;
}
