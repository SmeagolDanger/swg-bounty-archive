"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Detail routes that belong to each top-level section.
const sectionPrefixes: Record<string, string[]> = {
  "/": ["/encounters"],
  "/hunters": ["/hunter/"],
  "/guilds": ["/guild/"],
};

function isActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  const prefixes = [...(sectionPrefixes[href] ?? []), ...(href === "/" ? [] : [`${href}/`])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export function NavLinks({ links, withArrow = false }: { links: ReadonlyArray<readonly [string, string]>; withArrow?: boolean }) {
  const pathname = usePathname();
  return <>{links.map(([label, href]) =>
    <Link key={href} href={href} aria-current={isActive(href, pathname) ? "page" : undefined}>
      {label}
      {withArrow && <span aria-hidden="true">→</span>}
    </Link>)}</>;
}
