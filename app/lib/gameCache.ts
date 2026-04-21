export interface GameCacheEntry {
  fen: string;
  moves: string[];
  ts: number;
  winner?: "w" | "b" | "draw";  
}

// ─── Shared FEN/move parsers ──────────────────────────────────────────────
export function parseFen(raw: any): string {
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return String(raw[0]);
    return String(Object.values(raw || {})[0] || "");
  }
  
  export function parseMoves(movesArr: any[]): string[] {
    return movesArr
      .map((m: any) => {
        const s = m.san;
        if (typeof s === "string") return s;
        if (Array.isArray(s)) return String(s[0]);
        return String(Object.values(s || {})[0] || "");
      })
      .filter(Boolean);
  }
  
  // ─── localStorage cache ───────────────────────────────────────────────────
  const GAME_CACHE_KEY = "kf_game_cache";
  
  export interface GameCacheEntry {
    fen: string;
    moves: string[];
    ts: number;
  }
  
  export function readGameCache(): Record<string, GameCacheEntry> {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(GAME_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }
  
  export function readCachedGame(id: string): GameCacheEntry | null {
    return readGameCache()[id] ?? null;
  }
  
  export function writeGameCache(
    id: string,
    fen: string,
    moves: string[],
    winner?: "w" | "b" | "draw"  
  ) {
    if (typeof window === "undefined") return;
    try {
      const cache = readGameCache();
      cache[id] = { fen, moves, ts: Date.now(), ...(winner ? { winner } : {}) };
      const keys = Object.keys(cache).sort((a, b) => cache[b].ts - cache[a].ts);
      const trimmed: typeof cache = {};
      keys.slice(0, 50).forEach((k) => (trimmed[k] = cache[k]));
      localStorage.setItem(GAME_CACHE_KEY, JSON.stringify(trimmed));
    } catch {}
  }