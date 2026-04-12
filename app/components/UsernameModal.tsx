"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, RotateCcw } from "lucide-react";

interface Props {
  open: boolean;
  onSubmit: (username: string) => Promise<void>;
}

export default function UsernameModal({ open, onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!username.trim()) return;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      setError("3–20 chars, letters, numbers and underscores only");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onSubmit(username.trim());
    } catch (e: any) {
      setError(e.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
        >
          <motion.div
            initial={{ scale: 0.9, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 16 }}
            className="w-full max-w-sm rounded-3xl border border-amber-500/25 p-8 space-y-6 text-center"
            style={{
              background: "linear-gradient(135deg,#0f0800,#0a0a0f)",
              boxShadow: "0 0 80px -20px rgba(217,119,6,0.35)",
              fontFamily: "'Courier New',Courier,monospace",
            }}
          >
            <div
              className="text-5xl mx-auto w-fit"
              style={{ filter: "drop-shadow(0 0 20px rgba(217,119,6,0.5))" }}
            >
              ♔
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-black text-white tracking-wide">
                What should we call you?
              </h2>
              <p className="text-[11px] text-zinc-500">
                Choose a username
              </p>
            </div>

            <div className="space-y-2 text-left">
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="e.g. chesswizard42"
                maxLength={20}
                className="w-full px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 text-sm outline-none focus:border-amber-500/50 transition-colors"
              />
              {error && (
                <p className="text-[10px] text-rose-400 px-1">{error}</p>
              )}
              <p className="text-[9px] text-zinc-700 px-1">
                3–20 characters · letters, numbers, underscores
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || username.length < 3}
              className="w-full py-3.5 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg,#d97706,#b45309)",
                color: "#000",
              }}
            >
              {loading
                ? <><RotateCcw size={14} className="animate-spin" /> Creating...</>
                : "Enter the Board"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}