"use client";

import { useState, useEffect } from "react";
import { stellar } from "../lib/stellar";
import { FaWallet } from "react-icons/fa";
import { MdLogout } from "react-icons/md";
import { useWallet } from "../contexts/WalletContext";

interface WalletConnectionProps {
  compact?: boolean;
}

export default function WalletConnection({ compact = false }: WalletConnectionProps) {
  const { address, setAddress, walletsKit } = useWallet();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const handleConnect = async () => {
    try {
      setLoading(true);
      await walletsKit.openModal({
        onWalletSelected: async (option: { id: any; }) => {
          walletsKit.setWallet(option.id);
          const { address } = await walletsKit.getAddress();
          setAddress(address);
        },
        onClosed: () => setLoading(false),
      });
    } catch (error: any) {
      console.error("Connection error:", error);
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setAddress(null);
    setLoading(false);
    if (stellar.disconnect) stellar.disconnect();
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ── Compact mode (mobile top bar) ──────────────────────────────
  if (compact) {
    if (!address) {
      return (
        <button
          onClick={handleConnect}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black tracking-widest uppercase transition-all disabled:opacity-40 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #d97706, #b45309)",
            color: "#000",
            boxShadow: "0 0 20px -6px rgba(217,119,6,0.6)",
          }}
        >
          {loading ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-black border-r-transparent" />
          ) : (
            <FaWallet size={12} />
          )}
          <span className="hidden xs:inline">Sign In</span>
        </button>
      );
    }

    return (
      <button
        onClick={handleDisconnect}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black tracking-widest uppercase transition-all active:scale-95"
        style={{
          background: "#1f1216",
          border: "1px solid #9f1239",
          color: "#fda4af",
        }}
      >
        <MdLogout size={12} />
        <span className="hidden xs:inline">Exit</span>
      </button>
    );
  }

  // ── Full mode (desktop sidebar) ────────────────────────────────
  const fullButtonClass =
    "w-full py-3 rounded-2xl font-black tracking-[0.2em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3";

  if (!address) {
    return (
      <div className="flex justify-start hover:cursor-pointer w-full">
        <button
          onClick={handleConnect}
          disabled={loading}
          className={fullButtonClass}
          style={{
            background: "linear-gradient(135deg, #d97706, #b45309)",
            boxShadow: "0 0 40px -10px rgba(217,119,6,0.5)",
            color: "#000",
          }}
        >
          {loading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-r-transparent" />
              Connecting 
            </>
          ) : (
            <>
              <FaWallet size={16} /> Sign In
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {toast && (
        <div className="absolute -top-14 left-0 px-4 py-2 rounded-lg shadow-xl text-[10px] font-black uppercase tracking-widest z-50 whitespace-nowrap bg-zinc-900 text-emerald-400 border border-emerald-500/20">
          {toast.message}
        </div>
      )}
      <div className="flex flex-col gap-2 w-full">
        <button
          onClick={handleDisconnect}
          className={fullButtonClass}
          style={{
            background: "#1f1216",
            border: "1px solid #9f1239",
            color: "#fda4af",
          }}
        >
          <MdLogout size={16} />
          Disconnect
        </button>
      </div>
    </div>
  );
}