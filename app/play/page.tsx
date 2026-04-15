"use client";

import { useState, useEffect, useCallback, JSX } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../contexts/WalletContext";
import {
  rpc as StellarRpc,
  TransactionBuilder,
  Networks,
  Address,
  Contract,
  nativeToScVal,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  Crown,
  Swords,
  Coins,
  RotateCcw,
  AlertCircle,
  ExternalLink,
  Users,
  Trophy,
  ChevronRight,
  List,
} from "lucide-react";
import { motion } from "framer-motion";
import { useKingFallAuth } from "../hooks/Usekingfallauth";
import UsernameModal from "../components/UsernameModal";
import {
  GameCacheEntry,
  parseFen,
  parseMoves,
  readCachedGame,
  writeGameCache,
} from "../lib/gameCache";

// ─── Config ───────────────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID =
  "CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN";
const GAME_CONTRACT_ID =
  "CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54";
const NATIVE_TOKEN_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const FALLBACK_ACCOUNT =
  "GDXK7EYVBXTITLBW2ZCODJW3B7VTVCNNNWDDEHKJ7Y67TZVW5VKRRMU6";
const RPC_URL = "https://soroban-testnet.stellar.org:443";
const server = new StellarRpc.Server(RPC_URL);
const networkPassphrase = Networks.TESTNET;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_MAP: Record<number, string> = {
  0: "Waiting",
  1: "Active",
  2: "Finished",
  3: "Drawn",
  4: "Cancelled",
  5: "Timeout",
};
function parseStatus(raw: any): string {
  if (typeof raw === "number") return STATUS_MAP[raw] ?? String(raw);
  if (Array.isArray(raw)) return String(raw[0]); // e.g. ["Active"] -> "Active"
  if (typeof raw === "object" && raw !== null) return Object.keys(raw)[0];
  return String(raw);
}
function formatAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
function xlmToStroops(x: string) {
  return BigInt(Math.floor(parseFloat(x) * 10_000_000));
}

async function simRead(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  src?: string
): Promise<any> {
  const acct = await server.getAccount(src || FALLBACK_ACCOUNT);
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const result = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationSuccess(result))
    return scValToNative(result.result!.retval);
  throw new Error((result as any).error || "Simulation failed");
}

async function sendTx(
  addr: string,
  kit: any,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  onStatus: (s: {
    type: "success" | "error" | "pending";
    msg: string;
    hash?: string;
  }) => void
): Promise<xdr.ScVal | null> {
  onStatus({ type: "pending", msg: `${method}...` });
  try {
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const prepared = await server.prepareTransaction(tx);
    const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), {
      networkPassphrase,
      address: addr,
    });
    const response = await server.sendTransaction(
      TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase)
    );
    if (response.status === "ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status === "NOT_FOUND") {
      await new Promise((x) => setTimeout(x, 1000));
      r = await server.getTransaction(response.hash);
    }
    if (r.status === "SUCCESS") {
      onStatus({ type: "success", msg: "Confirmed", hash: response.hash });
      return (r as any).returnValue ?? null;
    }
    throw new Error("Transaction failed on-chain");
  } catch (err: any) {
    onStatus({ type: "error", msg: err.message || `${method} failed` });
    return null;
  }
}

interface GameInfo {
  id: string;
  status: string;
  stake: string;
  white: string;
  black?: string;
  created_at: number;
  isMyTurn?: boolean;
  currentPlayer?: "white" | "black";
  moveCount?: number;
}

