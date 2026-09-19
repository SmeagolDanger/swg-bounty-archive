"use client";

import { useSyncExternalStore } from "react";

export type LocalDateTimeKind = "date" | "dateTime" | "compact";

const subscribe = () => () => undefined;
const serverTimeZone = () => "UTC";
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Date and time halves are formatted separately and joined with a fixed ", ".
// A single combined format lets ICU pick the joiner, and browsers ("Aug 23 at
// 06:07 AM") disagree with Node ("Aug 23, 06:07 AM"), which breaks hydration.
const dateOptions: Record<LocalDateTimeKind, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "short", day: "numeric" },
  dateTime: { year: "numeric", month: "short", day: "numeric" },
  compact: { month: "short", day: "numeric" },
};
const timeOptions: Record<LocalDateTimeKind, Intl.DateTimeFormatOptions | null> = {
  date: null,
  dateTime: { hour: "2-digit", minute: "2-digit", timeZoneName: "short" },
  compact: { hour: "2-digit", minute: "2-digit", timeZoneName: "short" },
};

function instant(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatZonedDateTime(
  value: string | number | Date,
  kind: LocalDateTimeKind,
  timeZone: string,
): string {
  const date = instant(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  const datePart = new Intl.DateTimeFormat("en-US", { ...dateOptions[kind], timeZone }).format(date);
  const time = timeOptions[kind];
  return time ? `${datePart}, ${new Intl.DateTimeFormat("en-US", { ...time, timeZone }).format(date)}` : datePart;
}

export function LocalDateTime({
  value,
  kind = "dateTime",
  className,
}: {
  value: string | number | Date;
  kind?: LocalDateTimeKind;
  className?: string;
}) {
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, serverTimeZone);
  const date = instant(value);
  const iso = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  const display = formatZonedDateTime(value, kind, timeZone);

  return <time className={className} dateTime={iso} title={`Displayed in ${timeZone}`}>{display}</time>;
}
