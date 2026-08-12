"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ActivityChart({ data }: { data: { day: string; encounters: number; kills: number }[] }) {
  if (!data.length) return <div className="empty">No archived time series yet.</div>;
  return <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
    <defs><linearGradient id="activity" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#73d7dd" stopOpacity={0.4}/><stop offset="1" stopColor="#73d7dd" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid stroke="#223440" strokeDasharray="3 6" vertical={false}/><XAxis dataKey="day" stroke="#526774" tick={{ fontSize: 9 }} tickFormatter={(value) => value.slice(5)}/><YAxis stroke="#526774" tick={{ fontSize: 9 }}/>
    <Tooltip contentStyle={{ background: "#0d151e", border: "1px solid #355467", fontSize: 11 }} /><Area type="monotone" dataKey="encounters" stroke="#73d7dd" fill="url(#activity)" strokeWidth={2}/><Area type="monotone" dataKey="kills" stroke="#e5b25b" fill="transparent" strokeWidth={1}/>
  </AreaChart></ResponsiveContainer></div>;
}
