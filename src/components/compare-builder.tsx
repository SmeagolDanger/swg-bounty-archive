"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Result = { id: string; participant_type: string; current_name: string };

export function CompareBuilder({ initialIds }: { initialIds: string[] }) {
  const router=useRouter(); const [query,setQuery] = useState(""); const [results,setResults] = useState<Result[]>([]); const ids=initialIds;
  useEffect(() => { if (query.trim().length<2)return; const controller=new AbortController(); const timer=setTimeout(async()=>{try{const response=await fetch(`/api/search?q=${encodeURIComponent(query)}`,{signal:controller.signal});if(response.ok)setResults(((await response.json()).results as Result[]).filter((item)=>item.participant_type==="player"));}catch{/* aborted or offline */}},180);return()=>{clearTimeout(timer);controller.abort();};},[query]);
  const navigate = (next: string[]) => router.push(`/compare?ids=${next.join(",")}`);
  return <div className="panel" style={{marginBottom:20}}><div className="panel-header"><h3>Select 2–5 hunters</h3><span className="chip">{ids.length}/5 selected</span></div><div className="global-search"><input value={query} onChange={(event)=>{const value=event.target.value;setQuery(value);if(value.length<2)setResults([]);}} placeholder="Find a hunter to compare…"/>{results.length>0&&<div className="search-results">{results.filter((r)=>!ids.includes(r.id)).map((result)=><button key={result.id} type="button" onClick={()=>navigate([...ids,result.id].slice(0,5))} style={{display:"block",width:"100%",textAlign:"left",padding:12,background:"none",border:0,borderBottom:"1px solid var(--line)",cursor:"pointer"}}>{result.current_name}</button>)}</div>}</div>{ids.length>0&&<button className="button secondary" style={{marginTop:12}} onClick={()=>navigate([])}>Clear selection</button>}</div>;
}
