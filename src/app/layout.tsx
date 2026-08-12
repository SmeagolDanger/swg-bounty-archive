import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalSearch } from "@/components/global-search";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Outer Rim Ledger", template: "%s · Outer Rim Ledger" },
  description: "An independent, lossless historical archive of public SWG Legends Bounty Hunter activity.",
};

const nav = [["Network", "/"], ["Hunters", "/hunters"], ["Rivalries", "/rivalries"], ["Guilds", "/guilds"], ["Encounters", "/encounters"], ["Leaderboards", "/leaderboards"], ["Raw data", "/raw-data"], ["Compare", "/compare"]] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="scanlines" aria-hidden="true" />
        <header className="site-header">
          <div className="shell nav-shell">
            <Link href="/" className="brand" aria-label="Outer Rim Ledger home">
              <span className="brand-mark">OR</span>
              <span><b>Outer Rim Ledger</b><small>Bounty intelligence archive</small></span>
            </Link>
            <nav aria-label="Primary navigation">{nav.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
            <GlobalSearch />
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="shell footer-grid">
            <div><span className="eyebrow">Independent archive</span><p>Public data originates from SWG Legends. This project is not affiliated with or operated by SWG Legends.</p></div>
            <div className="footer-links"><Link href="/admin/ingestion">Ingestion health</Link><a href="https://swglegends.com/game/leaderboards" rel="noreferrer">Source leaderboards ↗</a></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
