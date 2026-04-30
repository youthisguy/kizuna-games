"use client";

import { useState, useEffect, useCallback } from "react";
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
  RotateCcw,
  AlertCircle,
  ExternalLink,
  Users,
  Trophy,
  ChevronRight,
  List,
  PlusCircleIcon,
  BadgeDollarSign,
  PlaySquareIcon,
  Circle,
} from "lucide-react";
import { motion } from "framer-motion";

// ─── Config ───────────────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID =
  "CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN";
const POOL_GAME_CONTRACT_ID =
  "CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54";  
const NATIVE_TOKEN_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const FALLBACK_ACCOUNT =
  "GDXK7EYVBXTITLBW2ZCODJW3B7VTVCNNNWDDEHKJ7Y67TZVW5VKRRMU6";
const RPC_URL = "https://soroban-testnet.stellar.org:443";
const server = new StellarRpc.Server(RPC_URL);
const networkPassphrase = Networks.TESTNET;

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  if (Array.isArray(raw)) return String(raw[0]);
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
  onStatus({ type: "pending", msg: "Preparing transaction..." });
  try {
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account, {
      fee: "100",
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
    onStatus({ type: "pending", msg: "processing" });
    const bumpRes = await fetch("/api/fee-bump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedInnerXdr: signedTxXdr }),
    });
    if (!bumpRes.ok) {
      const err = await bumpRes.json();
      throw new Error(err.error || "Fee bump failed");
    }
    const { feeBumpXdr } = await bumpRes.json();
    const response = await server.sendTransaction(
      TransactionBuilder.fromXDR(feeBumpXdr, networkPassphrase)
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
    onStatus({ type: "error", msg: err.message || "Transaction failed" });
    return null;
  }
}

interface GameInfo {
  id: string;
  status: string;
  stake: string;
  player1: string;
  player2?: string;
  created_at: number;
  isMyTurn?: boolean;
}

// ── Mini Pool Table Preview ───────────────────────────────────────────────────
const MiniPoolTable = ({ gameId }: { gameId: string }) => {
  // Deterministic ball positions based on gameId for a unique but stable preview
  const seed = parseInt(gameId, 10) || 1;
  const balls = Array.from({ length: 7 }, (_, i) => ({
    x: 20 + ((seed * (i + 1) * 17) % 60),
    y: 15 + ((seed * (i + 1) * 13) % 70),
    color: i < 3 ? "#f59e0b" : i < 6 ? "#3b82f6" : "#1a1a1a",
    stripe: i >= 4,
  }));

  return (
    <div
      className="w-28 h-16 rounded-lg overflow-hidden shrink-0 shadow-inner border border-zinc-700 relative"
      style={{ background: "#1a5c2a" }}
    >
      {/* Rail */}
      <div className="absolute inset-1 rounded border border-emerald-900/60" />
      {/* Pockets */}
      {[
        { top: "2px", left: "2px" },
        { top: "2px", left: "50%", transform: "translateX(-50%)" },
        { top: "2px", right: "2px" },
        { bottom: "2px", left: "2px" },
        { bottom: "2px", left: "50%", transform: "translateX(-50%)" },
        { bottom: "2px", right: "2px" },
      ].map((pos, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full bg-black"
          style={pos as any}
        />
      ))}
      {/* Balls */}
      {balls.map((b, i) => (
        <div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full shadow-sm"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            background: b.color,
            border: b.stripe ? `1.5px solid rgba(255,255,255,0.3)` : "none",
          }}
        />
      ))}
      {/* Cue ball */}
      <div
        className="absolute w-2.5 h-2.5 rounded-full bg-white shadow"
        style={{ left: "75%", top: "45%" }}
      />
    </div>
  );
};

