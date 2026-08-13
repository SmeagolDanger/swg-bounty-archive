"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

function ClosedOnNavigation({ menu }: { menu: React.RefObject<HTMLDetailsElement | null> }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const route = `${pathname}?${search}`;
  useEffect(() => { menu.current?.removeAttribute("open"); }, [route, menu]);
  return null;
}

export function MobileNavigation({ children }: { children: React.ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Client-side navigations keep the layout mounted, so the menu must close itself:
  // immediately when a link inside is activated, and on any route change as a fallback.
  const closeOnLink = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("a")) menu.current?.removeAttribute("open");
  };
  return <details ref={menu} className="mobile-navigation" onClick={closeOnLink}>
    <Suspense fallback={null}><ClosedOnNavigation menu={menu} /></Suspense>
    {children}
  </details>;
}
