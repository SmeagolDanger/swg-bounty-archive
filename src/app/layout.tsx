import type { Metadata } from "next";
import type { Viewport } from "next";
import Link from "next/link";
import { Exo_2, JetBrains_Mono, Rajdhani } from "next/font/google";
import { GlobalSearch } from "@/components/global-search";
import { MobileNavigation } from "@/components/mobile-nav";
import { NavLinks } from "@/components/nav-links";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const display = Rajdhani({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const sans = Exo_2({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Jawa Tracks", template: "%s · Jawa Tracks" },
  description: "Jawa Tracks — the Outer Rim Ledger archive, pilot tools, and sales tracking for SWG Legends.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#070810" };

const nav = [["Encounters", "/"], ["Hunters", "/hunters"], ["Guilds", "/guilds"], ["Reports", "/reports/weekly"], ["Raw data", "/raw-data"], ["Compare", "/compare"]] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div className="scanlines" aria-hidden="true" />
        <header className="site-header">
          <div className="shell nav-shell">
            <Link href="/" className="brand" aria-label="Jawa Tracks home">
              <span className="brand-mark">JT</span>
              <span><b>Jawa Tracks</b><small>Outer Rim Ledger // public archive</small></span>
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
            <div className="footer-links"><a href="/api-docs">Public API</a><a href="/admin/ingestion">Ingestion health</a><a href="https://swglegends.com/game/leaderboards" rel="noreferrer">Source leaderboards ↗</a></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
