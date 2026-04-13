"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/app/contexts/WalletContext";
import { RotateCcw } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function SidebarProfile() {
  const { address } = useWallet();
  const router = useRouter();
  const [user, setUser] = useState<{
    username: string;
    elo_rating: number;
    wallet_address: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = useCallback(() => {
    if (!address) { setUser(null); return; }
    setLoading(true);
    fetch(`${BASE_URL}/functions/v1/check-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wallet_address: address }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.success && d.user_exists) setUser(d.user); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  // Fetch on mount / address change
  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // Re-fetch whenever a username is created anywhere in the app
  useEffect(() => {
    window.addEventListener("profile:created", fetchProfile);
    return () => window.removeEventListener("profile:created", fetchProfile);
  }, [fetchProfile]);

  if (!address) return null;

  if (loading) return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-zinc-800/50 bg-zinc-900/20">
      <RotateCcw size={12} className="animate-spin text-zinc-600" />
      <span className="text-[10px] text-zinc-600">Loading profile...</span>
    </div>
  );

  if (!user) return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10">
      <div className="w-7 h-7 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-sm shrink-0">♟</div>
      <div className="min-w-0">
        <p className="text-[10px] text-zinc-500 truncate font-mono">{address.slice(0, 8)}...</p>
        <p className="text-[9px] text-zinc-700">No profile yet</p>
      </div>
    </div>
  );

  return (
    <button
      onClick={() => router.push(`/profile/${user.wallet_address}`)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800/50 bg-zinc-900/20 hover:bg-amber-500/5 hover:border-amber-500/20 transition-all duration-200 group text-left"
    >
      <div className="w-8 h-8 rounded-xl border border-amber-500/25 bg-amber-500/10 flex items-center justify-center text-base shrink-0 group-hover:border-amber-500/50 transition-colors">
        ♔
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-zinc-300 group-hover:text-amber-400 transition-colors truncate tracking-wide">
          {user.username}
        </p>
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest">
          ELO {user.elo_rating}
        </p>
      </div>
      <span className="text-zinc-700 group-hover:text-amber-500 transition-colors text-xs shrink-0">→</span>
    </button>
  );
}