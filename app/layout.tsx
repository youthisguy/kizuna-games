import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./contexts/WalletContext";
import WalletConnection from "./components/WalletConnection";
import Link from "next/link";
import { Crown } from "lucide-react";

export const metadata: Metadata = {
  title: "STELLAR LAUNCHPAD",
  description: "Decentralized token launchpad on Stellar Soroban",
};

const navItems = [
  {
    label: "Play",
    href: "/play",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
        <polygon points="5,3 19,12 5,21" fill="currentColor" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: "Learn",
    href: "/learn",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    label: "Tournaments",
    href: "/tournaments",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 21h8M12 17v4M7 4H5C4.4 4 4 4.4 4 5v4c0 3.3 2.7 6 6 6h4c3.3 0 6-2.7 6-6V5c0-.6-.4-1-1-1h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="8" y="2" width="8" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 8H2M20 8h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Puzzles",
    href: "/puzzles",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 3h4v3c0 .6.4 1 1 1s1-.4 1-1V3h4v4h-3c-.6 0-1 .4-1 1s.4 1 1 1h3v4h-4v-3c0-.6-.4-1-1-1s-1 .4-1 1v3H7v-4h3c.6 0 1-.4 1-1s-.4-1-1-1H7V3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#040407]">
        <WalletProvider>
          <div className="min-h-screen flex">

            {/* ── LEFT SIDEBAR ── */}
            <aside className="fixed top-0 left-0 h-screen w-64 z-50 flex flex-col bg-[#040407]/90 backdrop-blur-xl border-r border-zinc-800/50">

              {/* Logo */}
                     {/* ── Header ── */}
        <header className="flex items-center justify-between mb-8 p-4">
          <div className="flex items-center gap-3">
            <Crown size={26} className="text-amber-400" style={{ filter: "drop-shadow(0 0 8px #d97706)" }} />
            <div>
              <h1 className="text-2xl font-bold tracking-[0.2em] text-white uppercase">
                King<span className="text-amber-400">Fall</span>
              </h1>
            </div>
          </div>

          {/* {connectedAddress && (
            <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-900/40 backdrop-blur">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] text-zinc-400 tracking-wider">{formatAddress(connectedAddress)}</span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] text-amber-400 font-bold">{xlmBalance} XLM</span>
            </div>
          )} */}
        </header>

 
              {/* Nav items */}
              <nav className="flex-1 px-3 mt-6 flex flex-col gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="group flex items-center gap-3 px-3 py-3 rounded-xl text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/10 transition-all duration-200"
                  >
                    <span className="text-zinc-500 group-hover:text-emerald-400 transition-colors duration-200">
                      {item.icon}
                    </span>
                    <span className="font-semibold text-sm tracking-wide font-mono uppercase">
                      {item.label}
                    </span>
                    <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-emerald-500 text-xs">
                      →
                    </span>
                  </Link>
                ))}
              </nav>

              {/* Wallet at the bottom */}
              <div className="px-4 py-5 border-t border-zinc-800/50 flex justify-start">
              <WalletConnection />
              </div>
            </aside>

            {/* ── MAIN CONTENT (offset by sidebar width) ── */}
            <main className="flex-1 ml-64 overflow-x-hidden min-h-screen">
              {children}
            </main>

          </div>
        </WalletProvider>
      </body>
    </html>
  );
}