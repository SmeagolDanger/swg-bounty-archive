"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HunterActivityChart({ data }: { data: Array<{ day: string; encounters: number; wins: number; losses: number; credits: number }> }) {
  if (!data.length) return <div className="empty">No hunter-role encounters have been archived for this identity.</div>;
  return <div className="chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
    <defs><linearGradient id="hunterWins" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#83d6aa" stopOpacity={0.38}/><stop offset="1" stopColor="#83d6aa" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid stroke="#223440" strokeDasharray="3 6" vertical={false}/>
    <XAxis dataKey="day" stroke="#526774" tick={{ fontSize: 9 }} tickFormatter={(value) => String(value).slice(5)}/>
    <YAxis stroke="#526774" tick={{ fontSize: 9 }} allowDecimals={false}/>
    <Tooltip contentStyle={{ background: "#0d151e", border: "1px solid #355467", fontSize: 11 }}/>
    <Area type="monotone" dataKey="wins" name="Claims" stroke="#83d6aa" fill="url(#hunterWins)" strokeWidth={2}/>
    <Line type="monotone" dataKey="losses" name="Failed" stroke="#ec7d75" strokeWidth={2}/>
  </ComposedChart></ResponsiveContainer></div>;
}
