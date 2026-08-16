"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALL_BOARD_LABELS } from "@/lib/constants";
import { contemporaneousLeaderboardRows } from "@/lib/leaderboard-history";

const colors: Record<string,string> = { BOUNTY_HUNTER_GROUND_VALUE:"#73d7dd",BOUNTY_HUNTER_SPACE_VALUE:"#8da8f5",BOUNTY_HUNTER_UNIQUE_KILLS:"#83d6aa",BOUNTY_HUNTER_TOTAL_KILLS:"#e5b25b",GCW_IMPERIAL:"#e06666",GCW_REBEL:"#e69138" };
const localDay = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
export function HistoryChart({ rows }: { rows: Array<Record<string,unknown>> }) {
  const contemporaneousRows = contemporaneousLeaderboardRows(rows);
  const byDate=new Map<string,Record<string,unknown>>(); for(const row of [...contemporaneousRows].reverse()){const date=localDay(row.source_fetched_at as string);const item=byDate.get(date)??{date};item[row.leaderboard_id as string]=Number(row.rank);byDate.set(date,item);}
  const data=[...byDate.values()]; if(data.length<2)return <div className="empty">More observations are needed for a history chart.</div>;
  return <div className="chart"><ResponsiveContainer><LineChart data={data} margin={{top:10,right:8,bottom:0,left:-22}}><CartesianGrid stroke="#223440" strokeDasharray="3 6"/><XAxis dataKey="date" tick={{fontSize:9}} stroke="#526774"/><YAxis reversed allowDecimals={false} tick={{fontSize:9}} stroke="#526774"/><Tooltip contentStyle={{background:"#0d151e",border:"1px solid #355467",fontSize:11}}/><Legend wrapperStyle={{fontSize:9}}/>{Object.entries(ALL_BOARD_LABELS).map(([id,label])=><Line key={id} connectNulls type="monotone" dataKey={id} name={label} stroke={colors[id]} dot={false}/>)}</LineChart></ResponsiveContainer></div>;
}
