"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Trophy, Coins, TrendingUp,
  Activity, BarChart3, RefreshCw, ArrowLeft, Terminal, ShieldCheck
} from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface Metrics {
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  totalGames: number;
  gamesThisWeek: number;
  outcomeCounts: { WhiteWins: number; BlackWins: number; Draw: number };
  totalStaked: number;
  topUsers: { username: string; wallet_address: string; elo_rating: number; total_games: number; total_wins: number }[];
  dailyGames: { finished_at: string }[];
  newUserData: { created_at: string }[];
}

// --- Terminal Animation Component ---
function CodeActivityLog({ metrics }: { metrics: Metrics | null }) {
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!metrics) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const newEntries = [
      `[${timestamp}] HANDSHAKE: Connection established with KingFall DB.`,
      `[${timestamp}] TARGET: Table 'games_record' synchronized successfully.`,
      `[${timestamp}] SYNC: ${metrics.totalGames} total sessions parsed.`,
      `[${timestamp}] NETWORK: Staking pool at ${((metrics.totalStaked ?? 0) / 10_000_000 * 2).toFixed(2)} XLM.`,
    ];

    setLogs((prev) => [...prev, ...newEntries].slice(-15));
  }, [metrics]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="border border-zinc-800 rounded-2xl bg-black/40 p-4 font-mono text-[10px] h-36 overflow-hidden relative mb-6">
      <div className="absolute top-2 right-4 flex items-center gap-2">
        <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
        <span className="text-zinc-600 text-[8px] uppercase tracking-tighter">Live_Feed_Active</span>
      </div>
      <div ref={scrollRef} className="h-full overflow-y-auto space-y-1 text-zinc-500 scrollbar-hide">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-amber-500/40">SYS{">"}</span>
            <span className={i >= logs.length - 3 ? "text-zinc-300" : ""}>{log}</span>
          </div>
        ))}
        <div className="animate-pulse">_</div>
      </div>
    </div>
  );
}

function groupByDay(data: { finished_at?: string; created_at?: string }[], field: "finished_at" | "created_at") {
  const counts: Record<string, number> = {};
  data?.forEach((d) => {
    const day = d[field]?.slice(0, 10);
    if (day) counts[day] = (counts[day] || 0) + 1;
  });
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: counts[key] || 0 };
  });
}

