// app/page.tsx
"use client";

import { useState, useEffect } from 'react';

export default function Home() {
  const [stories, setStories] = useState<any[]>([]);
  const [ticker, setTicker] = useState("Scanning X for breaking news...");

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/scan-x');
        const data = await res.json();
        if (data.newStories?.length > 0) {
          setStories(prev => [...data.newStories, ...prev].slice(0, 10));
          setTicker(data.newStories[0]?.title || ticker);
        }
      } catch (e) {
        console.error("Scan error:", e);
      }
    }, 20000); // 20s poll

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <h1 className="text-5xl font-bold mb-8">VeraNews • @veranewsco</h1>
      <div className="bg-red-600 p-4 mb-8 animate-pulse">{ticker}</div>
      <div className="grid gap-6">
        {stories.map((s, i) => (
          <div key={i} className="bg-zinc-900 p-6 rounded-xl border border-emerald-800">
            <h2 className="text-2xl font-semibold mb-2">{s.title}</h2>
            <p className="text-zinc-300 mb-4">{s.summary}</p>
            <div className="text-sm text-emerald-400">Posted to @veranewsco • Score: {s.veraScore}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}