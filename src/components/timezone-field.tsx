"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const serverTimeZone = () => "UTC";
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Submits the visitor's IANA timezone with date filters so day boundaries match
// the timestamps rendered by LocalDateTime. Without JavaScript it stays UTC.
export function TimezoneField() {
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, serverTimeZone);
  return <input type="hidden" name="tz" value={timeZone} readOnly />;
}
