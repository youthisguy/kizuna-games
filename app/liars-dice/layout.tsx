import { Suspense } from "react";

export default function LiarsDiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#050508" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl animate-pulse">🎲</div>
          <div className="w-5 h-5 border-2 border-amber-500/40 border-t-amber-500 rounded-full animate-spin" />
        </div>
      </div>
    }>
      {children}
    </Suspense>
  );
}