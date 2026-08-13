import type { Metadata } from "next";
import type { Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalSearch } from "@/components/global-search";
import { MobileNavigation } from "@/components/mobile-nav";
import { NavLinks } from "@/components/nav-links";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Outer Rim Ledger", template: "%s · Outer Rim Ledger" },
  description: "An independent, lossless historical archive of public SWG Legends Bounty Hunter activity.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#06090d" };

const nav = [["Encounters", "/"], ["Hunters", "/hunters"], ["Guilds", "/guilds"], ["Raw data", "/raw-data"], ["Compare", "/compare"]] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div className="scanlines" aria-hidden="true" />
        <header className="site-header">
          <div className="shell nav-shell">
            <Link href="/" className="brand" aria-label="Outer Rim Ledger home">
              <span className="brand-mark">OR</span>
              <span><b>Outer Rim Ledger</b><small>Bounty intelligence archive</small></span>
            </Link>
            <nav className="desktop-nav" aria-label="Primary navigation"><NavLinks links={nav} /></nav>
            <div className="desktop-search"><GlobalSearch /></div>
            <MobileNavigation>
              <summary><span className="menu-icon" aria-hidden="true"><i/><i/><i/></span><span>Menu</span></summary>
              <div className="mobile-menu">
                <GlobalSearch />
                <nav aria-label="Mobile navigation"><NavLinks links={nav} withArrow /></nav>
              </div>
            </MobileNavigation>
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <div className="shell footer-grid">
            <div><span className="eyebrow">Independent archive</span><p>Public data originates from SWG Legends. This project is not affiliated with or operated by SWG Legends.</p></div>
            <div className="footer-links"><a href="/admin/ingestion">Ingestion health</a><a href="https://swglegends.com/game/leaderboards" rel="noreferrer">Source leaderboards ↗</a></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
