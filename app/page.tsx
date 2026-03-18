"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "./contexts/WalletContext";
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
  Crown, Swords, Coins, RotateCcw, AlertCircle,
  ExternalLink, X, Users, Flag, Trophy, Handshake,
  Copy, CheckCheck, ChevronRight, List,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

// ─── Contract Config ──────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID = "CC4NHEPTQCYD2QH3A3SBDES654KNMANJIPFVV6X63MXUZY6WZW2OPO6N";
const NATIVE_TOKEN_ID    = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const RPC_URL            = "https://soroban-testnet.stellar.org:443";
const server             = new StellarRpc.Server(RPC_URL);
const networkPassphrase  = Networks.TESTNET;

// ─── Status helpers ───────────────────────────────────────────────────────────
const STATUS_MAP: Record<number, string> = {
  0: "Waiting", 1: "Active", 2: "Finished", 3: "Drawn", 4: "Cancelled", 5: "Timeout",
};
function parseStatus(raw: any): string {
  if (typeof raw === "number") return STATUS_MAP[raw] ?? String(raw);
  if (typeof raw === "object" && raw !== null) return Object.keys(raw)[0];
  return String(raw);
}

// ─── Chess Types ──────────────────────────────────────────────────────────────
type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
type Color     = "w" | "b";
type Piece     = { type: PieceType; color: Color } | null;
type Board     = Piece[][];
type Square    = { row: number; col: number };

function stroopsToXlm(s: bigint | number): string { return (Number(s) / 10_000_000).toFixed(2); }
function xlmToStroops(x: string): bigint { return BigInt(Math.floor(parseFloat(x) * 10_000_000)); }
function formatAddress(a: string): string { return `${a.slice(0, 6)}...${a.slice(-4)}`; }

const PIECE_UNICODE: Record<PieceType, { w: string; b: string }> = {
  K: { w: "♔", b: "♚" }, Q: { w: "♕", b: "♛" }, R: { w: "♖", b: "♜" },
  B: { w: "♗", b: "♝" }, N: { w: "♘", b: "♞" }, P: { w: "♙", b: "♟" },
};

// ─── Board helpers ────────────────────────────────────────────────────────────
function createInitialBoard(): Board {
  const b: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const back: PieceType[] = ["R","N","B","Q","K","B","N","R"];
  back.forEach((t, c) => { b[0][c] = { type: t, color: "b" }; b[7][c] = { type: t, color: "w" }; });
  for (let c = 0; c < 8; c++) { b[1][c] = { type: "P", color: "b" }; b[6][c] = { type: "P", color: "w" }; }
  return b;
}

// Parse a FEN string into a Board
function fenToBoard(fen: string): Board {
  const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const rows = fen.split(" ")[0].split("/");
  const pieceMap: Record<string, PieceType> = { p:"P", n:"N", b:"B", r:"R", q:"Q", k:"K" };
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { c += parseInt(ch); }
      else {
        const color: Color = ch === ch.toUpperCase() ? "w" : "b";
        board[r][c] = { type: pieceMap[ch.toLowerCase()] as PieceType, color };
        c++;
      }
    }
  });
  return board;
}

function getValidMoves(board: Board, sq: Square, turn: Color): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece || piece.color !== turn) return [];
  const moves: Square[] = [];
  const inB   = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const canL  = (r: number, c: number) => inB(r,c) && board[r][c]?.color !== piece.color;
  const isEn  = (r: number, c: number) => inB(r,c) && board[r][c] !== null && board[r][c]?.color !== piece.color;
  const slide = (drs: number[], dcs: number[]) => {
    for (let i = 0; i < drs.length; i++) {
      let r = sq.row+drs[i], c = sq.col+dcs[i];
      while (inB(r,c)) {
        if (!board[r][c]) moves.push({row:r,col:c});
        else { if (board[r][c]?.color !== piece.color) moves.push({row:r,col:c}); break; }
        r+=drs[i]; c+=dcs[i];
      }
    }
  };
  switch (piece.type) {
    case "P": {
      const d = piece.color==="w"?-1:1, sr = piece.color==="w"?6:1;
      if (inB(sq.row+d,sq.col) && !board[sq.row+d][sq.col]) moves.push({row:sq.row+d,col:sq.col});
      if (sq.row===sr && !board[sq.row+d][sq.col] && !board[sq.row+2*d][sq.col]) moves.push({row:sq.row+2*d,col:sq.col});
      [-1,1].forEach(dc => { if (isEn(sq.row+d,sq.col+dc)) moves.push({row:sq.row+d,col:sq.col+dc}); });
      break;
    }
    case "N": [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc])=>{ if(canL(sq.row+dr!,sq.col+dc!)) moves.push({row:sq.row+dr!,col:sq.col+dc!}); }); break;
    case "B": slide([-1,-1,-1,1],[-1,1,1,-1]); break;
    case "R": slide([-1,1,0,0],[0,0,-1,1]); break;
    case "Q": slide([-1,1,0,0,-1,-1,1,1],[0,0,-1,1,-1,1,-1,1]); break;
    case "K": [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc])=>{ if(canL(sq.row+dr!,sq.col+dc!)) moves.push({row:sq.row+dr!,col:sq.col+dc!}); }); break;
  }
  return moves;
}

function toSAN(piece: Piece, from: Square, to: Square, cap: Piece): string {
  if (!piece) return "";
  const f = "abcdefgh", toSq = `${f[to.col]}${8-to.row}`;
  if (piece.type==="P") return cap ? `${f[from.col]}x${toSq}` : toSq;
  return `${piece.type}${cap?"x":""}${toSq}`;
}

