"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/app/contexts/WalletContext";
 
export interface KFUser {
  id: string;
  wallet_address: string;
  username: string;
  elo_rating: number;
  peak_elo: number;
  total_games: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
  win_streak: number;
  best_win_streak: number;
  wins_as_white: number;
  wins_as_black: number;
  total_staked: number;
  total_won: number;
  total_lost: number;
  net_profit: number;
  is_active: boolean;
  created_at: string;
  last_seen: string;
}

export interface KFGameRecord {
  id: string;
  escrow_game_id: number;
  white_address: string;
  black_address: string;
  winner_address: string | null;
  outcome: "WhiteWins" | "BlackWins" | "Draw";
  stake_each: number;
  pot_total: number;
  winner_payout: number | null;
  move_count: number;
  termination: string;
  finished_at: string;
}

 
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
  if (!result.success) throw new Error(result.error || `${endpoint} failed`);
  return result;
}

 
interface AuthState {
  user: KFUser | null;
  isLoading: boolean;
  isNewUser: boolean;
  showUsernameModal: boolean;
  error: string | null;
}

export function useKingFallAuth() {
  const { address } = useWallet();

  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: false,
    isNewUser: false,
    showUsernameModal: false,
    error: null,
  });

 
  const checkUser = useCallback(async (walletAddress: string) => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const result = await callFn("check-user", { wallet_address: walletAddress });
      if (result.user_exists) {
        setState(s => ({
          ...s,
          user: result.user,
          isLoading: false,
          isNewUser: false,
          showUsernameModal: false,
        }));
      } else {
        setState(s => ({
          ...s,
          user: null,
          isLoading: false,
          isNewUser: true,
          showUsernameModal: true,
        }));
      }
    } catch (e: any) {
      setState(s => ({ ...s, isLoading: false, error: e.message }));
    }
  }, []);

  // Trigger on wallet connect/disconnect
  useEffect(() => {
    if (address) {
      checkUser(address);
    } else {
      setState({ user: null, isLoading: false, isNewUser: false, showUsernameModal: false, error: null });
    }
  }, [address, checkUser]);
 
  const registerUser = async (username: string) => {
    if (!address) throw new Error("Wallet not connected");
    const result = await callFn("register-user", { wallet_address: address, username });
    setState(s => ({ ...s, user: result.user, isNewUser: false, showUsernameModal: false }));
    return result.user as KFUser;
  };
 
  const updateUsername = async (newUsername: string) => {
    if (!address) throw new Error("Wallet not connected");
    const result = await callFn("update-user", {
      action: "update_username",
      wallet_address: address,
      new_username: newUsername,
    });
    setState(s => ({ ...s, user: result.user }));
    return result.user as KFUser;
  };

  // ── Refresh user from DB (call after game ends or new game created)  
  const refreshUser = useCallback(async () => {
    if (!address) return;
    try {
      const result = await callFn("check-user", { wallet_address: address });
      if (result.user_exists) {
        setState(s => ({ ...s, user: result.user }));
      }
    } catch (e) {
      console.warn("[refreshUser]", e);
    }
  }, [address]);

 
  const recordGameResult = async (params: {
    escrow_game_id: number;
    game_contract_id?: number;
    white_address: string;
    black_address: string;
    outcome: "WhiteWins" | "BlackWins" | "Draw";
    stake_each: number;
    tx_hash_finish?: string;
    move_count?: number;
    pgn?: string;
    termination?: "Checkmate" | "Resignation" | "Stalemate" | "Draw";
    network?: string;
  }) => {
    const result = await callFn("game-result", params);

    // Immediately refresh local user state so sidebar ELO updates
    if (address && (params.white_address === address || params.black_address === address)) {
      await refreshUser();
    }

    return result;
  };

 
  const getProfile = async (walletAddress?: string) => {
    const addr = walletAddress ?? address;
    if (!addr) throw new Error("No address");
    const result = await callFn("update-user", {
      action: "get_profile",
      wallet_address: addr,
    });
    return result as { user: KFUser; achievements: any[]; recent_games: KFGameRecord[] };
  };

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  const getLeaderboard = async (
    sortBy: "elo_rating" | "net_profit" | "total_wins" | "total_games" = "elo_rating",
    limit = 50
  ) => {
    const result = await callFn("leaderboard", {
      sort_by: sortBy,
      limit,
      wallet_address: address,
    });
    return result as {
      leaderboard: (KFUser & { rank: number; win_rate: number })[];
      my_rank: any;
    };
  };

  const closeUsernameModal = () =>
    setState(s => ({ ...s, showUsernameModal: false }));

  return {
    // State
    user:               state.user,
    isLoading:          state.isLoading,
    isNewUser:          state.isNewUser,
    showUsernameModal:  state.showUsernameModal,
    error:              state.error,
    isAuthenticated:    !!state.user,

    // Actions
    registerUser,
    updateUsername,
    getProfile,
    recordGameResult,
    getLeaderboard,
    refreshUser,
    closeUsernameModal,
  };
}