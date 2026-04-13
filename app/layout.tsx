import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./contexts/WalletContext";
import WalletConnection from "./components/WalletConnection";
import Link from "next/link";
import { Suspense } from "react";
import MobileNav from "./components/MobileNav";
import Image from "next/image";
import { Analytics } from "@vercel/analytics/next";
import SidebarProfile from "./components/SidebarProfile";

export const metadata: Metadata = {
  icons: {
    icon: "/KingFall_logo.png",
    shortcut: "/KingFall_logo.png",
    apple: "/KingFall_logo.png",
  },
};

export const navItems = [
  {
    label: "Play",
    href: "/play",
    comingSoon: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
        <polygon points="5,3 19,12 5,21" fill="currentColor" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: "Learn",
    href: "/learn",
    comingSoon: true,
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
    comingSoon: true,
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
    comingSoon: true,
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
      <Analytics />
      <body className="antialiased bg-[#040407]">
        <WalletProvider>
          <div className="min-h-screen flex">

            {/* ── Desktop sidebar ── */}
            <aside className="fixed top-0 left-0 h-screen w-64 z-50 flex-col bg-[#040407]/90 backdrop-blur-xl border-r border-zinc-800/50 hidden md:flex">
              <header className="flex items-center justify-between mb-8 p-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/KingFall_logo.png"
                    alt="KingFall Logo"
                    width={36}
                    height={36}
                    className="object-contain"
                  />
                  <h1 className="kingfall-font text-2xl font-bold tracking-[0.2em] uppercase text-white">
                    <span>King</span><span>Fall</span>
                  </h1>
                </div>
              </header>

              <nav className="flex-1 px-3 mt-6 flex flex-col gap-1">
                {navItems.map((item) =>
                  item.comingSoon ? (
                    <span key={item.label}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl text-zinc-600 opacity-50 cursor-not-allowed select-none">
                      <span>{item.icon}</span>
                      <span className="font-semibold text-sm tracking-wide font-mono uppercase">{item.label}</span>
                    </span>
                  ) : (
                    <Link key={item.label} href={item.href}
                      className="group flex items-center gap-3 px-3 py-3 rounded-xl text-zinc-400 hover:text-amber-400 hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/10 transition-all duration-200">
                      <span className="text-zinc-500 group-hover:text-amber-400 transition-colors duration-200">{item.icon}</span>
                      <span className="font-semibold text-sm tracking-wide font-mono uppercase">{item.label}</span>
                      <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-amber-500 text-xs">→</span>
                    </Link>
                  )
                )}
              </nav>

              {/* ── Profile + Wallet at bottom ── */}
              <div className="px-4 py-5 border-t border-zinc-800/50 space-y-3">
                <SidebarProfile />
                <WalletConnection />
              </div>
            </aside>

            {/* ── Mobile top bar ── */}
            <MobileNav navItems={navItems} />

            {/* ── Page content ── */}
            <main className="flex-1 md:ml-64 pt-14 md:pt-0 overflow-x-hidden min-h-screen">
              <Suspense>{children}</Suspense>
            </main>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}