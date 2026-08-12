"use client";

import { useSyncExternalStore } from "react";

export type LocalDateTimeKind = "date" | "dateTime" | "compact";

const subscribe = () => () => undefined;
const serverTimeZone = () => "UTC";
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const options: Record<LocalDateTimeKind, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "short", day: "numeric" },
  dateTime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  },
  compact: {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  },
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
  return new Intl.DateTimeFormat("en-US", { ...options[kind], timeZone }).format(date);
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
