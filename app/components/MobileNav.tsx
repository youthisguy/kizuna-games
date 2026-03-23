"use client";

import { useState, useEffect } from "react";
import Link, { LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { Crown, X, Menu } from "lucide-react";
import WalletConnection from "./WalletConnection";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface MobileNavProps {
  navItems: NavItem[];
}

export default function MobileNav({ navItems }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* ── Mobile top bar ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 gap-3 bg-[#040407]/95 backdrop-blur-xl border-b border-zinc-800/50">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-all duration-150 shrink-0"
        >
          <Menu size={20} />
        </button>

        <Link href="/" className="flex items-center gap-2">
          <Crown
            size={20}
            className="text-amber-400"
            style={{ filter: "drop-shadow(0 0 6px #d97706)" }}
          />
          <span className="text-lg font-bold tracking-[0.2em] text-white uppercase">
            King<span className="text-amber-400">Fall</span>
          </span>
        </Link>

        <div className="ml-auto">
  <WalletConnection compact />
</div>
      </header>

      {/* ── Backdrop ── */}
      <div
        onClick={() => setOpen(false)}
        className={`md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* ── Slide-in drawer ── */}
      <nav
        className={`md:hidden fixed top-0 left-0 h-screen w-[72vw] max-w-[280px] z-[70] flex flex-col bg-[#040407] border-r border-zinc-800/60 transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Mobile navigation"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-2">
            <Crown
              size={22}
              className="text-amber-400"
              style={{ filter: "drop-shadow(0 0 8px #d97706)" }}
            />
            <span className="text-xl font-bold tracking-[0.2em] text-white uppercase">
              King<span className="text-amber-400">Fall</span>
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/60 transition-all duration-150"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav links */}
        <div className="flex-1 px-3 pt-4 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-200 ${
                  isActive
                    ? "text-emerald-400 bg-emerald-500/8 border-emerald-500/20"
                    : "text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/5 border-transparent hover:border-emerald-500/10"
                }`}
              >
                <span
                  className={`transition-colors duration-200 ${
                    isActive
                      ? "text-emerald-400"
                      : "text-zinc-500 group-hover:text-emerald-400"
                  }`}
                >
                  {item.icon}
                </span>
                <span className="font-semibold text-sm tracking-wide font-mono uppercase">
                  {item.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-emerald-500 text-xs">→</span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="px-4 py-5 border-t border-zinc-800/50 shrink-0">
          <WalletConnection />
        </div>
      </nav>
      {/* 
      <div className="md:hidden h-14 w-full shrink-0" aria-hidden="true" /> */}
    </>
  );
}
