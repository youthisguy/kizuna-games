"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@/app/contexts/WalletContext";
import {
  ArrowLeft, Trophy, Swords, TrendingUp, TrendingDown,
  Crown, Shield, Zap, Clock, ExternalLink, RotateCcw,
  Star, Target, Flame, ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function callFn(endpoint: string, data: any) {
  const res = await fetch(`${BASE_URL}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
  const result = await res.json();
  if (!result.success) throw new Error(result.error || "failed");
  return result;
}

function formatAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
function stroopsToXlm(n: number) {
  return (n / 10_000_000).toFixed(2);
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACHIEVEMENT_META: Record<string, { label: string; icon: string; color: string }> = {
  first_win:      { label: "First Blood",      icon: "⚔️",  color: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  win_streak_3:   { label: "Hat Trick",        icon: "🔥",  color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  win_streak_5:   { label: "On Fire",          icon: "💥",  color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  win_streak_10:  { label: "Unstoppable",      icon: "👑",  color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
  elo_1500:       { label: "Expert",           icon: "🎯",  color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  elo_1800:       { label: "Master",           icon: "💎",  color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  games_10:       { label: "Veteran",          icon: "🛡️", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  games_50:       { label: "Champion",         icon: "🏆",  color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  games_100:      { label: "Legend",           icon: "⭐",  color: "text-zinc-200 bg-zinc-500/10 border-zinc-500/20" },
};

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const { address: connectedAddress } = useWallet();

  const [user, setUser] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [recentGames, setRecentGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"stats" | "games" | "achievements">("stats");

  const isOwnProfile = connectedAddress && (userId === connectedAddress || userId === user?.id);
  
  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      // Case 1: userId is a Stellar wallet address (G... 56 chars)
      // Case 2: userId is an internal kf_ id
      // Case 3: fallback to connectedAddress
      let walletAddr: string | undefined;
  
      if (userId.startsWith("G") && userId.length === 56) {
        // Direct wallet address in the URL
        walletAddr = userId;
      } else if (userId.startsWith("kf_")) {
        // Internal ID — resolve to wallet address via the lookup
        const lookup = await callFn("check-user", { user_id: userId });
        walletAddr = lookup?.user?.wallet_address;
      } else {
        walletAddr = connectedAddress ?? userId;
      }
  
      if (!walletAddr) throw new Error("Could not resolve wallet address");
  
      const result = await callFn("update-user", {
        action: "get_profile",
        wallet_address: walletAddr,
      });
  
      setUser(result.user);
      setAchievements(result.achievements ?? []);
      setRecentGames(result.recent_games ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId, connectedAddress]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily: "'Courier New',Courier,monospace" }}>
      <div className="flex flex-col items-center gap-4">
        <RotateCcw size={28} className="animate-spin text-amber-500/60" />
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Loading profile</p>
      </div>
    </div>
  );

  if (error || !user) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: "#050508", fontFamily: "'Courier New',Courier,monospace" }}>
      <div className="text-center space-y-4">
        <Crown size={40} className="mx-auto text-zinc-700" />
        <p className="text-zinc-400">Profile not found</p>
        <button onClick={() => router.back()}
          className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-2 mx-auto">
          <ArrowLeft size={14} /> Go back
        </button>
      </div>
    </div>
  );

  const winRate = user.total_games > 0 ? Math.round((user.total_wins / user.total_games) * 100) : 0;
  const netXlm = stroopsToXlm(Math.abs(user.net_profit ?? 0));
  const netPositive = (user.net_profit ?? 0) >= 0;

  return (
    <div className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{ background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily: "'Courier New',Courier,monospace" }}>

      {/* Amber glow */}
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)" }} />

      <div className="relative max-w-3xl mx-auto px-4 py-8 pb-32">

        {/* Back */}
        <button onClick={() => router.back()}
          className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest mb-8">
          <ArrowLeft size={13} /> Back
        </button>

        {/* ── Hero card ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="border border-zinc-800/60 rounded-3xl p-6 mb-6 bg-zinc-900/20 relative overflow-hidden">

          {/* Background pattern */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: "repeating-linear-gradient(45deg, #d97706 0, #d97706 1px, transparent 0, transparent 50%)", backgroundSize: "20px 20px" }} />

          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="w-16 h-16 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center text-3xl shrink-0"
                style={{ boxShadow: "0 0 30px -8px rgba(217,119,6,0.4)" }}>
                ♔
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-wider">{user.username}</h1>
                <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{formatAddress(user.wallet_address)}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 font-black uppercase tracking-wider">
                    ELO {user.elo_rating}
                  </span>
                  {user.peak_elo > user.elo_rating && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 uppercase tracking-wider">
                      Peak {user.peak_elo}
                    </span>
                  )}
                  {user.win_streak >= 3 && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/25 text-orange-400 font-black uppercase tracking-wider">
                      🔥 {user.win_streak} streak
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Net profit badge */}
            <div className={`shrink-0 text-right px-4 py-3 rounded-2xl border ${netPositive ? "border-emerald-500/25 bg-emerald-500/8" : "border-rose-500/25 bg-rose-500/8"}`}>
              <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: netPositive ? "#6ee7b7" : "#fca5a5" }}>Net P&L</p>
              <p className={`text-xl font-black tabular-nums ${netPositive ? "text-emerald-400" : "text-rose-400"}`}>
                {netPositive ? "+" : "-"}{netXlm}
              </p>
              <p className="text-[9px] text-zinc-600 mt-0.5">XLM</p>
            </div>
          </div>

          {/* ELO bar */}
          <div className="mt-5 space-y-1">
            <div className="flex justify-between text-[9px] text-zinc-600 uppercase tracking-widest">
              <span>Rating progress</span>
              <span>{user.elo_rating} / 2000</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min((user.elo_rating / 2000) * 100, 100)}%` }}
                transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
            </div>
          </div>
        </motion.div>

        {/* ── Quick stats row ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Games",    value: user.total_games,  color: "text-zinc-200" },
            { label: "Wins",     value: user.total_wins,   color: "text-emerald-400" },
            { label: "Losses",   value: user.total_losses, color: "text-rose-400" },
            { label: "Win Rate", value: `${winRate}%`,     color: "text-amber-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="border border-zinc-800/50 rounded-2xl p-3 text-center bg-zinc-900/20">
              <p className={`text-xl font-black tabular-nums ${color}`}>{value}</p>
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">{label}</p>
            </div>
          ))}
        </motion.div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 rounded-xl border border-zinc-800 bg-zinc-900/30 mb-6">
          {(["stats", "games", "achievements"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeTab === tab
                  ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}>
              {tab}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ── STATS TAB ── */}
          {activeTab === "stats" && (
            <motion.div key="stats" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-4">

              {/* Financial */}
              <div className="border border-zinc-800/50 rounded-2xl p-5 bg-zinc-900/20 space-y-4">
                <h3 className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <TrendingUp size={11} className="text-amber-400" /> Financial
                </h3>
                <div className="grid grid-cols-2 gap-4 text-[10px]">
                  {[
                    { label: "Total Staked", value: `${stroopsToXlm(user.total_staked ?? 0)} XLM`, color: "text-zinc-200" },
                    { label: "Total Won",    value: `${stroopsToXlm(user.total_won ?? 0)} XLM`,    color: "text-emerald-400" },
                    { label: "Total Lost",   value: `${stroopsToXlm(user.total_lost ?? 0)} XLM`,   color: "text-rose-400" },
                    { label: "Net Profit",   value: `${netPositive ? "+" : "-"}${netXlm} XLM`,     color: netPositive ? "text-emerald-400" : "text-rose-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-zinc-600 uppercase tracking-widest mb-1">{label}</p>
                      <p className={`font-black text-base ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chess stats */}
              <div className="border border-zinc-800/50 rounded-2xl p-5 bg-zinc-900/20 space-y-4">
                <h3 className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Target size={11} className="text-amber-400" /> Chess Stats
                </h3>
                <div className="grid grid-cols-2 gap-4 text-[10px]">
                  {[
                    { label: "Draws",         value: user.total_draws ?? 0 },
                    { label: "Best Streak",   value: user.best_win_streak ?? 0 },
                    { label: "Wins as White", value: user.wins_as_white ?? 0 },
                    { label: "Wins as Black", value: user.wins_as_black ?? 0 },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-zinc-600 uppercase tracking-widest mb-1">{label}</p>
                      <p className="font-black text-base text-zinc-200">{value}</p>
                    </div>
                  ))}
                </div>

                {/* W/D/L bar */}
                {user.total_games > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex text-[9px] justify-between text-zinc-600 uppercase tracking-widest">
                      <span className="text-emerald-400">{user.total_wins}W</span>
                      <span className="text-zinc-500">{user.total_draws}D</span>
                      <span className="text-rose-400">{user.total_losses}L</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden flex">
                      <div className="bg-emerald-500 h-full transition-all"
                        style={{ width: `${(user.total_wins / user.total_games) * 100}%` }} />
                      <div className="bg-zinc-600 h-full transition-all"
                        style={{ width: `${((user.total_draws ?? 0) / user.total_games) * 100}%` }} />
                      <div className="bg-rose-500 h-full transition-all"
                        style={{ width: `${(user.total_losses / user.total_games) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Member since */}
              <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20 text-[10px]">
                <span className="text-zinc-600 uppercase tracking-widest flex items-center gap-2">
                  <Clock size={10} /> Member since
                </span>
                <span className="text-zinc-400">{new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
            </motion.div>
          )}

          {/* ── GAMES TAB ── */}
          {activeTab === "games" && (
            <motion.div key="games" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="space-y-3">
              {recentGames.length === 0 ? (
                <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center">
                  <Crown size={32} className="mx-auto text-zinc-700 mb-3" />
                  <p className="text-zinc-600 text-sm">No games recorded yet</p>
                </div>
              ) : recentGames.map((g: any) => {
                const isWhite = g.white_address === user.wallet_address;
                const won = g.winner_address === user.wallet_address;
                const draw = g.outcome === "Draw";
                const result = draw ? "draw" : won ? "win" : "loss";
                const resultColor = result === "win" ? "text-emerald-400" : result === "loss" ? "text-rose-400" : "text-zinc-500";
                const resultBg = result === "win" ? "bg-emerald-500/10 border-emerald-500/20" : result === "loss" ? "bg-rose-500/10 border-rose-500/20" : "bg-zinc-800/30 border-zinc-700/30";
                const opp = isWhite ? g.black_address : g.white_address;
                return (
                  <div key={g.id} className={`border rounded-2xl p-4 ${resultBg} transition-colors`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`text-xs font-black uppercase px-2 py-1 rounded-lg border ${resultBg} ${resultColor} shrink-0`}>
                          {result}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] text-zinc-300 font-mono truncate">vs {formatAddress(opp ?? "Unknown")}</p>
                          <p className="text-[9px] text-zinc-600 mt-0.5">
                            {isWhite ? "White" : "Black"} · {g.move_count ?? "?"} moves · {g.termination ?? ""}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-black tabular-nums ${won ? "text-emerald-400" : draw ? "text-zinc-500" : "text-rose-400"}`}>
                          {won ? `+${stroopsToXlm(g.winner_payout ?? 0)}` : draw ? "±0" : `-${stroopsToXlm(g.stake_each ?? 0)}`}
                        </p>
                        <p className="text-[9px] text-zinc-600">XLM</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800/40">
                      <p className="text-[9px] text-zinc-700">{timeAgo(g.finished_at)}</p>
                      <button onClick={() => router.push(`/play/${g.escrow_game_id}`)}
                        className="text-[9px] text-zinc-600 hover:text-amber-400 transition-colors flex items-center gap-1 uppercase tracking-widest">
                        View game <ChevronRight size={9} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* ── ACHIEVEMENTS TAB ── */}
          {activeTab === "achievements" && (
            <motion.div key="achievements" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {achievements.length === 0 ? (
                <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center">
                  <Star size={32} className="mx-auto text-zinc-700 mb-3" />
                  <p className="text-zinc-600 text-sm">No achievements yet</p>
                  <p className="text-[10px] text-zinc-700 mt-1">Win games to unlock badges</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {achievements.map((a: any) => {
                    const meta = ACHIEVEMENT_META[a.achievement_type] ?? {
                      label: a.achievement_type, icon: "🏅",
                      color: "text-zinc-400 bg-zinc-800/30 border-zinc-700/30"
                    };
                    return (
                      <motion.div key={a.achievement_type}
                        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                        className={`border rounded-2xl p-4 text-center ${meta.color}`}>
                        <div className="text-3xl mb-2">{meta.icon}</div>
                        <p className="text-[11px] font-black uppercase tracking-wider">{meta.label}</p>
                        <p className="text-[9px] opacity-60 mt-1">{timeAgo(a.achieved_at)}</p>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}