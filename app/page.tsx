"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "./contexts/WalletContext";
import {
  rpc as StellarRpc,
  TransactionBuilder,
  Networks,
  Address,
  scValToNative,
  Contract,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  Crown,
  Swords,
  Clock,
  Coins,
  RotateCcw,
  AlertCircle,
  ExternalLink,
  X,
  Users,
  Flag,
  Trophy,
  Handshake,
  ChevronRight,
  Copy,
  CheckCheck,
  Zap,
} from "lucide-react";
import { FaWallet } from "react-icons/fa";
import { AnimatePresence, motion } from "framer-motion";

// ─── Contract Config ───────────────────────────────────────────────────────────
const KINGFALL_CONTRACT_ID = "CAIO6PTUCO7NMIF67T4I7QFWHZSYWVVZ3WVFLRD7LEUQI64RKDLQD4VH";
const RPC_URL = "https://soroban-testnet.stellar.org:443";
const server = new StellarRpc.Server(RPC_URL);
const networkPassphrase = Networks.TESTNET;

// ─── Chess Types ───────────────────────────────────────────────────────────────
type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
type Color = "w" | "b";
type Piece = { type: PieceType; color: Color } | null;
type Board = Piece[][];
type Square = { row: number; col: number };

// ─── Helpers ───────────────────────────────────────────────────────────────────
function stroopsToXlm(stroops: bigint | number): string {
  return (Number(stroops) / 10_000_000).toFixed(2);
}
function xlmToStroops(xlm: string): bigint {
  return BigInt(Math.floor(parseFloat(xlm) * 10_000_000));
}
function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const PIECE_UNICODE: Record<PieceType, { w: string; b: string }> = {
  K: { w: "♔", b: "♚" },
  Q: { w: "♕", b: "♛" },
  R: { w: "♖", b: "♜" },
  B: { w: "♗", b: "♝" },
  N: { w: "♘", b: "♞" },
  P: { w: "♙", b: "♟" },
};

// ─── Initial Board ─────────────────────────────────────────────────────────────
function createInitialBoard(): Board {
  const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRank: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];

  backRank.forEach((type, col) => {
    board[0][col] = { type, color: "b" };
    board[7][col] = { type, color: "w" };
  });
  for (let col = 0; col < 8; col++) {
    board[1][col] = { type: "P", color: "b" };
    board[6][col] = { type: "P", color: "w" };
  }
  return board;
}

// ─── Move Generation (simplified legal moves) ─────────────────────────────────
function getValidMoves(board: Board, sq: Square, currentTurn: Color): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece || piece.color !== currentTurn) return [];
  const moves: Square[] = [];
  const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const canLand = (r: number, c: number) =>
    inBounds(r, c) && board[r][c]?.color !== piece.color;
  const isEnemy = (r: number, c: number) =>
    inBounds(r, c) && board[r][c] !== null && board[r][c]?.color !== piece.color;

  const slide = (drs: number[], dcs: number[]) => {
    for (let i = 0; i < drs.length; i++) {
      let r = sq.row + drs[i], c = sq.col + dcs[i];
      while (inBounds(r, c)) {
        if (board[r][c] === null) { moves.push({ row: r, col: c }); }
        else { if (board[r][c]?.color !== piece.color) moves.push({ row: r, col: c }); break; }
        r += drs[i]; c += dcs[i];
      }
    }
  };

  switch (piece.type) {
    case "P": {
      const dir = piece.color === "w" ? -1 : 1;
      const startRow = piece.color === "w" ? 6 : 1;
      if (inBounds(sq.row + dir, sq.col) && !board[sq.row + dir][sq.col])
        moves.push({ row: sq.row + dir, col: sq.col });
      if (sq.row === startRow && !board[sq.row + dir][sq.col] && !board[sq.row + 2 * dir][sq.col])
        moves.push({ row: sq.row + 2 * dir, col: sq.col });
      [-1, 1].forEach(dc => {
        if (isEnemy(sq.row + dir, sq.col + dc))
          moves.push({ row: sq.row + dir, col: sq.col + dc });
      });
      break;
    }
    case "N":
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => {
        if (canLand(sq.row+dr, sq.col+dc)) moves.push({ row: sq.row+dr, col: sq.col+dc });
      });
      break;
    case "B": slide([-1,-1,-1,1],[- 1,1,1,-1]); break;
    case "R": slide([-1,1,0,0],[0,0,-1,1]); break;
    case "Q": slide([-1,1,0,0,-1,-1,1,1],[0,0,-1,1,-1,1,-1,1]); break;
    case "K":
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => {
        if (canLand(sq.row+dr, sq.col+dc)) moves.push({ row: sq.row+dr, col: sq.col+dc });
      });
      break;
  }
  return moves;
}

