"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw } from "lucide-react";

interface Props {
  open: boolean;
  onSubmit: (username: string) => Promise<void>;
}

export default function UsernameModal({ open, onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "");
    setUsername(sanitized);
    setError("");
  };

  const handleSubmit = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;

    if (trimmed.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    if (!/^[a-zA-Z]/.test(trimmed)) {
      setError("Username must start with a letter");
      return;
    }
    // No consecutive underscores (e.g. "chess__wiz")
    if (/__/.test(trimmed)) {
      setError("No consecutive underscores allowed");
      return;
    }

    // No trailing underscore (e.g. "chesswiz_")
    if (/[_]$/.test(trimmed)) {
      setError("Username can't end with an underscore");
      return;
    }

    setError("");
    setLoading(true);
    try {
      await onSubmit(trimmed);
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
              <p className="text-[11px] text-zinc-500">Choose a username</p>
            </div>

            <div className="space-y-2 text-left">
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={handleChange}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="e.g. chesswizard42"
                  maxLength={20}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 text-sm outline-none focus:border-amber-500/50 transition-colors pr-16"
                />
                {/* Live character counter */}
                <span
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums transition-colors ${
                    username.length >= 18
                      ? "text-rose-400"
                      : username.length >= 3
                      ? "text-amber-500/60"
                      : "text-zinc-700"
                  }`}
                >
                  {username.length}/20
                </span>
              </div>

              {error && (
                <p className="text-[10px] text-rose-400 px-1">{error}</p>
              )}

              <p className="text-[9px] text-zinc-700 px-1">
                3–20 chars · letters, numbers, underscores · must start with a letter
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
              {loading ? (
                <>
                  <RotateCcw size={14} className="animate-spin" /> Saving
                </>
              ) : (
                "Enter the Board"
              )}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}