export default function PoolLobby() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [stakeAmount, setStakeAmount] = useState("10");
  const [xlmBalance, setXlmBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<{
    type: "success" | "error" | "pending";
    msg: string;
  } | null>(null);

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<GameInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [myGames, setMyGames] = useState<GameInfo[]>([]);
  const [myGamesLoading, setMyGamesLoading] = useState(false);
  const [showMyGames, setShowMyGames] = useState(true);

  const [openGames, setOpenGames] = useState<GameInfo[]>([]);
  const [openGamesLoading, setOpenGamesLoading] = useState(false);
  const [showOpenGames, setShowOpenGames] = useState(false);

  const [allGames, setAllGames] = useState<GameInfo[]>([]);
  const [allGamesLoading, setAllGamesLoading] = useState(false);
  const [showAllGames, setShowAllGames] = useState(false);

  const [totalStaked, setTotalStaked] = useState<string>("—");

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchOpenGames();
    fetchAllGames();
    simRead(NATIVE_TOKEN_ID, "balance", [
      new Address(ESCROW_CONTRACT_ID).toScVal(),
    ])
      .then((raw) => {
        if (raw != null) {
          const stroops = typeof raw === "bigint" ? raw : BigInt(raw);
          setTotalStaked(`${(Number(stroops) / 10_000_000).toFixed(2)} XLM`);
        }
      })
      .catch(() => {});
  }, [mounted]);

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

  useEffect(() => { if (mounted) loadBalance(); }, [loadBalance, mounted]);

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

  const fetchOpenGames = useCallback(async () => {
    setOpenGamesLoading(true);
    try {
      const raw = await simRead(ESCROW_CONTRACT_ID, "get_active_games", [], connectedAddress || undefined);
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
            return {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              player1: d.white,
              player2: d.black,
              created_at: Number(d.created_at),
            } as GameInfo;
          } catch { return null; }
        })
      );
      setOpenGames(games.filter(Boolean) as GameInfo[]);
    } catch {}
    finally { setOpenGamesLoading(false); }
  }, [connectedAddress]);

  const fetchAllGames = useCallback(async () => {
    setAllGamesLoading(true);
    try {
      const raw = await simRead(POOL_GAME_CONTRACT_ID, "get_all_games", [], connectedAddress || undefined);
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
            return {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              player1: d.white,
              player2: d.black,
              created_at: Number(d.created_at),
            } as GameInfo;
          } catch { return null; }
        })
      );
      setAllGames(games.filter(Boolean) as GameInfo[]);
    } catch {}
    finally { setAllGamesLoading(false); }
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
            return {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              player1: d.white,
              player2: d.black,
              created_at: Number(d.created_at),
            } as GameInfo;
          } catch { return null; }
        })
      );
      setMyGames(games.filter(Boolean) as GameInfo[]);
    } catch {}
    finally { setMyGamesLoading(false); }
  }, [connectedAddress]);

  useEffect(() => {
    if (mounted && connectedAddress) fetchMyGames();
  }, [mounted, connectedAddress, fetchMyGames]);

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
      setLookupResult({
        id: gid,
        status: parseStatus(data.status),
        stake: (Number(data.stake) / 10_000_000).toFixed(2),
        player1: data.white,
        player2: data.black,
        created_at: Number(data.created_at),
      });
    } catch {
      setLookupError("Game not found or invalid ID");
    } finally {
      setLookupLoading(false);
    }
  };

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
      router.push(`/pool/${id.toString()}`);
    }
  };

  const handleJoinGame = async (game: GameInfo) => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    const id = BigInt(game.id);
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
    if (joined !== null) {
      await sendTx(
        connectedAddress,
        walletsKit,
        POOL_GAME_CONTRACT_ID,
        "create_game",
        [
          new Address(game.player1).toScVal(),
          new Address(connectedAddress).toScVal(),
          nativeToScVal(id, { type: "u64" }),
          nativeToScVal(0n, { type: "u64" }),
        ],
        () => {}
      );
    }
    setLoading(false);
    router.push(`/pool/${game.id}`);
  };

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

  const GameRow = ({ g }: { g: GameInfo }) => (
    <div
      className="flex items-center justify-between py-3 px-3 -mx-2 rounded-xl transition-all hover:cursor-pointer hover:bg-zinc-800/30 duration-200"
      onClick={() => router.push(`/pool/${g.id}`)}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <MiniPoolTable gameId={g.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={g.status} />
          </div>
          <p className="text-[10px] text-zinc-300 font-mono truncate">
            {formatAddress(g.player1)}
          </p>
          <p className="text-[9px] text-zinc-500">{g.stake} XLM</p>
        </div>
      </div>
      <button className="flex items-center justify-center w-4 h-4 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 shrink-0">
        <ChevronRight size={10} />
      </button>
    </div>
  );

  const SidebarSection = ({
    title,
    icon: Icon,
    games,
    loading: isLoading,
    show,
    onToggle,
    onRefresh,
    badge,
    badgeColor = "zinc",
    maxH = "max-h-64",
  }: any) => (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
      >
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
          <Icon size={11} className="text-emerald-400" />
          {title}
          {badge != null && badge > 0 && (
            <span className={`ml-1 px-1.5 py-0.5 text-[9px] font-black bg-${badgeColor}-500/20 text-${badgeColor}-400 rounded-full`}>
              {badge}
            </span>
          )}
        </span>
        <ChevronRight
          size={13}
          className={`text-zinc-600 transition-transform ${show ? "rotate-90" : ""}`}
        />
      </button>
      {show && (
        <div className={`border-t border-zinc-800/50 px-4 pb-3 pt-1 ${maxH} overflow-y-auto`}>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <RotateCcw size={12} className="animate-spin text-zinc-600" />
              <span className="text-[10px] text-zinc-600">Loading</span>
            </div>
          ) : games.length === 0 ? (
            <p className="text-[10px] text-zinc-600 text-center py-4">No games yet</p>
          ) : (
            games.map((g: GameInfo) => <GameRow key={g.id} g={g} />)
          )}
          <button
            onClick={onRefresh}
            className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1"
          >
            <RotateCcw size={9} /> Refresh
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{
        background:
          "radial-gradient(ellipse 120% 80% at 50% -10%, #001a0a 0%, #0a0f0a 55%, #050508 100%)",
        fontFamily: "'Courier New',Courier,monospace",
      }}
    >
      {/* Glow */}
      <div
        className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 0%, #10b981, transparent)",
        }}
      />
      {/* Noise */}
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
            <div className="flex items-center border border-zinc-800 rounded-[14px] bg-zinc-900/60 backdrop-blur overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-r border-zinc-800">
                <div className="w-8 h-8 rounded-xl border border-emerald-500/25 bg-emerald-500/10 flex items-center justify-center text-base shrink-0">
                  🎱
                </div>
                <div className="flex flex-col gap-0">
                  <span className="text-[11px] font-semibold text-zinc-200 leading-tight">
                    Pool
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wide leading-tight">
                    {formatAddress(connectedAddress)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <span className="text-[11px] font-bold text-emerald-400 tracking-wide">
                  {xlmBalance}
                </span>
                <span className="text-[12px] font-semibold text-emerald-400 tracking-widest">
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

        <div className="flex flex-col xl:flex-row gap-6">
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
                    filter: "drop-shadow(0 0 30px rgba(16,185,129,0.4))",
                  }}
                >
                  🎱
                </div>
                <h2 className="text-3xl font-bold text-white tracking-wider">
                  Rack. Break.{" "}
                  <span className="text-emerald-400">Collect.</span>
                </h2>
                <p className="text-zinc-500 text-sm leading-relaxed max-w-sm mx-auto">
                  P2P 8-ball pool with XLM on the line. Stakes locked in
                  Soroban escrow. Sink the 8-ball to win it all.
                </p>
              </div>

              {connectedAddress ? (
                <>
                  {/* Create Game */}
                  <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <PlusCircleIcon size={12} className="text-emerald-400" />
                      Create Game
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {["1", "5", "10", "25"].map((v) => (
                        <button
                          key={v}
                          onClick={() => setStakeAmount(v)}
                          className={`py-3 rounded-xl text-sm font-black tracking-wider transition-all border ${
                            stakeAmount === v
                              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
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
                        className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-emerald-500/50 transition-colors"
                      />
                      <span className="text-zinc-500 font-bold text-sm">XLM</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-600">
                      <span>
                        Pot if matched:{" "}
                        <span className="text-emerald-400 font-bold">
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
                        background: "linear-gradient(135deg,#10b981,#059669)",
                        boxShadow: "0 0 30px -8px rgba(16,185,129,0.5)",
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
                          <Circle size={16} /> Rack & Stake {stakeAmount} XLM
                        </>
                      )}
                    </button>
                  </div>

                  {/* Join by ID */}
                  <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/20">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <Users size={12} className="text-emerald-400" /> Join
                      Game by ID
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
                              ? "bg-emerald-500/6"
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
                            <p className="text-zinc-600 uppercase tracking-widest mb-1">Creator</p>
                            <p className="text-zinc-300 font-mono">
                              {formatAddress(lookupResult.player1)}
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-600 uppercase tracking-widest mb-1">Stake each</p>
                            <p className="text-emerald-400 font-black text-base">
                              {lookupResult.stake} XLM
                            </p>
                          </div>
                        </div>
                        <div className="px-4 pb-4 flex gap-2">
                          <button
                            onClick={() => router.push(`/pool/${lookupResult!.id}`)}
                            className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
                          >
                            View Game
                          </button>
                          {lookupResult.status === "Waiting" &&
                            lookupResult.player1 !== connectedAddress && (
                              <button
                                onClick={() => handleJoinGame(lookupResult!)}
                                disabled={loading}
                                className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2"
                              >
                                {loading ? (
                                  <RotateCcw size={12} className="animate-spin" />
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
                <div className="rounded-2xl p-8 text-center border border-dashed border-zinc-800 space-y-4">
                  <div className="text-5xl opacity-40">🎱</div>
                  <p className="text-zinc-500 text-sm">
                    Connect your wallet to create or join a game
                  </p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Open Games", value: openGames.length || "—", icon: PlaySquareIcon },
                  { label: "Total Staked", value: totalStaked, icon: BadgeDollarSign },
                  { label: "Games Played", value: allGames.length || "—", icon: Trophy },
                ].map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="border border-zinc-800/50 rounded-xl p-3 text-center bg-zinc-900/20"
                  >
                    <Icon size={14} className="mx-auto mb-1 text-emerald-500/60" />
                    <p className="text-sm font-bold text-white">{String(value)}</p>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* ── Desktop Sidebar ── */}
          <div className="hidden xl:flex flex-col gap-3 w-72 shrink-0">
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20 sticky top-8">
              {connectedAddress && (
                <>
                  <SidebarSection
                    title="My Games"
                    icon={Users}
                    games={myGames}
                    loading={myGamesLoading}
                    show={showMyGames}
                    onToggle={() => { setShowMyGames((s) => !s); if (!showMyGames) fetchMyGames(); }}
                    onRefresh={fetchMyGames}
                  />
                  <div className="border-t border-zinc-800/50" />
                </>
              )}
              <SidebarSection
                title="Open Games"
                icon={Circle}
                games={openGames}
                loading={openGamesLoading}
                show={showOpenGames}
                onToggle={() => { setShowOpenGames((s) => !s); if (!showOpenGames) fetchOpenGames(); }}
                onRefresh={fetchOpenGames}
                badge={openGames.length}
                badgeColor="emerald"
              />
              <div className="border-t border-zinc-800/50" />
              <SidebarSection
                title="All Games"
                icon={List}
                games={allGames}
                loading={allGamesLoading}
                show={showAllGames}
                onToggle={() => { setShowAllGames((s) => !s); if (!showAllGames) fetchAllGames(); }}
                onRefresh={fetchAllGames}
                badge={allGames.length}
                maxH="max-h-96"
              />
              <div className="border-t border-zinc-800/50 px-4 py-3">
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-700 hover:text-emerald-400 transition-colors flex items-center gap-1"
                >
                  Escrow · {formatAddress(ESCROW_CONTRACT_ID)}{" "}
                  <ExternalLink size={8} />
                </a>
              </div>
            </div>
          </div>

          {/* ── Mobile Accordions ── */}
          <div className="xl:hidden w-full mt-2 space-y-2">
            {connectedAddress && (
              <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
                <SidebarSection
                  title="My Games"
                  icon={Users}
                  games={myGames}
                  loading={myGamesLoading}
                  show={showMyGames}
                  onToggle={() => { setShowMyGames((s) => !s); if (!showMyGames) fetchMyGames(); }}
                  onRefresh={fetchMyGames}
                />
              </div>
            )}
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
              <SidebarSection
                title="Open Games"
                icon={Circle}
                games={openGames}
                loading={openGamesLoading}
                show={showOpenGames}
                onToggle={() => { setShowOpenGames((s) => !s); if (!showOpenGames) fetchOpenGames(); }}
                onRefresh={fetchOpenGames}
                badge={openGames.length}
                badgeColor="emerald"
              />
            </div>
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
              <SidebarSection
                title="All Games"
                icon={List}
                games={allGames}
                loading={allGamesLoading}
                show={showAllGames}
                onToggle={() => { setShowAllGames((s) => !s); if (!showAllGames) fetchAllGames(); }}
                onRefresh={fetchAllGames}
                badge={allGames.length}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}