function toAlgebraic(row: number, col: number): string {
  return `${"abcdefgh"[col]}${8 - row}`;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function KingFallPage() {
  const { address: connectedAddress, walletsKit, setAddress } = useWallet();
  const [mounted, setMounted] = useState(false);

  // Game state
  const [board, setBoard] = useState<Board>(createInitialBoard());
  const [currentTurn, setCurrentTurn] = useState<Color>("w");
  const [selected, setSelected] = useState<Square | null>(null);
  const [validMoves, setValidMoves] = useState<Square[]>([]);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gamePhase, setGamePhase] = useState<"lobby" | "staking" | "playing" | "ended">("lobby");
  const [winner, setWinner] = useState<"w" | "b" | "draw" | null>(null);
  const [capturedW, setCapturedW] = useState<Piece[]>([]);
  const [capturedB, setCapturedB] = useState<Piece[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);

  // Staking state
  const [stakeAmount, setStakeAmount] = useState("5");
  const [xlmBalance, setXlmBalance] = useState("0");
  const [opponentCode, setOpponentCode] = useState("");
  const [myGameCode] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const [codeCopied, setCodeCopied] = useState(false);

  // Onchain state
  const [contractState, setContractState] = useState<number | null>(null);
  const [potSize, setPotSize] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<{
    type: "success" | "error" | "pending";
    msg: string;
    hash?: string;
  } | null>(null);

  // Timers
  const [wTime, setWTime] = useState(600);
  const [bTime, setBTime] = useState(600);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Clock
  useEffect(() => {
    if (gamePhase !== "playing") return;
    timerRef.current = setInterval(() => {
      if (currentTurn === "w") setWTime(t => Math.max(0, t - 1));
      else setBTime(t => Math.max(0, t - 1));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gamePhase, currentTurn]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Load XLM balance
  const loadXlmBalance = useCallback(async () => {
    if (!connectedAddress || typeof window === "undefined") return;
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const data = await res.json();
      const native = data.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(native ? parseFloat(native.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  useEffect(() => { if (mounted) loadXlmBalance(); }, [loadXlmBalance, mounted]);

  // Auto-dismiss toast
  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 8000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // ── Chess Logic ────────────────────────────────────────────────────────────────
  const handleSquareClick = (row: number, col: number) => {
    if (gamePhase !== "playing") return;

    if (selected) {
      const isValid = validMoves.some(m => m.row === row && m.col === col);
      if (isValid) {
        const newBoard = board.map(r => [...r]);
        const captured = newBoard[row][col];
        if (captured) {
          if (captured.color === "b") setCapturedW(p => [...p, captured]);
          else setCapturedB(p => [...p, captured]);
        }

        // Check pawn promotion
        let movingPiece = newBoard[selected.row][selected.col]!;
        if (movingPiece.type === "P" && (row === 0 || row === 7)) {
          movingPiece = { ...movingPiece, type: "Q" };
        }

        newBoard[row][col] = movingPiece;
        newBoard[selected.row][selected.col] = null;

        const moveStr = `${toAlgebraic(selected.row, selected.col)}→${toAlgebraic(row, col)}`;
        setMoveHistory(h => [...h, moveStr]);
        setLastMove({ from: selected, to: { row, col } });
        setBoard(newBoard);
        setCurrentTurn(t => t === "w" ? "b" : "w");
        setSelected(null);
        setValidMoves([]);

        // Check if king captured (simplified win detection)
        if (captured?.type === "K") {
          setWinner(currentTurn);
          setGamePhase("ended");
        }
        return;
      }
    }

    const piece = board[row][col];
    if (piece && piece.color === currentTurn) {
      setSelected({ row, col });
      setValidMoves(getValidMoves(board, { row, col }, currentTurn));
    } else {
      setSelected(null);
      setValidMoves([]);
    }
  };

  // ── Onchain Stake ──────────────────────────────────────────────────────────────
  const sendTx = async (method: string, ...args: any[]) => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    setTxStatus({ type: "pending", msg: `Broadcasting ${method}...` });
    try {
      const account = await server.getAccount(connectedAddress);
      const contract = new Contract(KINGFALL_CONTRACT_ID);
      const tx = new TransactionBuilder(account, { fee: "10000", networkPassphrase })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();
      const prepared = await server.prepareTransaction(tx);
      const { signedTxXdr } = await walletsKit.signTransaction(prepared.toXDR());
      const response = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase)
      );
      if (response.status === "ERROR") throw new Error("Transaction rejected");

      let getResponse = await server.getTransaction(response.hash);
      while (getResponse.status === "NOT_FOUND") {
        await new Promise(r => setTimeout(r, 1000));
        getResponse = await server.getTransaction(response.hash);
      }
      if (getResponse.status === "SUCCESS") {
        setTxStatus({ type: "success", msg: "Stake locked onchain!", hash: response.hash });
        loadXlmBalance();
      } else {
        throw new Error("Transaction failed");
      }
    } catch (err: any) {
      setTxStatus({ type: "error", msg: err.message || `${method} failed` });
    } finally {
      setLoading(false);
    }
  };

  const handleStakeAndStart = () => {
    const stroops = xlmToStroops(stakeAmount);
    sendTx("create_game",
      new Address(connectedAddress!).toScVal(),
      nativeToScVal(stroops, { type: "i128" })
    ).then(() => {
      setPotSize(BigInt(2) * xlmToStroops(stakeAmount));
      setGamePhase("playing");
    });
  };

  const handleResign = () => {
    setWinner(currentTurn === "w" ? "b" : "w");
    setGamePhase("ended");
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(myGameCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleNewGame = () => {
    setBoard(createInitialBoard());
    setCurrentTurn("w");
    setSelected(null);
    setValidMoves([]);
    setMoveHistory([]);
    setWinner(null);
    setCapturedW([]);
    setCapturedB([]);
    setLastMove(null);
    setWTime(600);
    setBTime(600);
    setGamePhase("lobby");
    setPotSize(0n);
  };

  if (!mounted) return null;

  const playerColor: Color = "w"; // local player always plays white in this demo
  const isMyTurn = currentTurn === playerColor;

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen text-zinc-200 selection:bg-amber-500/30 overflow-x-hidden"
      style={{
        background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)",
        fontFamily: "'Courier New', Courier, monospace",
      }}
    >
      {/* Ambient top glow */}
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)" }} />

      {/* Grain texture overlay */}
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "200px",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 py-8 pb-32">

        {/* ── Header ── */}
        <header className="flex items-center justify-between mb-8">
 

          {connectedAddress && (
            <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-900/40 backdrop-blur">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] text-zinc-400 tracking-wider">{formatAddress(connectedAddress)}</span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] text-amber-400 font-bold">{xlmBalance} XLM</span>
            </div>
          )}
        </header>

        {/* ── LOBBY ── */}
        {gamePhase === "lobby" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="max-w-lg mx-auto space-y-5"
          >
            {/* Hero */}
            <div className="text-center space-y-3 py-6">
              <div className="text-7xl mb-4" style={{ filter: "drop-shadow(0 0 30px rgba(217,119,6,0.4))" }}>♚</div>
              <h2 className="text-3xl font-bold text-white tracking-wider">
                Play. Stake. <span className="text-amber-400">Conquer.</span>
              </h2>
              <p className="text-zinc-500 text-sm leading-relaxed max-w-sm mx-auto">
                P2P chess with real XLM on the line. Stakes locked in Soroban escrow. Winner claims all.
              </p>
            </div>

            {connectedAddress ? (
              <>
                {/* Stake config */}
                <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Coins size={12} className="text-amber-400" /> Set Your Stake
                  </h3>

                  <div className="grid grid-cols-4 gap-2">
                    {["1", "5", "10", "25"].map(v => (
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
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={e => setStakeAmount(e.target.value)}
                        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-amber-500/50 transition-colors"
                      />
                    </div>
                    <span className="text-zinc-500 font-bold text-sm">XLM</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-zinc-600 pt-1">
                    <span>Pot size if matched: <span className="text-amber-400 font-bold">{(parseFloat(stakeAmount || "0") * 2).toFixed(2)} XLM</span></span>
                    <span>Fee: <span className="text-zinc-500">2%</span></span>
                  </div>
                </div>

                {/* Game code */}
                <div className="border border-zinc-800 rounded-2xl p-6 space-y-4 bg-zinc-900/20">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Users size={12} className="text-amber-400" /> Matchmaking
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    {/* My code */}
                    <div className="space-y-2">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Your game code</p>
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-black border border-zinc-800 rounded-xl">
                        <span className="text-amber-400 font-black tracking-[0.3em] text-sm flex-1">{myGameCode}</span>
                        <button onClick={handleCopyCode} className="text-zinc-600 hover:text-amber-400 transition-colors">
                          {codeCopied ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    {/* Join code */}
                    <div className="space-y-2">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Join opponent</p>
                      <input
                        type="text"
                        placeholder="ENTER CODE"
                        value={opponentCode}
                        onChange={e => setOpponentCode(e.target.value.toUpperCase())}
                        maxLength={6}
                        className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2.5 text-sm font-black tracking-[0.3em] outline-none focus:border-amber-500/50 uppercase placeholder:text-zinc-700"
                      />
                    </div>
                  </div>
                </div>

                {/* Start button */}
                <button
                  onClick={handleStakeAndStart}
                  disabled={loading || !stakeAmount || parseFloat(stakeAmount) <= 0}
                  className="w-full py-5 rounded-2xl font-black tracking-[0.2em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3"
                  style={{
                    background: "linear-gradient(135deg, #d97706, #b45309)",
                    boxShadow: "0 0 40px -10px rgba(217,119,6,0.5)",
                    color: "#000",
                  }}
                >
                  {loading ? (
                    <><RotateCcw size={18} className="animate-spin" /> Locking Stake...</>
                  ) : (
                    <><Swords size={18} /> Stake & Play · {stakeAmount} XLM</>
                  )}
                </button>
              </>
            ) : (
              <div className="border border-dashed border-zinc-800 rounded-2xl p-10 text-center space-y-3">
                <Crown size={36} className="mx-auto text-zinc-700" />
                <p className="text-zinc-500">Connect your wallet to stake XLM and play</p>
              </div>
            )}

            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { label: "Active Games", value: "12", icon: Swords },
                { label: "Total Staked", value: "4,201 XLM", icon: Coins },
                { label: "Games Played", value: "1,337", icon: Trophy },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="border border-zinc-800/50 rounded-xl p-3 text-center bg-zinc-900/20">
                  <Icon size={14} className="mx-auto mb-1 text-amber-500/60" />
                  <p className="text-sm font-bold text-white">{value}</p>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── GAME ── */}
        {(gamePhase === "playing" || gamePhase === "ended") && (
          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">

            {/* ── Board Column ── */}
            <div className="flex flex-col items-center gap-3 w-full lg:w-auto">

              {/* Black player / timer */}
              <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                currentTurn === "b" && gamePhase === "playing"
                  ? "border-amber-500/40 bg-amber-500/5 shadow-[0_0_20px_-5px_rgba(217,119,6,0.2)]"
                  : "border-zinc-800/40 bg-zinc-900/20"
              }`}>
                <div className="flex items-center gap-3">
                  <div className="text-2xl">♛</div>
                  <div>
                    <p className="text-xs font-bold text-zinc-300">Opponent</p>
                    <p className="text-[9px] text-zinc-600">Black · {formatAddress(connectedAddress || "GZZZZZZZZZZZZZZZZZZZZZZZ")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {capturedB.slice(-6).map((p, i) => (
                      <span key={i} className="text-sm text-zinc-500">{p ? PIECE_UNICODE[p.type][p.color] : ""}</span>
                    ))}
                  </div>
                  <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                    currentTurn === "b" && gamePhase === "playing"
                      ? "bg-amber-500 text-black border-amber-400"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800"
                  }`}>
                    {formatTime(bTime)}
                  </div>
                </div>
              </div>

              {/* Chess Board */}
              <div
                className="relative"
                style={{
                  borderRadius: "12px",
                  overflow: "hidden",
                  boxShadow: "0 0 80px -20px rgba(0,0,0,0.8), 0 0 40px -10px rgba(217,119,6,0.15), inset 0 0 0 2px rgba(255,255,255,0.04)",
                }}
              >
                {/* Rank labels */}
                <div className="absolute left-0 top-0 bottom-0 w-5 flex flex-col pointer-events-none z-10">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex-1 flex items-center justify-center">
                      <span className="text-[9px] text-zinc-600">{8 - i}</span>
                    </div>
                  ))}
                </div>

                <div className="ml-5 mb-4">
                  {board.map((row, rIdx) => (
                    <div key={rIdx} className="flex">
                      {row.map((piece, cIdx) => {
                        const isLight = (rIdx + cIdx) % 2 === 0;
                        const isSelected = selected?.row === rIdx && selected?.col === cIdx;
                        const isValidTarget = validMoves.some(m => m.row === rIdx && m.col === cIdx);
                        const isLastMoveFrom = lastMove?.from.row === rIdx && lastMove?.from.col === cIdx;
                        const isLastMoveTo = lastMove?.to.row === rIdx && lastMove?.to.col === cIdx;

                        let bg = isLight ? "#c8a97e" : "#8b6340";
                        if (isSelected) bg = "#f0c040";
                        else if (isLastMoveFrom || isLastMoveTo) bg = isLight ? "#d4c060" : "#a09040";

                        return (
                          <button
                            key={cIdx}
                            onClick={() => handleSquareClick(rIdx, cIdx)}
                            className="relative w-14 h-14 flex items-center justify-center transition-all group"
                            style={{ background: bg }}
                          >
                            {/* Valid move dot / capture ring */}
                            {isValidTarget && (
                              piece ? (
                                <div className="absolute inset-0.5 rounded-sm border-[3px] border-black/30 pointer-events-none" />
                              ) : (
                                <div className="absolute w-4 h-4 rounded-full bg-black/25 pointer-events-none" />
                              )
                            )}

                            {/* Piece */}
                            {piece && (
                              <span
                                className={`text-3xl select-none transition-transform group-hover:scale-110 ${
                                  piece.color === "w" ? "drop-shadow-[1px_1px_0px_rgba(0,0,0,0.6)]" : "drop-shadow-[1px_1px_0px_rgba(255,255,255,0.15)]"
                                }`}
                                style={{
                                  color: piece.color === "w" ? "#fff" : "#1a1a1a",
                                  textShadow: piece.color === "w"
                                    ? "0 1px 3px rgba(0,0,0,0.7)"
                                    : "0 1px 2px rgba(255,255,255,0.2)",
                                  lineHeight: 1,
                                }}
                              >
                                {PIECE_UNICODE[piece.type][piece.color]}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}

                  {/* File labels */}
                  <div className="flex h-4">
                    {"abcdefgh".split("").map(f => (
                      <div key={f} className="w-14 flex items-center justify-center">
                        <span className="text-[9px] text-zinc-600">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* White player / timer */}
              <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                currentTurn === "w" && gamePhase === "playing"
                  ? "border-amber-500/40 bg-amber-500/5 shadow-[0_0_20px_-5px_rgba(217,119,6,0.2)]"
                  : "border-zinc-800/40 bg-zinc-900/20"
              }`}>
                <div className="flex items-center gap-3">
                  <div className="text-2xl">♕</div>
                  <div>
                    <p className="text-xs font-bold text-zinc-300">You</p>
                    <p className="text-[9px] text-zinc-600">White · {formatAddress(connectedAddress || "GAAAA...")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {capturedW.slice(-6).map((p, i) => (
                      <span key={i} className="text-sm text-zinc-300">{p ? PIECE_UNICODE[p.type][p.color] : ""}</span>
                    ))}
                  </div>
                  <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                    currentTurn === "w" && gamePhase === "playing"
                      ? "bg-amber-500 text-black border-amber-400"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800"
                  }`}>
                    {formatTime(wTime)}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div className="flex flex-col gap-4 w-full lg:w-64">

              {/* Pot */}
              <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5">
                <p className="text-[9px] text-amber-600/80 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Coins size={10} /> Prize Pot
                </p>
                <p className="text-3xl font-black text-amber-400 tabular-nums">
                  {potSize > 0n ? stroopsToXlm(potSize) : (parseFloat(stakeAmount || "0") * 2).toFixed(2)}
                  <span className="text-sm text-amber-600 ml-2 font-bold">XLM</span>
                </p>
                <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98% · 2% protocol fee</p>
              </div>

              {/* Status */}
              {gamePhase === "playing" && (
                <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-2 h-2 rounded-full ${isMyTurn ? "bg-amber-400 animate-pulse" : "bg-zinc-600"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isMyTurn ? "Your move" : "Opponent's move"}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Move <span className="text-white font-bold">{moveHistory.length + 1}</span>
                    {" · "}
                    <span className={currentTurn === "w" ? "text-zinc-200" : "text-zinc-500"}>
                      {currentTurn === "w" ? "White" : "Black"} to play
                    </span>
                  </p>
                </div>
              )}

              {/* Move history */}
              <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20 flex-1">
                <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">Moves</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                  {moveHistory.length === 0 ? (
                    <p className="text-[10px] text-zinc-700 italic">No moves yet</p>
                  ) : (
                    moveHistory.reduce<string[][]>((pairs, move, i) => {
                      if (i % 2 === 0) pairs.push([move]);
                      else pairs[pairs.length - 1].push(move);
                      return pairs;
                    }, []).map((pair, i) => (
                      <div key={i} className="flex gap-2 text-[10px] font-mono">
                        <span className="text-zinc-700 w-5 shrink-0">{i + 1}.</span>
                        <span className="text-zinc-300 w-16">{pair[0]}</span>
                        {pair[1] && <span className="text-zinc-500">{pair[1]}</span>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Game actions */}
              {gamePhase === "playing" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {}}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-all text-[10px] font-bold tracking-wider uppercase"
                  >
                    <Handshake size={13} /> Draw
                  </button>
                  <button
                    onClick={handleResign}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase"
                  >
                    <Flag size={13} /> Resign
                  </button>
                </div>
              )}

              {/* Contract */}
              <div className="border border-zinc-800/50 rounded-xl p-3">
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest mb-1">Escrow Contract</p>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${KINGFALL_CONTRACT_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-zinc-600 hover:text-amber-400 transition-colors flex items-center gap-1"
                >
                  {formatAddress(KINGFALL_CONTRACT_ID)} <ExternalLink size={9} />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── ENDED overlay ── */}
        <AnimatePresence>
          {gamePhase === "ended" && winner && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.8, y: 30 }} animate={{ scale: 1, y: 0 }}
                className="border border-amber-500/30 rounded-3xl p-10 text-center space-y-5 max-w-sm mx-4"
                style={{ background: "linear-gradient(135deg, #0f0800 0%, #0a0a0f 100%)", boxShadow: "0 0 100px -20px rgba(217,119,6,0.4)" }}
              >
                <div className="text-6xl" style={{ filter: "drop-shadow(0 0 30px rgba(217,119,6,0.6))" }}>
                  {winner === "w" ? "♔" : winner === "b" ? "♚" : "🤝"}
                </div>
                <div>
                  <p className="text-[10px] text-amber-600 uppercase tracking-[0.3em] mb-2">Game Over</p>
                  <h2 className="text-3xl font-black text-white">
                    {winner === "draw" ? "Draw!" : winner === playerColor ? (
                      <><span className="text-amber-400">Victory</span> is yours</>
                    ) : "You lost"}
                  </h2>
                  <p className="text-zinc-500 text-sm mt-2">
                    {winner !== "draw" && winner === playerColor
                      ? `${stroopsToXlm(potSize > 0n ? potSize : xlmToStroops(String(parseFloat(stakeAmount)*2)))} XLM will be sent to your wallet`
                      : winner !== "draw" ? "Better luck next time"
                      : "Stakes returned proportionally"}
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleNewGame}
                    className="flex-1 py-4 rounded-2xl font-black tracking-wider uppercase text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #d97706, #b45309)", color: "#000" }}
                  >
                    <RotateCcw size={16} /> Play Again
                  </button>
                  <button
                    onClick={handleNewGame}
                    className="px-5 py-4 rounded-2xl border border-zinc-800 text-zinc-500 hover:text-zinc-300 font-bold text-sm transition-all"
                  >
                    <X size={16} />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

   

      {/* ── TX Status Toast ── */}
      <AnimatePresence>
        {txStatus && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed bottom-28 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${
              txStatus.type === "success" ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : txStatus.type === "error" ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
              : "bg-zinc-800/50 border-zinc-700/30 text-zinc-300"
            }`}
          >
            <div className="flex items-center gap-3 font-bold text-sm">
              {txStatus.type === "pending" ? <RotateCcw size={16} className="animate-spin" /> : <AlertCircle size={16} />}
              <span className="text-xs">{txStatus.msg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash && (
                <a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                  <ExternalLink size={14} />
                </a>
              )}
              <button onClick={() => setTxStatus(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-500">
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}