// ─── Contract Interaction ─────────────────────────────────────────────────────
async function sendTx(
  addr: string, kit: any, method: string, args: xdr.ScVal[],
  onStatus: (s: {type:"success"|"error"|"pending"; msg:string; hash?:string}) => void
): Promise<xdr.ScVal | null> {
  onStatus({ type:"pending", msg:`Broadcasting ${method}...` });
  try {
    const account  = await server.getAccount(addr);
    const contract = new Contract(ESCROW_CONTRACT_ID);
    const tx = new TransactionBuilder(account, { fee:"10000", networkPassphrase })
      .addOperation(contract.call(method, ...args)).setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const { signedTxXdr } = await kit.signTransaction(prepared.toXDR());
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
    if (response.status === "ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status === "NOT_FOUND") { await new Promise(x => setTimeout(x, 1000)); r = await server.getTransaction(response.hash); }
    if (r.status === "SUCCESS") {
      onStatus({ type:"success", msg:`${method} confirmed`, hash:response.hash });
      return (r as any).returnValue ?? null;
    }
    throw new Error("Transaction failed on-chain");
  } catch (err: any) {
    onStatus({ type:"error", msg:err.message || `${method} failed` });
    return null;
  }
}

async function simulateRead(gameId: bigint): Promise<any> {
  const acct = await server.getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
  const contract = new Contract(ESCROW_CONTRACT_ID);
  const tx = new TransactionBuilder(acct, { fee:"100", networkPassphrase })
    .addOperation(contract.call("get_game", nativeToScVal(gameId, { type:"u64" }))).setTimeout(30).build();
  const result = await server.simulateTransaction(tx);
  if ("result" in result && result.result?.retval) return scValToNative(result.result.retval);
  throw new Error("No result");
}

function outcomeScVal(o: "WhiteWins"|"BlackWins"|"Draw"): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(o)]);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface GameInfo {
  id: string; status: string; stake: string; white: string;
  black?: string; created_at: number; move_hash?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function KingFallPage() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams();

  // Board
  const [board, setBoard]             = useState<Board>(createInitialBoard());
  const [currentTurn, setCurrentTurn] = useState<Color>("w");
  const [selected, setSelected]       = useState<Square | null>(null);
  const [validMoves, setValidMoves]   = useState<Square[]>([]);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gamePhase, setGamePhase]     = useState<"lobby"|"waiting"|"playing"|"ended">("lobby");
  const [winner, setWinner]           = useState<"w"|"b"|"draw"|null>(null);
  const [capturedW, setCapturedW]     = useState<Piece[]>([]);
  const [capturedB, setCapturedB]     = useState<Piece[]>([]);
  const [lastMove, setLastMove]       = useState<{from:Square;to:Square}|null>(null);

  // Lobby
  const [stakeAmount, setStakeAmount]   = useState("5");
  const [xlmBalance, setXlmBalance]     = useState("0");
  const [joinGameId, setJoinGameId]     = useState("");
  const [lookupGameId, setLookupGameId] = useState("");
  const [lookupResult, setLookupResult] = useState<GameInfo|null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError]   = useState<string|null>(null);
  const [codeCopied, setCodeCopied]     = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Active games list
  const [activeGames, setActiveGames]       = useState<GameInfo[]>([]);
  const [activeGamesLoading, setActiveGamesLoading] = useState(false);
  const [showActiveGames, setShowActiveGames] = useState(false);

  // View game by ID (read-only board)
  const [viewGameId, setViewGameId]       = useState("");
  const [viewBoard, setViewBoard]         = useState<Board|null>(null);
  const [viewMoves, setViewMoves]         = useState<string[]>([]);
  const [viewGameInfo, setViewGameInfo]   = useState<GameInfo|null>(null);
  const [viewLoading, setViewLoading]     = useState(false);
  const [viewError, setViewError]         = useState<string|null>(null);
  const [showViewPanel, setShowViewPanel] = useState(false);

  // Onchain
  const [gameId, setGameId]       = useState<bigint|null>(null);
  const [potSize, setPotSize]     = useState<bigint>(0n);
  const [loading, setLoading]     = useState(false);
  const [drawOffered, setDrawOffered] = useState(false);
  const [txStatus, setTxStatus]   = useState<{type:"success"|"error"|"pending";msg:string;hash?:string}|null>(null);

  // Timers
  const [wTime, setWTime] = useState(600);
  const [bTime, setBTime] = useState(600);
  const timerRef = useRef<NodeJS.Timeout|null>(null);

  useEffect(() => { setMounted(true); }, []);

  // URL params auto-fill + lookup
  useEffect(() => {
    if (!mounted) return;
    const joinParam = searchParams.get("join");
    const stakeParam = searchParams.get("stake");
    if (!joinParam) return;
    setJoinGameId(joinParam);
    setLookupGameId(joinParam);
    if (stakeParam) setStakeAmount(stakeParam);
    setLookupLoading(true);
    (async () => {
      try {
        const data = await simulateRead(BigInt(joinParam));
        const status = parseStatus(data.status);
        const stakeXlm = (Number(data.stake) / 10_000_000).toFixed(2);
        setLookupResult({ id: joinParam, status, stake: stakeXlm, white: data.white, black: data.black, created_at: Number(data.created_at) });
        if (status === "Waiting") { setJoinGameId(joinParam); setStakeAmount(stakeXlm); }
      } catch { setLookupError("Game not found or invalid ID"); }
      finally { setLookupLoading(false); }
    })();
  }, [mounted, searchParams]);

  // Clock
  useEffect(() => {
    if (gamePhase !== "playing") return;
    timerRef.current = setInterval(() => {
      if (currentTurn === "w") setWTime(t => Math.max(0, t-1));
      else setBTime(t => Math.max(0, t-1));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gamePhase, currentTurn]);

  const formatTime = (s: number) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;

  const loadXlmBalance = useCallback(async () => {
    if (!connectedAddress) return;
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const d = await res.json();
      const n = d.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  useEffect(() => { if (mounted) loadXlmBalance(); }, [loadXlmBalance, mounted]);

  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 8000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // Poll for game transitions
  useEffect(() => {
    if (!gameId || (gamePhase !== "waiting" && gamePhase !== "playing")) return;
    const poll = setInterval(async () => {
      try {
        const data = await simulateRead(gameId);
        const status = parseStatus(data.status);
        if (gamePhase === "waiting" && status === "Active") {
          setPotSize(xlmToStroops(stakeAmount) * 2n);
          setGamePhase("playing");
        }
        if (gamePhase === "playing" && (status === "Finished" || status === "Drawn")) {
          setGamePhase("ended");
          setWinner(status === "Drawn" ? "draw" : data.white === connectedAddress ? "w" : "b");
        }
      } catch {}
    }, 4000);
    return () => clearInterval(poll);
  }, [gameId, gamePhase, connectedAddress, stakeAmount]);

  // ── Fetch active games list ───────────────────────────────────────────────
  const fetchActiveGames = useCallback(async () => {
    setActiveGamesLoading(true);
    try {
      const acct = await server.getAccount("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN");
      const contract = new Contract(ESCROW_CONTRACT_ID);
      const tx = new TransactionBuilder(acct, { fee:"100", networkPassphrase })
        .addOperation(contract.call("get_active_games")).setTimeout(30).build();
      const result = await server.simulateTransaction(tx);
      if ("result" in result && result.result?.retval) {
        const ids = scValToNative(result.result.retval) as bigint[];
        const games = await Promise.all(ids.map(async (id) => {
          try {
            const d = await simulateRead(id);
            return {
              id: id.toString(),
              status: parseStatus(d.status),
              stake: (Number(d.stake) / 10_000_000).toFixed(2),
              white: d.white,
              black: d.black,
              created_at: Number(d.created_at),
            } as GameInfo;
          } catch { return null; }
        }));
        setActiveGames(games.filter(Boolean) as GameInfo[]);
      }
    } catch {}
    finally { setActiveGamesLoading(false); }
  }, []);

  // ── View game board by ID ─────────────────────────────────────────────────
  const handleViewGame = async () => {
    if (!viewGameId) return;
    setViewLoading(true);
    setViewError(null);
    setViewBoard(null);
    setViewMoves([]);
    setViewGameInfo(null);
    try {
      const data = await simulateRead(BigInt(viewGameId));
      const status = parseStatus(data.status);
      const stakeXlm = (Number(data.stake) / 10_000_000).toFixed(2);
      setViewGameInfo({ id: viewGameId, status, stake: stakeXlm, white: data.white, black: data.black, created_at: Number(data.created_at), move_hash: data.move_hash });

      // Reconstruct board from move_hash / FEN if available
      // The escrow contract stores move_hash (PGN string) — parse moves from it
      const moveHashStr = typeof data.move_hash === "string" ? data.move_hash : "";
      const moves = moveHashStr && moveHashStr !== "" ? moveHashStr.split(" ").filter(Boolean) : [];
      setViewMoves(moves);

      // If no move hash, show starting position
      // Future: wire to game contract get_current_fen
      setViewBoard(createInitialBoard());
    } catch {
      setViewError("Game not found or invalid ID");
    } finally {
      setViewLoading(false);
    }
  };

  // ── Chess logic ───────────────────────────────────────────────────────────
  const handleSquareClick = (row: number, col: number) => {
    if (gamePhase !== "playing") return;
    if (selected) {
      const isValid = validMoves.some(m => m.row === row && m.col === col);
      if (isValid) {
        const nb = board.map(r => [...r]);
        const cap = nb[row][col];
        let mp = nb[selected.row][selected.col]!;
        if (cap) { if (cap.color==="b") setCapturedW(p=>[...p,cap]); else setCapturedB(p=>[...p,cap]); }
        if (mp.type==="P" && (row===0||row===7)) mp = { ...mp, type:"Q" };
        const san = toSAN(mp, selected, {row,col}, cap);
        nb[row][col] = mp; nb[selected.row][selected.col] = null;
        setMoveHistory(h => [...h, san]);
        setLastMove({ from:selected, to:{row,col} });
        setBoard(nb); setCurrentTurn(t => t==="w"?"b":"w");
        setSelected(null); setValidMoves([]);
        if (cap?.type === "K") handleGameOver(currentTurn==="w"?"WhiteWins":"BlackWins", [...moveHistory,san]);
        return;
      }
    }
    const piece = board[row][col];
    if (piece && piece.color === currentTurn) { setSelected({row,col}); setValidMoves(getValidMoves(board,{row,col},currentTurn)); }
    else { setSelected(null); setValidMoves([]); }
  };

  // ── Onchain actions ───────────────────────────────────────────────────────
  const tx = useCallback(async (method: string, args: xdr.ScVal[]) => {
    if (!connectedAddress || !walletsKit) return null;
    setLoading(true);
    const r = await sendTx(connectedAddress, walletsKit, method, args, setTxStatus);
    setLoading(false); loadXlmBalance(); return r;
  }, [connectedAddress, walletsKit, loadXlmBalance]);

  const handleStakeAndStart = async () => {
    if (!connectedAddress) return;
    const stroops = xlmToStroops(stakeAmount);
    const result = await tx("create_game", [
      new Address(connectedAddress).toScVal(),
      new Address(NATIVE_TOKEN_ID).toScVal(),
      nativeToScVal(stroops, { type:"i128" }),
      nativeToScVal(0n, { type:"u64" }),
    ]);
    if (result) {
      const id = scValToNative(result) as bigint;
      setGameId(id); setPotSize(xlmToStroops(stakeAmount)); setGamePhase("waiting");
    }
  };

  const handleJoinExistingGame = async () => {
    if (!connectedAddress || !joinGameId) return;
    const id = BigInt(joinGameId);
    setGameId(id);
    await tx("join_game", [
      nativeToScVal(id, { type:"u64" }),
      new Address(connectedAddress).toScVal(),
    ]);
    setPotSize(xlmToStroops(stakeAmount) * 2n);
    setGamePhase("playing");
  };

  const handleGameOver = async (outcome: "WhiteWins"|"BlackWins"|"Draw", moves: string[]) => {
    setWinner(outcome==="WhiteWins"?"w":outcome==="BlackWins"?"b":"draw");
    setGamePhase("ended");
    if (!gameId || !connectedAddress) return;
    await tx("finish_game", [
      nativeToScVal(gameId, { type:"u64" }),
      new Address(connectedAddress).toScVal(),
      outcomeScVal(outcome),
      nativeToScVal(moves.join(" "), { type:"string" }),
    ]);
  };

  const handleLookupGame = async () => {
    if (!lookupGameId) return;
    setLookupLoading(true); setLookupError(null); setLookupResult(null);
    try {
      const data = await simulateRead(BigInt(lookupGameId));
      const status = parseStatus(data.status);
      const stakeXlm = (Number(data.stake) / 10_000_000).toFixed(2);
      setLookupResult({ id:lookupGameId, status, stake:stakeXlm, white:data.white, black:data.black, created_at:Number(data.created_at) });
      if (status === "Waiting") { setJoinGameId(lookupGameId); setStakeAmount(stakeXlm); }
    } catch { setLookupError("Game not found or invalid ID"); }
    finally { setLookupLoading(false); }
  };

  const handleResign = () => handleGameOver(currentTurn==="w"?"BlackWins":"WhiteWins", moveHistory);

  const handleOfferDraw = async () => {
    if (!gameId || !connectedAddress) return;
    setDrawOffered(true);
    await tx("offer_draw", [nativeToScVal(gameId,{type:"u64"}), new Address(connectedAddress).toScVal()]);
  };

  const handleAcceptDraw = async () => {
    if (!gameId || !connectedAddress) return;
    await tx("accept_draw", [nativeToScVal(gameId,{type:"u64"}), new Address(connectedAddress).toScVal()]);
    handleGameOver("Draw", moveHistory);
  };

  const handleNewGame = () => {
    setBoard(createInitialBoard()); setCurrentTurn("w"); setSelected(null);
    setValidMoves([]); setMoveHistory([]); setWinner(null); setCapturedW([]); setCapturedB([]);
    setLastMove(null); setWTime(600); setBTime(600); setGamePhase("lobby");
    setPotSize(0n); setGameId(null); setDrawOffered(false); setInviteCopied(false);
  };

  if (!mounted) return null;

  const playerColor: Color = "w";
  const isMyTurn = currentTurn === playerColor;

  // ─── Board renderer (reusable) ────────────────────────────────────────────
  const renderBoard = (b: Board, interactive: boolean, sel: Square|null, valMoves: Square[], lastMv: {from:Square;to:Square}|null) => (
    <div className="relative" style={{ borderRadius:"12px", overflow:"hidden", boxShadow:"0 0 80px -20px rgba(0,0,0,0.8), 0 0 40px -10px rgba(217,119,6,0.15)" }}>
      <div className="absolute left-0 top-0 bottom-0 w-5 flex flex-col pointer-events-none z-10">
        {Array.from({length:8},(_,i) => <div key={i} className="flex-1 flex items-center justify-center"><span className="text-[9px] text-zinc-600">{8-i}</span></div>)}
      </div>
      <div className="ml-5 mb-4">
        {b.map((row, rIdx) => (
          <div key={rIdx} className="flex">
            {row.map((piece, cIdx) => {
              const isLight = (rIdx+cIdx)%2===0;
              const isSel   = sel?.row===rIdx && sel?.col===cIdx;
              const isVal   = valMoves.some(m=>m.row===rIdx&&m.col===cIdx);
              const isFrom  = lastMv?.from.row===rIdx && lastMv?.from.col===cIdx;
              const isTo    = lastMv?.to.row===rIdx && lastMv?.to.col===cIdx;
              let bg = isLight ? "#c8a97e" : "#8b6340";
              if (isSel) bg = "#f0c040";
              else if (isFrom||isTo) bg = isLight?"#d4c060":"#a09040";
              return (
                <button key={cIdx} onClick={() => interactive && handleSquareClick(rIdx,cIdx)}
                  className="relative w-14 h-14 flex items-center justify-center group" style={{background:bg}}>
                  {isVal && (piece ? <div className="absolute inset-0.5 rounded-sm border-[3px] border-black/30 pointer-events-none"/> : <div className="absolute w-4 h-4 rounded-full bg-black/25 pointer-events-none"/>)}
                  {piece && <span className="text-3xl select-none transition-transform group-hover:scale-110"
                    style={{ color:piece.color==="w"?"#fff":"#1a1a1a", textShadow:piece.color==="w"?"0 1px 3px rgba(0,0,0,0.7)":"0 1px 2px rgba(255,255,255,0.2)", lineHeight:1 }}>
                    {PIECE_UNICODE[piece.type][piece.color]}
                  </span>}
                </button>
              );
            })}
          </div>
        ))}
        <div className="flex h-4">{"abcdefgh".split("").map(f=><div key={f} className="w-14 flex items-center justify-center"><span className="text-[9px] text-zinc-600">{f}</span></div>)}</div>
      </div>
    </div>
  );

  // ─── Status badge ─────────────────────────────────────────────────────────
  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
      status==="Waiting"  ? "bg-emerald-500/20 text-emerald-400" :
      status==="Active"   ? "bg-amber-500/20 text-amber-400" :
      status==="Finished" ? "bg-blue-500/20 text-blue-400" :
      "bg-zinc-700/50 text-zinc-500"
    }`}>{status==="Waiting"?"Open":status}</span>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen text-zinc-200 selection:bg-amber-500/30 overflow-x-hidden"
      style={{ background:"radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily:"'Courier New', Courier, monospace" }}>
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{background:"radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)"}}/>
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none"
        style={{ backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize:"200px" }}/>

      <div className="relative max-w-5xl mx-auto px-4 py-8 pb-32">

        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          {connectedAddress && (
            <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-900/40 backdrop-blur">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
              <span className="text-[10px] text-zinc-400 tracking-wider">{formatAddress(connectedAddress)}</span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] text-amber-400 font-bold">{xlmBalance} XLM</span>
            </div>
          )}
          {gameId && (
            <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-900/40 backdrop-blur">
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Game</span>
              <span className="text-[10px] text-amber-400 font-black">#{gameId.toString()}</span>
            </div>
          )}
        </header>

        {/* ── LOBBY ── */}
        {gamePhase === "lobby" && (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="max-w-lg mx-auto space-y-5">

            <div className="text-center space-y-3 py-6">
              <div className="text-7xl mb-4" style={{filter:"drop-shadow(0 0 30px rgba(217,119,6,0.4))"}}>♚</div>
              <h2 className="text-3xl font-bold text-white tracking-wider">Play. Stake. <span className="text-amber-400">Conquer.</span></h2>
              <p className="text-zinc-500 text-sm leading-relaxed max-w-sm mx-auto">P2P chess with real XLM on the line. Stakes locked in Soroban escrow. Winner claims all.</p>
            </div>

            {connectedAddress ? (
              <>
                {/* Create Game */}
                <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Coins size={12} className="text-amber-400"/> Create Game</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {["1","5","10","25"].map(v=>(
                      <button key={v} onClick={()=>setStakeAmount(v)}
                        className={`py-3 rounded-xl text-sm font-black tracking-wider transition-all border ${stakeAmount===v?"bg-amber-500/20 border-amber-500/50 text-amber-400":"bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"}`}>
                        {v} XLM
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-3 items-center">
                    <input type="number" value={stakeAmount} onChange={e=>setStakeAmount(e.target.value)}
                      className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-lg font-bold outline-none focus:border-amber-500/50 transition-colors"/>
                    <span className="text-zinc-500 font-bold text-sm">XLM</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-600">
                    <span>Pot if matched: <span className="text-amber-400 font-bold">{(parseFloat(stakeAmount||"0")*2).toFixed(2)} XLM</span></span>
                    <span>Fee: <span className="text-zinc-500">1.5%</span></span>
                  </div>
                  <button onClick={handleStakeAndStart} disabled={loading||!stakeAmount||parseFloat(stakeAmount)<=0}
                    className="w-full py-4 rounded-xl font-black tracking-[0.15em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3"
                    style={{background:"linear-gradient(135deg, #d97706, #b45309)",boxShadow:"0 0 30px -8px rgba(217,119,6,0.5)",color:"#000"}}>
                    {loading?<><RotateCcw size={16} className="animate-spin"/> Locking Stake...</>:<><Swords size={16}/> Create & Stake {stakeAmount} XLM</>}
                  </button>
                </div>

                {/* Join Game by ID */}
                <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/20">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Users size={12} className="text-amber-400"/> Join Game by ID</h3>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Enter Game ID" value={lookupGameId}
                      onChange={e=>{setLookupGameId(e.target.value);setLookupResult(null);setLookupError(null);}}
                      onKeyDown={e=>e.key==="Enter"&&handleLookupGame()}
                      className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-zinc-600 transition-colors placeholder:text-zinc-700"/>
                    <button onClick={handleLookupGame} disabled={lookupLoading||!lookupGameId}
                      className="px-5 py-3 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white active:scale-95">
                      {lookupLoading?<RotateCcw size={14} className="animate-spin"/>:"Search"}
                    </button>
                  </div>
                  {lookupError && <p className="text-[10px] text-rose-400 flex items-center gap-1"><AlertCircle size={10}/> {lookupError}</p>}
                  {lookupResult && (
                    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
                      className={`rounded-xl border overflow-hidden ${lookupResult.status==="Waiting"?"border-emerald-500/25":lookupResult.status==="Active"?"border-amber-500/25":"border-zinc-700/40"}`}>
                      <div className={`px-4 py-2.5 flex items-center justify-between ${lookupResult.status==="Waiting"?"bg-emerald-500/[0.06]":lookupResult.status==="Active"?"bg-amber-500/[0.06]":"bg-zinc-900/60"}`}>
                        <span className="text-[10px] text-zinc-400 font-mono">Game #{lookupResult.id}</span>
                        <StatusBadge status={lookupResult.status}/>
                      </div>
                      <div className="px-4 py-3 grid grid-cols-2 gap-4 text-[10px] border-t border-zinc-800/50">
                        <div>
                          <p className="text-zinc-600 uppercase tracking-widest mb-1">Creator</p>
                          <p className="text-zinc-300 font-mono">{formatAddress(lookupResult.white)}</p>
                        </div>
                        <div>
                          <p className="text-zinc-600 uppercase tracking-widest mb-1">Required stake</p>
                          <p className="text-amber-400 font-black text-base">{lookupResult.stake} XLM</p>
                        </div>
                      </div>
                      <div className="px-4 pb-4">
                        {lookupResult.status === "Waiting" ? (
                          <button onClick={handleJoinExistingGame} disabled={loading}
                            className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] flex items-center justify-center gap-2">
                            {loading?<><RotateCcw size={14} className="animate-spin"/> Joining...</>:<>Stake & Join {lookupResult.stake} XLM</>}
                          </button>
                        ) : (
                          <p className="text-[9px] text-zinc-600 text-center py-1">
                            {lookupResult.status==="Active"?"Game already in progress":"This game is no longer open"}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* View Game Board */}
                <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/20">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><List size={12} className="text-amber-400"/> View Game by ID</h3>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Enter Game ID" value={viewGameId}
                      onChange={e=>{setViewGameId(e.target.value);setViewBoard(null);setViewError(null);}}
                      onKeyDown={e=>e.key==="Enter"&&handleViewGame()}
                      className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-zinc-600 transition-colors placeholder:text-zinc-700"/>
                    <button onClick={handleViewGame} disabled={viewLoading||!viewGameId}
                      className="px-5 py-3 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white active:scale-95">
                      {viewLoading?<RotateCcw size={14} className="animate-spin"/>:"View"}
                    </button>
                  </div>
                  {viewError && <p className="text-[10px] text-rose-400 flex items-center gap-1"><AlertCircle size={10}/> {viewError}</p>}
                  {viewGameInfo && viewBoard && (
                    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-400 font-mono">Game #{viewGameInfo.id}</span>
                        <StatusBadge status={viewGameInfo.status}/>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-[10px]">
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">White</p><p className="text-zinc-300 font-mono">{formatAddress(viewGameInfo.white)}</p></div>
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Black</p><p className="text-zinc-300 font-mono">{viewGameInfo.black && viewGameInfo.black !== viewGameInfo.white ? formatAddress(viewGameInfo.black) : "—"}</p></div>
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Stake</p><p className="text-amber-400 font-bold">{viewGameInfo.stake} XLM each</p></div>
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Pot</p><p className="text-white font-bold">{(parseFloat(viewGameInfo.stake)*2).toFixed(2)} XLM</p></div>
                      </div>
                      <div className="overflow-x-auto">
                        {renderBoard(viewBoard, false, null, [], null)}
                      </div>
                      {viewMoves.length > 0 && (
                        <div className="border border-zinc-800/50 rounded-xl p-4">
                          <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">Move History ({viewMoves.length} moves)</p>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {viewMoves.reduce<string[][]>((pairs,m,i)=>{ if(i%2===0) pairs.push([m]); else pairs[pairs.length-1].push(m); return pairs; },[])
                              .map((pair,i)=>(
                                <div key={i} className="flex gap-2 text-[10px] font-mono">
                                  <span className="text-zinc-700 w-5 shrink-0">{i+1}.</span>
                                  <span className="text-zinc-300 w-16">{pair[0]}</span>
                                  {pair[1] && <span className="text-zinc-500">{pair[1]}</span>}
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>

                {/* Active Games List */}
                <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20">
                  <button onClick={()=>{ setShowActiveGames(s=>!s); if(!showActiveGames) fetchActiveGames(); }}
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Trophy size={12} className="text-amber-400"/> Active Games</h3>
                    <ChevronRight size={14} className={`text-zinc-600 transition-transform ${showActiveGames?"rotate-90":""}`}/>
                  </button>
                  {showActiveGames && (
                    <div className="border-t border-zinc-800/50 px-5 pb-4 pt-3 space-y-2">
                      {activeGamesLoading ? (
                        <div className="flex items-center gap-2 py-4 justify-center"><RotateCcw size={14} className="animate-spin text-zinc-600"/><span className="text-[10px] text-zinc-600">Loading games...</span></div>
                      ) : activeGames.length === 0 ? (
                        <p className="text-[10px] text-zinc-600 text-center py-4">No active games waiting for players</p>
                      ) : (
                        activeGames.map(g => (
                          <div key={g.id} className="flex items-center justify-between py-2.5 border-b border-zinc-800/40 last:border-0">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-amber-400 font-black font-mono">#{g.id}</span>
                              <div>
                                <p className="text-[10px] text-zinc-300 font-mono">{formatAddress(g.white)}</p>
                                <p className="text-[9px] text-zinc-600">{g.stake} XLM stake</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge status={g.status}/>
                              {g.status === "Waiting" && (
                                <button onClick={()=>{ setLookupGameId(g.id); setJoinGameId(g.id); setStakeAmount(g.stake); setLookupResult(g); }}
                                  className="text-[9px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-bold uppercase tracking-wider">
                                  Join
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      <button onClick={fetchActiveGames} className="w-full py-2 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest transition-colors flex items-center justify-center gap-1">
                        <RotateCcw size={10}/> Refresh
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="border border-dashed border-zinc-800 rounded-2xl p-10 text-center space-y-3">
                <Crown size={36} className="mx-auto text-zinc-700"/>
                <p className="text-zinc-500">Connect your wallet to stake XLM and play</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 pt-2">
              {[{label:"Active Games",value:"12",icon:Swords},{label:"Total Staked",value:"4,201 XLM",icon:Coins},{label:"Games Played",value:"1,337",icon:Trophy}].map(({label,value,icon:Icon})=>(
                <div key={label} className="border border-zinc-800/50 rounded-xl p-3 text-center bg-zinc-900/20">
                  <Icon size={14} className="mx-auto mb-1 text-amber-500/60"/>
                  <p className="text-sm font-bold text-white">{value}</p>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── WAITING ── */}
        {gamePhase === "waiting" && gameId && (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="max-w-lg mx-auto space-y-5">
            <div className="text-center space-y-3 py-6">
              <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-amber-500/20 animate-ping"/>
                <div className="absolute inset-2 rounded-full border-2 border-amber-500/30 animate-pulse"/>
                <div className="text-4xl relative z-10">♛</div>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-wider">Waiting for <span className="text-amber-400">Opponent</span></h2>
              <p className="text-zinc-500 text-sm">Your {stakeAmount} XLM is locked in escrow · Game #{gameId.toString()}</p>
            </div>
            <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Users size={12} className="text-amber-400"/> Invite a Friend</h3>
              <div className="space-y-2">
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Share this invite link</p>
                <div className="flex items-center gap-2 px-3 py-3 bg-black border border-zinc-800 rounded-xl">
                  <span className="text-zinc-400 text-xs font-mono flex-1 truncate">{typeof window!=="undefined"?`${window.location.origin}/play?join=${gameId.toString()}&stake=${stakeAmount}`:""}</span>
                  <button onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/play?join=${gameId!.toString()}&stake=${stakeAmount}`);setInviteCopied(true);setTimeout(()=>setInviteCopied(false),2000);}} className="shrink-0 text-zinc-600 hover:text-amber-400 transition-colors">
                    {inviteCopied?<CheckCheck size={14} className="text-emerald-400"/>:<Copy size={14}/>}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Game ID</p>
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-black border border-zinc-800 rounded-xl">
                    <span className="text-amber-400 font-black text-sm flex-1">#{gameId.toString()}</span>
                    <button onClick={()=>{navigator.clipboard.writeText(gameId!.toString());setCodeCopied(true);setTimeout(()=>setCodeCopied(false),2000);}} className="text-zinc-600 hover:text-amber-400 transition-colors">
                      {codeCopied?<CheckCheck size={12} className="text-emerald-400"/>:<Copy size={12}/>}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Stake to match</p>
                  <div className="px-3 py-2.5 bg-black border border-zinc-800 rounded-xl"><span className="text-amber-400 font-black text-sm">{stakeAmount} XLM</span></div>
                </div>
              </div>
            </div>
            <div className="border border-zinc-800/50 rounded-2xl p-5 bg-zinc-900/20 space-y-3">
              <div className="flex items-center justify-between"><p className="text-[10px] text-zinc-600 uppercase tracking-widest">Your stake</p><p className="text-sm font-bold text-amber-400">{stakeAmount} XLM locked</p></div>
              <div className="flex items-center justify-between"><p className="text-[10px] text-zinc-600 uppercase tracking-widest">Pot if matched</p><p className="text-sm font-bold text-white">{(parseFloat(stakeAmount)*2).toFixed(2)} XLM</p></div>
              <div className="flex items-center justify-between"><p className="text-[10px] text-zinc-600 uppercase tracking-widest">Winner receives</p><p className="text-sm font-bold text-emerald-400">{(parseFloat(stakeAmount)*2*0.985).toFixed(2)} XLM</p></div>
              <div className="flex items-center gap-2 pt-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/><p className="text-[10px] text-zinc-500">Polling for opponent every 4s...</p></div>
            </div>
            <button onClick={handleNewGame} className="w-full py-3 rounded-xl border border-zinc-800 text-zinc-500 hover:text-rose-400 hover:border-rose-500/30 transition-all text-[10px] font-bold tracking-widest uppercase">Cancel & Reclaim Stake</button>
          </motion.div>
        )}

        {/* ── GAME ── */}
        {(gamePhase==="playing"||gamePhase==="ended") && (
          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
            <div className="flex flex-col items-center gap-3 w-full lg:w-auto">
              {/* Black player */}
              <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${currentTurn==="b"&&gamePhase==="playing"?"border-amber-500/40 bg-amber-500/5":"border-zinc-800/40 bg-zinc-900/20"}`}>
                <div className="flex items-center gap-3"><div className="text-2xl">♛</div><div><p className="text-xs font-bold text-zinc-300">Opponent</p><p className="text-[9px] text-zinc-600">Black</p></div></div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">{capturedB.slice(-6).map((p,i)=><span key={i} className="text-sm text-zinc-500">{p?PIECE_UNICODE[p.type][p.color]:""}</span>)}</div>
                  <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${currentTurn==="b"&&gamePhase==="playing"?"bg-amber-500 text-black border-amber-400":"bg-zinc-900 text-zinc-400 border-zinc-800"}`}>{formatTime(bTime)}</div>
                </div>
              </div>

              {renderBoard(board, true, selected, validMoves, lastMove)}

              {/* White player */}
              <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${currentTurn==="w"&&gamePhase==="playing"?"border-amber-500/40 bg-amber-500/5":"border-zinc-800/40 bg-zinc-900/20"}`}>
                <div className="flex items-center gap-3"><div className="text-2xl">♕</div><div><p className="text-xs font-bold text-zinc-300">You</p><p className="text-[9px] text-zinc-600">White · {formatAddress(connectedAddress||"GAAAA...")}</p></div></div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">{capturedW.slice(-6).map((p,i)=><span key={i} className="text-sm text-zinc-300">{p?PIECE_UNICODE[p.type][p.color]:""}</span>)}</div>
                  <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${currentTurn==="w"&&gamePhase==="playing"?"bg-amber-500 text-black border-amber-400":"bg-zinc-900 text-zinc-400 border-zinc-800"}`}>{formatTime(wTime)}</div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="flex flex-col gap-4 w-full lg:w-64">
              <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5">
                <p className="text-[9px] text-amber-600/80 uppercase tracking-widest mb-2 flex items-center gap-1"><Coins size={10}/> Prize Pot</p>
                <p className="text-3xl font-black text-amber-400 tabular-nums">{potSize>0n?stroopsToXlm(potSize):(parseFloat(stakeAmount||"0")*2).toFixed(2)}<span className="text-sm text-amber-600 ml-2 font-bold">XLM</span></p>
                <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98.5% · 1.5% protocol fee</p>
              </div>
              {gamePhase==="playing"&&(
                <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
                  <div className="flex items-center gap-2 mb-3"><div className={`w-2 h-2 rounded-full ${isMyTurn?"bg-amber-400 animate-pulse":"bg-zinc-600"}`}/><span className="text-[10px] uppercase tracking-widest text-zinc-500">{isMyTurn?"Your move":"Opponent's move"}</span></div>
                  <p className="text-[10px] text-zinc-600">Move <span className="text-white font-bold">{moveHistory.length+1}</span> · <span className={currentTurn==="w"?"text-zinc-200":"text-zinc-500"}>{currentTurn==="w"?"White":"Black"} to play</span></p>
                  {gameId&&<p className="text-[9px] text-zinc-700 mt-2">On-chain game <span className="text-amber-600">#{gameId.toString()}</span></p>}
                </div>
              )}
              <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20 flex-1">
                <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">Moves</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {moveHistory.length===0?<p className="text-[10px] text-zinc-700 italic">No moves yet</p>:
                    moveHistory.reduce<string[][]>((p,m,i)=>{if(i%2===0)p.push([m]);else p[p.length-1].push(m);return p;},[])
                      .map((pair,i)=><div key={i} className="flex gap-2 text-[10px] font-mono"><span className="text-zinc-700 w-5 shrink-0">{i+1}.</span><span className="text-zinc-300 w-16">{pair[0]}</span>{pair[1]&&<span className="text-zinc-500">{pair[1]}</span>}</div>)
                  }
                </div>
              </div>
              {gamePhase==="playing"&&(
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={drawOffered?handleAcceptDraw:handleOfferDraw} disabled={loading}
                    className={`flex items-center justify-center gap-1.5 py-3 rounded-xl border transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40 ${drawOffered?"border-emerald-500/40 text-emerald-400 bg-emerald-500/5":"border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"}`}>
                    <Handshake size={13}/> {drawOffered?"Accept":"Draw"}
                  </button>
                  <button onClick={handleResign} disabled={loading}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40">
                    <Flag size={13}/> Resign
                  </button>
                </div>
              )}
              <div className="border border-zinc-800/50 rounded-xl p-3">
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest mb-1">Escrow Contract</p>
                <a href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] font-mono text-zinc-600 hover:text-amber-400 transition-colors flex items-center gap-1">
                  {formatAddress(ESCROW_CONTRACT_ID)} <ExternalLink size={9}/>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── ENDED overlay ── */}
        <AnimatePresence>
          {gamePhase==="ended"&&winner&&(
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <motion.div initial={{scale:0.8,y:30}} animate={{scale:1,y:0}}
                className="border border-amber-500/30 rounded-3xl p-10 text-center space-y-5 max-w-sm mx-4"
                style={{background:"linear-gradient(135deg, #0f0800 0%, #0a0a0f 100%)",boxShadow:"0 0 100px -20px rgba(217,119,6,0.4)"}}>
                <div className="text-6xl" style={{filter:"drop-shadow(0 0 30px rgba(217,119,6,0.6))"}}>{winner==="w"?"♔":winner==="b"?"♚":"🤝"}</div>
                <div>
                  <p className="text-[10px] text-amber-600 uppercase tracking-[0.3em] mb-2">Game Over</p>
                  <h2 className="text-3xl font-black text-white">{winner==="draw"?"Draw!":winner===playerColor?<><span className="text-amber-400">Victory</span> is yours</>:"You lost"}</h2>
                  <p className="text-zinc-500 text-sm mt-2">{winner==="draw"?"Stakes returned proportionally":winner===playerColor?`${stroopsToXlm(potSize*985n/1000n)} XLM sent to your wallet`:"Better luck next time"}</p>
                  {txStatus?.hash&&<a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-amber-600/70 hover:text-amber-400 mt-2 transition-colors">View transaction <ExternalLink size={9}/></a>}
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={handleNewGame} className="flex-1 py-4 rounded-2xl font-black tracking-wider uppercase text-sm active:scale-95 flex items-center justify-center gap-2" style={{background:"linear-gradient(135deg, #d97706, #b45309)",color:"#000"}}><RotateCcw size={16}/> Play Again</button>
                  <button onClick={handleNewGame} className="px-5 py-4 rounded-2xl border border-zinc-800 text-zinc-500 hover:text-zinc-300 font-bold text-sm"><X size={16}/></button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* TX Toast */}
      <AnimatePresence>
        {txStatus&&(
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.95}}
            className={`fixed bottom-28 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${txStatus.type==="success"?"bg-amber-500/10 border-amber-500/20 text-amber-400":txStatus.type==="error"?"bg-rose-500/10 border-rose-500/20 text-rose-400":"bg-zinc-800/50 border-zinc-700/30 text-zinc-300"}`}>
            <div className="flex items-center gap-3 font-bold text-sm">{txStatus.type==="pending"?<RotateCcw size={16} className="animate-spin"/>:<AlertCircle size={16}/>}<span className="text-xs">{txStatus.msg}</span></div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash&&<a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-white/10 rounded-lg"><ExternalLink size={14}/></a>}
              <button onClick={()=>setTxStatus(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500"><X size={14}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}