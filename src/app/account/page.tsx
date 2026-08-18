import type { Metadata } from "next";
import { authedUser } from "@/lib/auth/session";
import { discordConfigured } from "@/lib/auth/discord";
import { AccountPanel } from "@/components/account-panel";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const user = await authedUser();

  return <div className="shell">
    <header className="page-head">
      <span className="eyebrow">{"Jawa Tracks // Account"}</span>
      <h1>Account</h1>
      <p>One Discord sign-in connects the Jawa Tracks app on your devices and the mail companion on your gaming PC. The public archive never requires an account.</p>
    </header>

    <section className="section"><div className="account-grid">
      {user ? <AccountPanel username={user.discordUsername} avatar={user.discordAvatar}/> : <div className="panel">
        <div className="panel-header"><h3>Sign in</h3></div>
        {typeof query.error === "string" && <div className="notice">Sign-in didn&apos;t complete — try again.</div>}
        {discordConfigured()
          ? <a className="button account-signin" href="/api/auth/discord/start?client=web">Sign in with Discord</a>
          : <p className="account-hint">Discord sign-in is not configured on this server yet.</p>}
        <p className="account-hint">Signing in enables loadout &amp; component sync in the app and sales tracking from the mail companion. You stay signed in for 180 days of activity.</p>
      </div>}
    </div></section>
  </div>;
}
