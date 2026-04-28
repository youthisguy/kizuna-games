"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Menu } from "lucide-react";
import WalletConnection from "./WalletConnection";
import SidebarProfile from "./SidebarProfile";
import Image from "next/image";

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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/Kizuna.png"
            alt="Kizuna Logo"
            width={28}
            height={28}
            className="object-contain"
          />
          <h1 className="text-lg uppercase tracking-[0.2em]">
            <span className="kingfall-font">KIZUNA</span>
 
          </h1>
        </Link>

        <div className="ml-auto">
          <WalletConnection compact />
        </div>
      </header>

      {/* ── Backdrop ── */}
      <div
        onClick={() => setOpen(false)}
        className={`md:hidden fixed inset-0 z-60 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* ── Slide-in drawer ── */}
      <nav
        className={`md:hidden fixed top-0 left-0 h-screen w-[72vw] max-w-70 z-70 flex flex-col bg-[#040407] border-r border-zinc-800/60 transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Mobile navigation"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-800/50 shrink-0">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/Kizuna.png"
              alt="KingFall Logo"
              width={28}
              height={28}
              className="object-contain"
            />
            <h1 className="text-lg uppercase tracking-[0.2em]">
              <span className="kingfall-font">Kizuna</span>
 
            </h1>
          </Link>
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
            const isPlay = item.href === "/play";
            // Using your current logic for disabled states
            const isDisabled = !isPlay;

            return (
              <Link
                key={item.label}
                href={isDisabled ? "#" : item.href}
                onClick={isDisabled ? (e) => e.preventDefault() : undefined}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : undefined}
                className={`group flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${
                  isDisabled
                    ? "opacity-30 cursor-not-allowed select-none"
                    : isActive
                    ? "text-amber-400 bg-amber-400/5"
                    : "text-zinc-400 hover:text-amber-400 hover:bg-amber-400/5"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 shrink-0 rounded-lg border transition-all duration-200 ${
                    isDisabled
                      ? "border-zinc-800/50 bg-zinc-900/20 text-zinc-600"
                      : isActive
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-zinc-800 bg-zinc-900 text-zinc-500 group-hover:border-amber-500/50 group-hover:bg-amber-500/10 group-hover:text-amber-400"
                  }`}
                >
                  {item.icon}
                </span>

                <span className="font-semibold text-sm tracking-wide font-mono uppercase">
                  {item.label}
                </span>

                {!isDisabled && (
                  <span
                    className={`ml-auto transition-opacity duration-200 text-amber-500 text-xs ${
                      isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    →
                  </span>
                )}
              </Link>
            );
          })}
          {/* ── Profile + Wallet at bottom ── */}
          <div className="px-4 py-5 border-t border-zinc-800/50 shrink-0 space-y-3">
            <SidebarProfile />
            <WalletConnection />
          </div>
        </div>
      </nav>
    </>
  );
}