// Mini board preview using cached data
const MiniChessboard = ({ gameId }: { gameId: string }) => {
  const [cacheEntry, setCacheEntry] = useState<GameCacheEntry | null>(null);

  useEffect(() => {
    const loadCache = () => {
      const entry = readCachedGame(gameId);
      setCacheEntry(entry);
    };

    loadCache();

    // Refresh when cache updates
    const handleStorageChange = () => loadCache();
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [gameId]);

  // Fallback to starting position for Open/Waiting games
  const displayFen =
    cacheEntry?.fen ||
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const rows = displayFen.split(" ")[0].split("/");

  return (
    <div className="w-28 h-28 border border-zinc-700 rounded-lg overflow-hidden grid grid-cols-8 grid-rows-8 bg-zinc-900 shrink-0 shadow-inner">
      {rows.flatMap((row, rowIndex) => {
        let colIndex = 0;
        const squares: JSX.Element[] = [];

        row.split("").forEach((char, _) => {
          if (/\d/.test(char)) {
            // Empty squares
            const emptyCount = parseInt(char);
            for (let k = 0; k < emptyCount; k++) {
              const isLight = (rowIndex + colIndex) % 2 === 0;
              squares.push(
                <div
                  key={`sq-${rowIndex}-${colIndex}`}
                  className={`w-full h-full ${
                    isLight ? "bg-[#f0d9b5]" : "bg-[#b58863]"
                  }`}
                />
              );
              colIndex++;
            }
          } else {
            // Piece
            const isLight = (rowIndex + colIndex) % 2 === 0;
            const isWhitePiece = char === char.toUpperCase();
            const pieceSymbol = getPieceUnicode(char);

            squares.push(
              <div
                key={`sq-${rowIndex}-${colIndex}`}
                className={`flex items-center justify-center text-[11px] font-bold select-none ${
                  isLight ? "bg-[#f0d9b5]" : "bg-[#b58863]"
                }`}
              >
                <span
                  className={
                    isWhitePiece
                      ? "text-white drop-shadow-md scale-110"
                      : "text-black drop-shadow-sm"
                  }
                >
                  {pieceSymbol}
                </span>
              </div>
            );
            colIndex++;
          }
        });

        return squares;
      })}
    </div>
  );
};

// Helper: Piece to Unicode
const getPieceUnicode = (p: string): string => {
  const map: Record<string, string> = {
    K: "♔",
    Q: "♕",
    R: "♖",
    B: "♗",
    N: "♘",
    P: "♙",
    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟︎",
  };
  return map[p] || "?";
};

export default function PlayLobby() {
  const { address: connectedAddress, walletsKit } = useWallet();

  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [myGames, setMyGames] = useState<GameInfo[]>([]);
  const [myGamesLoading, setMyGamesLoading] = useState(false);
  const [showMyGames, setShowMyGames] = useState(true);
  const [myTurnCount, setMyTurnCount] = useState(0);

  const [stakeAmount, setStakeAmount] = useState("100");
  const [xlmBalance, setXlmBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<{
    type: "success" | "error" | "pending";
    msg: string;
  } | null>(null);

  // Join by ID
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<GameInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Sidebar games
  const [activeGames, setActiveGames] = useState<GameInfo[]>([]);
  const [activeGamesLoading, setActiveGamesLoading] = useState(false);
  const [showActiveGames, setShowActiveGames] = useState(false);
  const [allGames, setAllGames] = useState<GameInfo[]>([]);
  const [allGamesLoading, setAllGamesLoading] = useState(false);
  const [showAllGames, setShowAllGames] = useState(false);
  const [totalStaked, setTotalStaked] = useState<string>("—");

  const {
    user: kfUser,
    showUsernameModal,
    registerUser,
    refreshUser,
    isLoading: authLoading,
  } = useKingFallAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-fetch game lists and escrow balance on mount
  useEffect(() => {
    if (!mounted) return;
    fetchActiveGames();
    fetchAllGames();
    // Read escrow contract's XLM balance via native token contract
    simRead(NATIVE_TOKEN_ID, "balance", [
      new Address(ESCROW_CONTRACT_ID).toScVal(),
    ])
      .then((raw) => {
        if (raw !== null && raw !== undefined) {
          const stroops = typeof raw === "bigint" ? raw : BigInt(raw);
          setTotalStaked(`${(Number(stroops) / 10_000_000).toFixed(2)} XLM`);
        }
      })
      .catch(() => {});
  }, [mounted]);

  // Handle ?join=X invite links
  useEffect(() => {
    if (!mounted) return;
    const joinParam = new URLSearchParams(window.location.search).get("join");
    if (joinParam) router.replace(`/play/${joinParam}`);
  }, [mounted, router]);

  const loadBalance = useCallback(async () => {
    if (!connectedAddress) return;
    try {
      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${connectedAddress}`
      );
      const d = await res.json();
      const n = d.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  const fetchMyGames = useCallback(async () => {
    if (!connectedAddress) return;
    setMyGamesLoading(true);

    try {
      const raw = await simRead(
        ESCROW_CONTRACT_ID,
        "get_player_games",
        [new Address(connectedAddress).toScVal()],
        connectedAddress
      );

      const ids = normalizeIds(raw);

      const games = await Promise.all(
        ids.map(async (id) => {
          try {
            const d = await simRead(
              ESCROW_CONTRACT_ID,
              "get_game",
              [nativeToScVal(id, { type: "u64" })],
              connectedAddress
            );

            const moveCount = d.move_hash
              ? d.move_hash.trim().split(/\s+/).length
              : 0;

            const isEvenMoves = moveCount % 2 === 0;
            const currentPlayer = isEvenMoves ? "white" : "black";

            const isMyTurn =
              (currentPlayer === "white" &&
                d.white?.toLowerCase() === connectedAddress.toLowerCase()) ||
              (currentPlayer === "black" &&
                d.black?.toLowerCase() === connectedAddress.toLowerCase());

            const gameInfo: GameInfo = {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              white: d.white,
              black: d.black,
              created_at: Number(d.created_at),
              isMyTurn,
              currentPlayer,
              moveCount,
            };

            // Cache board
            if (
              gameInfo.status === "Active" ||
              gameInfo.status === "Finished"
            ) {
              try {
                const gd = await simRead(
                  GAME_CONTRACT_ID,
                  "get_game",
                  [nativeToScVal(id, { type: "u64" })],
                  connectedAddress
                );

                const fen = parseFen(gd.current_fen);
                const moves = parseMoves(gd.moves as any[]);

                if (fen) {
                  writeGameCache(id.toString(), fen, moves);
                }
              } catch (err) {
                console.warn(
                  `[Lobby] Failed to cache board for game #${id}`,
                  err
                );
              }
            }

            return gameInfo;
          } catch (err) {
            console.error(`Failed to load game #${id}`, err);
            return null;
          }
        })
      );

      // filtering + sorting

      const processedGames = games
        .filter((g): g is GameInfo => Boolean(g))
        .sort((a, b) => {
          if (a.isMyTurn && !b.isMyTurn) return -1;
          if (!a.isMyTurn && b.isMyTurn) return 1;
          return b.created_at - a.created_at;
        });

      setMyGames(processedGames);
      setMyTurnCount(
        processedGames.filter(
          (g) => g.status === "Active" && g.isMyTurn === true
        ).length
      );
    } catch (e) {
      console.error("[fetchMyGames]", e);
    } finally {
      setMyGamesLoading(false);
    }
  }, [connectedAddress]);

  useEffect(() => {
    if (mounted && connectedAddress) fetchMyGames();
  }, [mounted, connectedAddress, fetchMyGames]);

  useEffect(() => {
    if (mounted) loadBalance();
  }, [loadBalance, mounted]);

  // ── Lookup game ───────────────────────────────────────────────────────────
  const handleLookup = async (id?: string) => {
    const gid = id ?? lookupId;
    if (!gid) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const data = await simRead(
        ESCROW_CONTRACT_ID,
        "get_game",
        [nativeToScVal(BigInt(gid), { type: "u64" })],
        connectedAddress || undefined
      );
      const status = parseStatus(data.status);
      const stake = (Number(data.stake) / 10_000_000).toFixed(2);
      setLookupResult({
        id: gid,
        status,
        stake,
        white: data.white,
        black: data.black,
        created_at: Number(data.created_at),
      });
    } catch {
      setLookupError("Game not found or invalid ID");
    } finally {
      setLookupLoading(false);
    }
  };

  // ── Create game ───────────────────────────────────────────────────────────
  const handleCreateGame = async () => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    const result = await sendTx(
      connectedAddress,
      walletsKit,
      ESCROW_CONTRACT_ID,
      "create_game",
      [
        new Address(connectedAddress).toScVal(),
        new Address(NATIVE_TOKEN_ID).toScVal(),
        nativeToScVal(xlmToStroops(stakeAmount), { type: "i128" }),
        nativeToScVal(0n, { type: "u64" }),
      ],
      setTxStatus
    );
    setLoading(false);
    if (result) {
      const id = scValToNative(result) as bigint;
      refreshUser();
      fetchMyGames();
      fetchActiveGames();
      router.push(`/play/${id.toString()}`);
    }
  };

  // ── Join game ─────────────────────────────────────────────────────────────
  const handleJoinGame = async (game: GameInfo) => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    const id = BigInt(game.id);

    // 1. Join escrow
    const joined = await sendTx(
      connectedAddress,
      walletsKit,
      ESCROW_CONTRACT_ID,
      "join_game",
      [
        nativeToScVal(id, { type: "u64" }),
        new Address(connectedAddress).toScVal(),
      ],
      setTxStatus
    );

    if (!joined && joined !== null) {
      setLoading(false);
      return;
    }

    // 2. Create game contract record (black signs)
    await sendTx(
      connectedAddress,
      walletsKit,
      GAME_CONTRACT_ID,
      "create_game",
      [
        new Address(game.white).toScVal(),
        new Address(connectedAddress).toScVal(),
        nativeToScVal(id, { type: "u64" }),
        nativeToScVal(0n, { type: "u64" }),
      ],
      () => {}
    );

    setLoading(false);
    setLoading(false);
    // Refresh sidebar profile game count
    refreshUser?.();
    router.push(`/play/${game.id}`);
  };

  // ── Fetch sidebar games ───────────────────────────────────────────────────
  const normalizeIds = (raw: any): bigint[] => {
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any) => {
      if (typeof x === "bigint") return x;
      if (typeof x === "number") return BigInt(x);
      if (typeof x === "object" && x !== null)
        return BigInt(Object.values(x)[0] as any);
      return BigInt(String(x));
    });
  };

  const fetchActiveGames = useCallback(async () => {
    setActiveGamesLoading(true);
    try {
      const raw = await simRead(
        ESCROW_CONTRACT_ID,
        "get_active_games",
        [],
        connectedAddress || undefined
      );
      const ids = normalizeIds(raw);
      const games = await Promise.all(
        ids.map(async (id) => {
          try {
            const d = await simRead(
              ESCROW_CONTRACT_ID,
              "get_game",
              [nativeToScVal(id, { type: "u64" })],
              connectedAddress || undefined
            );
            const gameInfo: GameInfo = {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              white: d.white,
              black: d.black,
              created_at: Number(d.created_at),
            };

            // ── Fetch & cache board state ──────────────────────────────
            if (
              gameInfo.status === "Active" ||
              gameInfo.status === "Finished" ||
              gameInfo.status === "Waiting"
            ) {
              try {
                const gd = await simRead(
                  GAME_CONTRACT_ID,
                  "get_game",
                  [nativeToScVal(id, { type: "u64" })],
                  connectedAddress || undefined
                );

                const fen = parseFen(gd.current_fen);
                const moves = parseMoves(gd.moves as any[]);

                console.log(`[Lobby Board Received] Game #${id}`, {
                  gameId: id.toString(),
                  status: gameInfo.status,
                  fen: fen,
                  moveCount: moves.length,
                  raw_fen: gd.current_fen,
                  timestamp: new Date().toISOString(),
                });

                if (fen) {
                  writeGameCache(id.toString(), fen, moves);
                  console.log(
                    `[Lobby] Board cached successfully for game #${id}`
                  );
                }
              } catch (err) {
                console.warn(
                  `[Lobby] Failed to fetch/cache board for game #${id}`,
                  err
                );
              }
            }

            return gameInfo;
          } catch {
            return null;
          }
        })
      );
      setActiveGames(games.filter(Boolean) as GameInfo[]);
    } catch (e) {
      console.error("[fetchActiveGames]", e);
    } finally {
      setActiveGamesLoading(false);
    }
  }, [connectedAddress]);

  const fetchAllGames = useCallback(async () => {
    setAllGamesLoading(true);
    try {
      const raw = await simRead(
        GAME_CONTRACT_ID,
        "get_all_games",
        [],
        connectedAddress || undefined
      );
      const ids = normalizeIds(raw);
      const games = await Promise.all(
        ids.map(async (id) => {
          try {
            const d = await simRead(
              ESCROW_CONTRACT_ID,
              "get_game",
              [nativeToScVal(id, { type: "u64" })],
              connectedAddress || undefined
            );
            const gameInfo: GameInfo = {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              white: d.white,
              black: d.black,
              created_at: Number(d.created_at),
            };
            // ── Fetch, log & cache board state ──────────────────────────────
            if (
              gameInfo.status === "Active" ||
              gameInfo.status === "Finished"
            ) {
              try {
                const gd = await simRead(
                  GAME_CONTRACT_ID,
                  "get_game",
                  [nativeToScVal(id, { type: "u64" })],
                  connectedAddress || undefined
                );

                const fen = parseFen(gd.current_fen);
                const moves = parseMoves(gd.moves as any[]);

                console.log(`[Lobby Board Received] Game #${id}`, {
                  gameId: id.toString(),
                  status: gameInfo.status,
                  fen: fen,
                  moveCount: moves.length,
                  raw_fen: gd.current_fen,
                  timestamp: new Date().toISOString(),
                });

                if (fen) {
                  writeGameCache(id.toString(), fen, moves);
                  console.log(
                    `[Lobby] Board cached successfully for game #${id}`
                  );
                }
              } catch (err) {
                console.warn(
                  `[Lobby] Failed to fetch/cache board for game #${id}`,
                  err
                );
              }
            }
            return gameInfo;
          } catch {
            return null;
          }
        })
      );
      setAllGames(games.filter(Boolean) as GameInfo[]);
    } catch (e) {
      console.error("[fetchAllGames]", e);
    } finally {
      setAllGamesLoading(false);
    }
  }, [connectedAddress]);

  if (!mounted) return null;

  const StatusBadge = ({ status }: { status: string }) => (
    <span
      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
        status === "Waiting"
          ? "bg-emerald-500/20 text-emerald-400"
          : status === "Active"
          ? "bg-amber-500/20 text-amber-400"
          : status === "Finished"
          ? "bg-blue-500/20 text-blue-400"
          : "bg-zinc-700/50 text-zinc-500"
      }`}
    >
      {status === "Waiting" ? "Open" : status}
    </span>
  );

  const GameRow = ({ g }: { g: GameInfo }) => {
    const isMyTurnToPlay = g.isMyTurn === true && g.status == "Active";

    return (
      <div
        className={`flex items-center justify-between py-3 px-3 -mx-2 rounded-xl transition-all duration-200 group ${
          isMyTurnToPlay ? " opacity-100" : " opacity-65  "
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Mini Board Preview */}
          <div className={isMyTurnToPlay ? "overflow-hidden" : ""}>
            <MiniChessboard gameId={g.id} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* <span className="text-[10px] text-amber-400 font-black font-mono shrink-0">
                #{g.id}
              </span> */}

              <StatusBadge status={g.status} />
            </div>

            <p className="text-[10px] text-zinc-300 font-mono truncate">
              {formatAddress(g.white)}
            </p>

            <p className="text-[9px] text-zinc-500">{g.stake} XLM</p>
          </div>
        </div>

        <button
          onClick={() => router.push(`/play/${g.id}`)}
          className={`flex items-center justify-center w-4 h-4 rounded-xl transition-all flex-shrink-0 ${
            isMyTurnToPlay
              ? "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/50"
              : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
          }`}
          title={isMyTurnToPlay ? "Play Now" : "View Game"}
        >
          {isMyTurnToPlay ? (
            <ChevronRight size={10} />
          ) : (
            <ChevronRight size={10} />
          )}
        </button>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{
        background:
          "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)",
        fontFamily: "'Courier New',Courier,monospace",
      }}
    >
      <div
        className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)",
        }}
      />
      <div
        className="fixed inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "200px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 py-8 pb-32">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          {connectedAddress ? (
            <div
              onClick={() =>
                kfUser?.wallet_address &&
                router.push(`/profile/${kfUser.wallet_address}`)
              }
              className="flex items-center border border-zinc-800 rounded-[14px] bg-zinc-900/60 backdrop-blur overflow-hidden cursor-pointer hover:border-amber-900 transition-colors duration-200"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border-r border-zinc-800">
                <div className="w-8 h-8 rounded-xl border border-amber-500/25 bg-amber-500/10 flex items-center justify-center text-base shrink-0">
                  ♔
                </div>
                <div className="flex flex-col gap-0">
                  <span className="text-[11px] font-semibold text-zinc-200 leading-tight">
                    {kfUser?.username}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wide leading-tight">
                    {formatAddress(connectedAddress)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <span className="text-[11px] font-bold text-amber-400 tracking-wide">
                  {xlmBalance}
                </span>
                <span className="text-[12px] font-semibold text-amber-400 tracking-widest">
                  XLM
                </span>
              </div>
            </div>
          ) : (
            <div />
          )}
          {txStatus && (
            <div
              className={`text-[10px] px-3 py-1.5 rounded-xl border ${
                txStatus.type === "pending"
                  ? "border-zinc-700 text-zinc-400"
                  : txStatus.type === "success"
                  ? "border-emerald-500/30 text-emerald-400"
                  : "border-rose-500/30 text-rose-400"
              }`}
            >
              {txStatus.type === "pending" && (
                <RotateCcw size={10} className="inline animate-spin mr-1" />
              )}
              {txStatus.msg}
            </div>
          )}
        </header>

        <div className="flex flex-col xl:flex-row">
          {/* ── Main ── */}
          <div className="flex-1 min-w-0">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-lg mx-auto space-y-5"
            >
              {/* Hero */}
              <div className="text-center py-6 space-y-3">
                <div
                  className="text-7xl mb-4"
                  style={{
                    filter: "drop-shadow(0 0 30px rgba(217,119,6,0.4))",
                  }}
                >
                  ♚
                </div>
                <h2 className="text-3xl font-bold text-white tracking-wider">
                  Stake. Play. <span className="text-amber-400">Conquer.</span>
                </h2>
                <p className="text-zinc-500 text-sm leading-relaxed max-w-sm mx-auto">
                  P2P chess with XLM on the line. Stakes locked in Soroban
                  escrow. Winner claims all.
                </p>
              </div>

              {connectedAddress ? (
                <>
                  {/* Create Game */}
                  <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <Coins size={12} className="text-amber-400" /> Create Game
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {["1", "5", "10", "25"].map((v) => (
                        <button
                          key={v}
                          onClick={() => setStakeAmount(v)}
                          className={`py-3 rounded-xl text-sm font-black tracking-wider transition-all border ${
                            stakeAmount === v
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                              : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                          }`}
                        >
                          {v} XLM
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-3 items-center">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-amber-500/50 transition-colors"
                      />
                      <span className="text-zinc-500 font-bold text-sm">
                        XLM
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-600">
                      <span>
                        Pot if matched:{" "}
                        <span className="text-amber-400 font-bold">
                          {(parseFloat(stakeAmount || "0") * 2).toFixed(2)} XLM
                        </span>
                      </span>
                      <span>
                        Fee: <span className="text-zinc-500">1.5%</span>
                      </span>
                    </div>
                    <button
                      onClick={handleCreateGame}
                      disabled={
                        loading || !stakeAmount || parseFloat(stakeAmount) <= 0
                      }
                      className="w-full py-4 rounded-xl font-black tracking-[0.15em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3"
                      style={{
                        background: "linear-gradient(135deg,#d97706,#b45309)",
                        boxShadow: "0 0 30px -8px rgba(217,119,6,0.5)",
                        color: "#000",
                      }}
                    >
                      {loading ? (
                        <>
                          <RotateCcw size={16} className="animate-spin" />{" "}
                          Processing
                        </>
                      ) : (
                        <>
                          <Swords size={16} /> Create & Stake {stakeAmount} XLM
                        </>
                      )}
                    </button>
                  </div>

                  {/* Join by ID */}
                  <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/20">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <Users size={12} className="text-amber-400" /> Join Game
                      by ID
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Enter Game ID"
                        value={lookupId}
                        onChange={(e) => {
                          setLookupId(e.target.value);
                          setLookupResult(null);
                          setLookupError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                        className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-zinc-600 transition-colors placeholder:text-zinc-700"
                      />
                      <button
                        onClick={() => handleLookup()}
                        disabled={lookupLoading || !lookupId}
                        className="px-5 py-3 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white active:scale-95"
                      >
                        {lookupLoading ? (
                          <RotateCcw size={14} className="animate-spin" />
                        ) : (
                          "Search"
                        )}
                      </button>
                    </div>
                    {lookupError && (
                      <p className="text-[10px] text-rose-400 flex items-center gap-1">
                        <AlertCircle size={10} /> {lookupError}
                      </p>
                    )}
                    {lookupResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-xl border overflow-hidden ${
                          lookupResult.status === "Waiting"
                            ? "border-emerald-500/25"
                            : lookupResult.status === "Active"
                            ? "border-amber-500/25"
                            : "border-zinc-700/40"
                        }`}
                      >
                        <div
                          className={`px-4 py-2.5 flex items-center justify-between ${
                            lookupResult.status === "Waiting"
                              ? "bg-emerald-500/[0.06]"
                              : lookupResult.status === "Active"
                              ? "bg-amber-500/[0.06]"
                              : "bg-zinc-900/60"
                          }`}
                        >
                          <span className="text-[10px] text-zinc-400 font-mono">
                            Game #{lookupResult.id}
                          </span>
                          <StatusBadge status={lookupResult.status} />
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-4 text-[10px] border-t border-zinc-800/50">
                          <div>
                            <p className="text-zinc-600 uppercase tracking-widest mb-1">
                              Creator
                            </p>
                            <p className="text-zinc-300 font-mono">
                              {formatAddress(lookupResult.white)}
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-600 uppercase tracking-widest mb-1">
                              Stake each
                            </p>
                            <p className="text-amber-400 font-black text-base">
                              {lookupResult.stake} XLM
                            </p>
                          </div>
                        </div>
                        <div className="px-4 pb-4 flex gap-2">
                          <button
                            onClick={() =>
                              router.push(`/play/${lookupResult!.id}`)
                            }
                            className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase transition-all bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
                          >
                            View Game
                          </button>
                          {lookupResult.status === "Waiting" &&
                            lookupResult.white !== connectedAddress && (
                              <button
                                onClick={() => handleJoinGame(lookupResult!)}
                                disabled={loading}
                                className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2"
                              >
                                {loading ? (
                                  <RotateCcw
                                    size={12}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <>Stake & Join {lookupResult.stake} XLM</>
                                )}
                              </button>
                            )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl p-6 text-center space-y-4 relative overflow-hidden border border-dashed border-zinc-800">
                  <div className="flex justify-center">
                    <canvas
                      ref={(canvas) => {
                        if (!canvas) return;
                        const ctx = canvas.getContext("2d")!;
                        const LIGHT = "#c8a97e",
                          DARK = "#8b6340";
                        const WH: Record<string, string> = {
                          K: "♚",
                          Q: "♛",
                          R: "♜",
                          B: "♝",
                          N: "♞",
                          P: "♟︎",
                          k: "♚",
                          q: "♛",
                          r: "♜",
                          b: "♝",
                          n: "♞",
                          p: "♟︎",
                        };

                        const sz = 28,
                          cols = 8,
                          rows = 8;
                        const W = sz * cols,
                          H = sz * rows;
                        canvas.width = W;
                        canvas.height = H;

                        let board: (string | null)[][] = [
                          ["r", "n", "b", "q", "k", "b", "n", "r"],
                          ["p", "p", "p", "p", "p", "p", "p", "p"],
                          [null, null, null, null, null, null, null, null],
                          [null, null, null, null, null, null, null, null],
                          [null, null, null, null, null, null, null, null],
                          [null, null, null, null, null, null, null, null],
                          ["P", "P", "P", "P", "P", "P", "P", "P"],
                          ["R", "N", "B", "Q", "K", "B", "N", "R"],
                        ];

                        const moves = [
                          { from: [6, 4], to: [4, 4] },
                          { from: [1, 4], to: [3, 4] },
                          { from: [7, 6], to: [5, 5] },
                          { from: [0, 1], to: [2, 2] },
                          { from: [6, 3], to: [4, 3] },
                          { from: [1, 3], to: [3, 3] },
                        ];

                        let moveIdx = 0,
                          animFrac = 0,
                          animating = false;
                        let animFrom: number[] | null = null,
                          animTo: number[] | null = null;
                        let animPiece: string | null = null,
                          pause = 0;

                        function resetBoard() {
                          board = [
                            ["r", "n", "b", "q", "k", "b", "n", "r"],
                            ["p", "p", "p", "p", "p", "p", "p", "p"],
                            [null, null, null, null, null, null, null, null],
                            [null, null, null, null, null, null, null, null],
                            [null, null, null, null, null, null, null, null],
                            [null, null, null, null, null, null, null, null],
                            ["P", "P", "P", "P", "P", "P", "P", "P"],
                            ["R", "N", "B", "Q", "K", "B", "N", "R"],
                          ];
                          pause = 50;
                        }

                        function drawPiece(p: string, x: number, y: number) {
                          const isWhite = p === p.toUpperCase();
                          const glyph = WH[p];
                          const fontSize = sz * 0.75;

                          ctx.save();
                          ctx.font = `bold ${fontSize}px Arial, sans-serif`;
                          ctx.textAlign = "center";
                          ctx.textBaseline = "middle";

                          if (isWhite) {
                            ctx.fillStyle = "#ffffff"; // Pure white
                          } else {
                            ctx.fillStyle = "#000000"; // Pure black
                          }
                          ctx.fillText(glyph, x, y + 1);
                          ctx.restore();
                        }

                        function drawBoard() {
                          ctx.clearRect(0, 0, W, H);
                          for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                              ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
                              ctx.fillRect(c * sz, r * sz, sz, sz);
                            }
                          }
                          if (animFrom) {
                            ctx.fillStyle = "rgba(240,192,64,0.4)";
                            ctx.fillRect(
                              animFrom[1] * sz,
                              animFrom[0] * sz,
                              sz,
                              sz
                            );
                          }
                          if (animTo) {
                            ctx.fillStyle = "rgba(240,192,64,0.4)";
                            ctx.fillRect(
                              animTo[1] * sz,
                              animTo[0] * sz,
                              sz,
                              sz
                            );
                          }
                          for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                              const p = board[r][c];
                              if (
                                p &&
                                !(
                                  animating &&
                                  animFrom &&
                                  animFrom[0] === r &&
                                  animFrom[1] === c
                                )
                              ) {
                                drawPiece(p, c * sz + sz / 2, r * sz + sz / 2);
                              }
                            }
                          }
                          if (animating && animFrom && animTo && animPiece) {
                            const x =
                              (animFrom[1] +
                                (animTo[1] - animFrom[1]) * animFrac) *
                                sz +
                              sz / 2;
                            const y =
                              (animFrom[0] +
                                (animTo[0] - animFrom[0]) * animFrac) *
                                sz +
                              sz / 2;
                            drawPiece(animPiece, x, y);
                          }
                        }

                        function step() {
                          if (pause > 0) {
                            pause--;
                            drawBoard();
                            return;
                          }
                          if (!animating) {
                            if (moveIdx >= moves.length) {
                              moveIdx = 0;
                              resetBoard();
                              return;
                            }
                            const mv = moves[moveIdx];
                            animFrom = mv.from;
                            animTo = mv.to;
                            animPiece = board[mv.from[0]][mv.from[1]];
                            board[mv.from[0]][mv.from[1]] = null;
                            animating = true;
                            animFrac = 0;
                          }
                          animFrac = Math.min(1, animFrac + 0.055);
                          drawBoard();
                          if (animFrac >= 1) {
                            board[animTo![0]][animTo![1]] = animPiece;
                            animating = false;
                            animFrac = 0;
                            moveIdx++;
                            pause = 30;
                          }
                        }

                        drawBoard();
                        const interval = setInterval(step, 40);
                        return () => clearInterval(interval);
                      }}
                      width={224}
                      height={224}
                      style={{ opacity: 0.9, maxWidth: "100%" }}
                    />
                  </div>
                  <p className="text-zinc-500 text-sm">
                    Connect your wallet to create or join a game
                  </p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Open Games",
                    value: activeGames.length || "—",
                    icon: Swords,
                  },
                  { label: "Total Staked", value: totalStaked, icon: Coins },
                  {
                    label: "Games Played",
                    value: allGames.length || "—",
                    icon: Trophy,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="border border-zinc-800/50 rounded-xl p-3 text-center bg-zinc-900/20"
                  >
                    <Icon
                      size={14}
                      className="mx-auto mb-1 text-amber-500/60"
                    />
                    <p className="text-sm font-bold text-white">
                      {String(value)}
                    </p>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Mobile games panel */}
          <div className="xl:hidden w-full mt-2 space-y-2">
            {/* My Games accordion */}
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
              {/* My Games Header */}
              <button
                onClick={() => {
                  setShowMyGames((s) => !s);
                  if (!showMyGames) fetchMyGames();
                }}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Users size={11} className="text-amber-400" />
                  My Games
                  {myTurnCount > 0 && (
                    <span className="ml-1.5 px-2 py-0.5 text-[9px] font-black bg-red-500 text-white rounded-full shadow-md shadow-red-500/50 ring-1 ring-red-400/30 min-w-[18px] h-[18px] flex items-center justify-center">
                      {myTurnCount}
                    </span>
                  )}
                </span>

                <ChevronRight
                  size={13}
                  className={`text-zinc-600 transition-transform ${
                    showMyGames ? "rotate-90" : ""
                  }`}
                />
              </button>
              {showMyGames && (
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-64 overflow-y-auto">
                  {myGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <RotateCcw
                        size={12}
                        className="animate-spin text-zinc-600"
                      />
                      <span className="text-[10px] text-zinc-600">Loading</span>
                    </div>
                  ) : myGames.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">
                      No games yet
                    </p>
                  ) : (
                    myGames
                      .slice()
                      .sort((a, b) => {
                        const aIsMyTurnToPlay =
                          a.status === "Active" && a.isMyTurn === true;
                        const bIsMyTurnToPlay =
                          b.status === "Active" && b.isMyTurn === true;

                        if (aIsMyTurnToPlay && !bIsMyTurnToPlay) return -1;
                        if (!aIsMyTurnToPlay && bIsMyTurnToPlay) return 1;

                        // Then newest games first
                        return b.created_at - a.created_at;
                      })
                      .map((g) => <GameRow key={g.id} g={g} />)
                  )}
                  <button
                    onClick={fetchMyGames}
                    className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={9} /> Refresh
                  </button>
                </div>
              )}
            </div>
            {/* Open Games accordion */}
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
              <button
                onClick={() => {
                  setShowActiveGames((s) => !s);
                  if (!showActiveGames) fetchActiveGames();
                }}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Swords size={11} className="text-amber-400" /> Open Games
                </span>
                <div className="flex items-center gap-2">
                  {activeGames.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black">
                      {activeGames.length}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={`text-zinc-600 transition-transform ${
                      showActiveGames ? "rotate-90" : ""
                    }`}
                  />
                </div>
              </button>
              {showActiveGames && (
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-64 overflow-y-auto">
                  {activeGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <RotateCcw
                        size={12}
                        className="animate-spin text-zinc-600"
                      />
                      <span className="text-[10px] text-zinc-600">Loading</span>
                    </div>
                  ) : activeGames.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">
                      No open games
                    </p>
                  ) : (
                    activeGames.map((g) => <GameRow key={g.id} g={g} />)
                  )}
                  <button
                    onClick={fetchActiveGames}
                    className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={9} /> Refresh
                  </button>
                </div>
              )}
            </div>

            {/* All Games accordion */}
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
              <button
                onClick={() => {
                  setShowAllGames((s) => !s);
                  if (!showAllGames) fetchAllGames();
                }}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <List size={11} className="text-amber-400" /> All Games
                </span>
                <div className="flex items-center gap-2">
                  {allGames.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 font-black">
                      {allGames.length}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={`text-zinc-600 transition-transform ${
                      showAllGames ? "rotate-90" : ""
                    }`}
                  />
                </div>
              </button>
              {showAllGames && (
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-64 overflow-y-auto">
                  {allGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <RotateCcw
                        size={12}
                        className="animate-spin text-zinc-600"
                      />
                      <span className="text-[10px] text-zinc-600">Loading</span>
                    </div>
                  ) : allGames.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">
                      No games yet
                    </p>
                  ) : (
                    allGames.map((g) => <GameRow key={g.id} g={g} />)
                  )}
                  <button
                    onClick={fetchAllGames}
                    className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={9} /> Refresh
                  </button>
                </div>
              )}
            </div>

            {/* Contract links mobile */}
            <div className="flex gap-4 px-1 py-1">
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                Escrow · {formatAddress(ESCROW_CONTRACT_ID)}{" "}
                <ExternalLink size={8} />
              </a>
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${GAME_CONTRACT_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                Game · {formatAddress(GAME_CONTRACT_ID)}{" "}
                <ExternalLink size={8} />
              </a>
            </div>
          </div>

          {/* Desktop sidebar */}
          <div className="hidden xl:flex flex-col gap-3 w-72 shrink-0">
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20 sticky top-8">
              {/* My Games */}
              {connectedAddress && (
                <>
                  <button
                    onClick={() => {
                      setShowMyGames((s) => !s);
                      if (!showMyGames) fetchMyGames();
                    }}
                    className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                      <Users size={11} className="text-amber-400" />
                      My Games
                      {myTurnCount > 0 && (
                        <span className="ml-1.5 px-2 py-0.5 text-[9px] font-black bg-red-500 text-white rounded-full shadow-md shadow-red-500/50 ring-1 ring-red-400/30 min-w-[18px] h-[18px] flex items-center justify-center">
                          {myTurnCount}
                        </span>
                      )}
                    </span>

                    <ChevronRight
                      size={13}
                      className={`text-zinc-600 transition-transform ${
                        showMyGames ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  {showMyGames && (
                    <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-64 overflow-y-auto">
                      {myGamesLoading ? (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <RotateCcw
                            size={12}
                            className="animate-spin text-zinc-600"
                          />
                          <span className="text-[10px] text-zinc-600">
                            Loading
                          </span>
                        </div>
                      ) : myGames.length === 0 ? (
                        <p className="text-[10px] text-zinc-600 text-center py-4">
                          No games yet
                        </p>
                      ) : (
                        myGames
                          .slice()
                          .sort((a, b) => {
                            const aIsMyTurnToPlay =
                              a.status === "Active" && a.isMyTurn === true;
                            const bIsMyTurnToPlay =
                              b.status === "Active" && b.isMyTurn === true;

                            if (aIsMyTurnToPlay && !bIsMyTurnToPlay) return -1;
                            if (!aIsMyTurnToPlay && bIsMyTurnToPlay) return 1;

                            return b.created_at - a.created_at;
                          })
                          .map((g) => <GameRow key={g.id} g={g} />)
                      )}
                      <button
                        onClick={fetchMyGames}
                        className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                      >
                        <RotateCcw size={9} /> Refresh
                      </button>
                    </div>
                  )}
                  <div className="border-t border-zinc-800/50" />
                </>
              )}
              {/* Open Games */}
              <button
                onClick={() => {
                  setShowActiveGames((s) => !s);
                  if (!showActiveGames) fetchActiveGames();
                }}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Swords size={11} className="text-amber-400" /> Open Games
                </span>
                <div className="flex items-center gap-2">
                  {activeGames.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black">
                      {activeGames.length}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={`text-zinc-600 transition-transform ${
                      showActiveGames ? "rotate-90" : ""
                    }`}
                  />
                </div>
              </button>
              {showActiveGames && (
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1">
                  {activeGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <RotateCcw
                        size={12}
                        className="animate-spin text-zinc-600"
                      />
                      <span className="text-[10px] text-zinc-600">Loading</span>
                    </div>
                  ) : activeGames.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">
                      No open games
                    </p>
                  ) : (
                    activeGames.map((g) => <GameRow key={g.id} g={g} />)
                  )}
                  <button
                    onClick={fetchActiveGames}
                    className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={9} /> Refresh
                  </button>
                </div>
              )}

              <div className="border-t border-zinc-800/50" />

              {/* All Games */}
              <button
                onClick={() => {
                  setShowAllGames((s) => !s);
                  if (!showAllGames) fetchAllGames();
                }}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <List size={11} className="text-amber-400" /> All Games
                </span>
                <div className="flex items-center gap-2">
                  {allGames.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 font-black">
                      {allGames.length}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={`text-zinc-600 transition-transform ${
                      showAllGames ? "rotate-90" : ""
                    }`}
                  />
                </div>
              </button>
              {showAllGames && (
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-96 overflow-y-auto">
                  {allGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <RotateCcw
                        size={12}
                        className="animate-spin text-zinc-600"
                      />
                      <span className="text-[10px] text-zinc-600">Loading</span>
                    </div>
                  ) : allGames.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">
                      No games yet
                    </p>
                  ) : (
                    allGames.map((g) => <GameRow key={g.id} g={g} />)
                  )}
                  <button
                    onClick={fetchAllGames}
                    className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={9} /> Refresh
                  </button>
                </div>
              )}

              {/* Contract links */}
              <div className="border-t border-zinc-800/50 px-4 py-3 space-y-1.5">
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1"
                >
                  Escrow · {formatAddress(ESCROW_CONTRACT_ID)}{" "}
                  <ExternalLink size={8} />
                </a>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${GAME_CONTRACT_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1"
                >
                  Game · {formatAddress(GAME_CONTRACT_ID)}{" "}
                  <ExternalLink size={8} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <UsernameModal open={showUsernameModal} onSubmit={registerUser as any} />
    </div>
  );
}
