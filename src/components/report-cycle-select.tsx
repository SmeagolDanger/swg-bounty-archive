"use client";

import { usePathname, useRouter } from "next/navigation";

interface CycleOption {
  startsAt: string;
  endsAt: string;
}

const date = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(value));

export function ReportCycleSelect({ cycles, selected }: { cycles: CycleOption[]; selected: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return <label className="report-cycle-picker">
    <span>Cycle week</span>
    <select
      value={selected}
      onChange={(event) => router.push(`${pathname}?cycle=${encodeURIComponent(event.target.value)}`)}
      aria-label="Select archived cycle week"
    >
      {cycles.map((cycle, index) => <option value={cycle.startsAt} key={cycle.startsAt}>
        {index === 0 ? "Current · " : ""}{date(cycle.startsAt)} — {date(cycle.endsAt)}
      </option>)}
    </select>
  </label>;
}