function MiniBarChart({ data, color }: { data: { date: string; count: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-16 mt-3">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full rounded-sm transition-all duration-500"
            style={{
              height: `${Math.max(4, (d.count / max) * 56)}px`,
              background: color,
              opacity: d.count === 0 ? 0.2 : 1,
            }}
          />
          <div className="absolute bottom-full mb-1 hidden group-hover:block bg-zinc-800 text-zinc-200 text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
            {d.date.slice(5)}: {d.count}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MetricsDashboard() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/functions/v1/get-metrics`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setMetrics(data.metrics);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error("[metrics_sync_failed]", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);  
    return () => clearInterval(interval);
  }, []);

  const dailyGameData = metrics ? groupByDay(metrics.dailyGames, "finished_at") : [];
  const dailyUserData = metrics ? groupByDay(metrics.newUserData, "created_at") : [];
  const totalOutcomes = metrics
    ? metrics.outcomeCounts.WhiteWins + metrics.outcomeCounts.BlackWins + metrics.outcomeCounts.Draw
    : 1;

  return (
    <div className="min-h-screen text-zinc-200 bg-[#050508] selection:bg-amber-500/30" style={{ 
      background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)",
      fontFamily: "'Courier New', Courier, monospace"
    }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/play")} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13} /> Back
            </button>
            <div>
              <h1 className="text-xl font-black text-white tracking-wider">
                ♚ KingFall <span className="text-amber-400">Metrics</span>
              </h1>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                SRC: games_record • {lastUpdated ? `LAST_SYNC: ${lastUpdated.toLocaleTimeString()}` : "INITIALIZING..."}
              </p>
            </div>
          </div>
          <button onClick={fetchMetrics} disabled={loading} className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-900/50">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {loading ? "SYNCING" : "REFRESH"}
          </button>
        </div>

        {loading && !metrics ? (
          <div className="flex flex-col items-center justify-center py-40 gap-4">
            <Terminal size={32} className="text-amber-500/50 animate-pulse" />
            <p className="text-[10px] font-mono text-zinc-600 animate-pulse tracking-widest">ESTABLISHING_ENCRYPTED_LINK...</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Terminal Animation Feed */}
            <CodeActivityLog metrics={metrics} />

            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "DAU", value: metrics?.dau ?? 0, sub: "Today", icon: Activity, color: "#f59e0b" },
                { label: "WAU", value: metrics?.wau ?? 0, sub: "Weekly", icon: TrendingUp, color: "#10b981" },
                { label: "MAU", value: metrics?.mau ?? 0, sub: "Monthly", icon: Users, color: "#6366f1" },
                { label: "Users", value: metrics?.totalUsers ?? 0, sub: "All time", icon: Users, color: "#ec4899" },
              ].map(({ label, value, sub, icon: Icon, color }) => (
                <div key={label} className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/30 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
                    <Icon size={14} style={{ color }} />
                  </div>
                  <p className="text-3xl font-black" style={{ color }}>{value}</p>
                  <p className="text-[10px] text-zinc-600 mt-1">{sub}</p>
                </div>
              ))}
            </div>

            {/* Financial & Game Volume Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Total Games</span>
                  <Trophy size={14} className="text-amber-500" />
                </div>
                <p className="text-2xl font-black text-white">{metrics?.totalGames ?? 0}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[9px] text-zinc-600">
                    <ShieldCheck size={10} className="text-emerald-500" /> DB_SYNC_VERIFIED
                </div>
              </div>

              <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Games This Week</span>
                  <BarChart3 size={14} className="text-emerald-500" />
                </div>
                <p className="text-2xl font-black text-white">{metrics?.gamesThisWeek ?? 0}</p>
              </div>

              <div className="border rounded-2xl p-4 bg-amber-500/5 border-amber-900/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-amber-500/60 uppercase tracking-widest">Total Staked</span>
                  <Coins size={14} className="text-amber-500" />
                </div>
                <p className="text-2xl font-black text-amber-400">
                  {((metrics?.totalStaked ?? 0) / 10_000_000 * 2).toFixed(2)} <span className="text-xs font-normal">XLM</span>
                </p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-zinc-800 rounded-2xl p-5 bg-zinc-900/30">
                <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Game Traffic (14d)</h3>
                <MiniBarChart data={dailyGameData} color="#f59e0b" />
                <div className="flex justify-between mt-2 font-mono text-[8px] text-zinc-700">
                  <span>{dailyGameData[0]?.date.slice(5)}</span>
                  <span>{dailyGameData[13]?.date.slice(5)}</span>
                </div>
              </div>

              <div className="border border-zinc-800 rounded-2xl p-5 bg-zinc-900/30">
                <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">User Growth (14d)</h3>
                <MiniBarChart data={dailyUserData} color="#6366f1" />
                <div className="flex justify-between mt-2 font-mono text-[8px] text-zinc-700">
                  <span>{dailyUserData[0]?.date.slice(5)}</span>
                  <span>{dailyUserData[13]?.date.slice(5)}</span>
                </div>
              </div>
            </div>

            {/* Lower Grid: Outcomes & Top Players */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-zinc-800 rounded-2xl p-5 bg-zinc-900/30">
                <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4">Outcomes Breakdown</h3>
                <div className="space-y-4">
                  {[
                    { label: "White Wins", count: metrics?.outcomeCounts.WhiteWins ?? 0, color: "#f59e0b" },
                    { label: "Black Wins", count: metrics?.outcomeCounts.BlackWins ?? 0, color: "#6366f1" },
                    { label: "Draws", count: metrics?.outcomeCounts.Draw ?? 0, color: "#6b7280" },
                  ].map(({ label, count, color }) => (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] mb-1.5">
                        <span className="text-zinc-500 font-bold">{label}</span>
                        <span className="text-zinc-300">{totalOutcomes > 0 ? ((count / totalOutcomes) * 100).toFixed(1) : 0}%</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full transition-all duration-1000" style={{ width: `${(count / totalOutcomes) * 100}%`, background: color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-800 rounded-2xl p-5 bg-zinc-900/30">
                <h3 className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4">Leaderboard: Top 5</h3>
                <div className="space-y-3">
                  {metrics?.topUsers?.map((u, i) => (
                    <div key={u.wallet_address} className="flex items-center justify-between text-[11px] p-2 bg-black/20 rounded-lg border border-zinc-800/40">
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600">#{i + 1}</span>
                        <span className="text-zinc-300 font-bold tracking-tight">{u.username}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-amber-500 font-black">{u.elo_rating}</span>
                        <span className="text-zinc-600 text-[9px]">{u.total_wins}W</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}