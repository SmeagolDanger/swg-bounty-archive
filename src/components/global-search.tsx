"use client";

import { useEffect, useState } from "react";

type Result = { id: string; participant_type: "player" | "guild" | "city"; current_name: string; guild_abbreviation: string | null };

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (response.ok) setResults((await response.json()).results);
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div className="global-search">
    <input value={query} onChange={(event) => { const value=event.target.value; setQuery(value); if(value.trim().length<2)setResults([]); }} placeholder="Search dossiers…" aria-label="Search hunters, guilds, and cities" />
    {results.length > 0 && <div className="search-results">{results.map((result) =>
      <a key={result.id} href={`/${result.participant_type === "player" ? "hunter" : result.participant_type}/${result.id}`} onClick={() => setResults([])}>
        <span>{result.current_name}</span><small>{result.participant_type}{result.guild_abbreviation ? ` · ${result.guild_abbreviation}` : ""}</small>
      </a>)}</div>}
  </div>;
}
