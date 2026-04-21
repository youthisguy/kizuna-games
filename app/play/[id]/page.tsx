"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@/app/contexts/WalletContext";
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
  Coins,
  RotateCcw,
  AlertCircle,
  ExternalLink,
  X,
  Users,
  Flag,
  Handshake,
  Copy,
  CheckCheck,
  ArrowLeft,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useKingFallAuth } from "@/app/hooks/Usekingfallauth";
import { ClockIcon, EyeIcon } from "@heroicons/react/24/solid";

import {
  readCachedGame,
  writeGameCache,
  parseFen,
  parseMoves,
} from "@/app/lib/gameCache";

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

const TIMER_SECONDS = 86400; // 24 hours

const STATUS_MAP: Record<number, string> = {
  0: "Waiting",
  1: "Active",
  2: "Finished",
  3: "Drawn",
  4: "Cancelled",
  5: "Timeout",
};

function parseStatus(r: any): string {
  if (typeof r === "number") return STATUS_MAP[r] ?? String(r);
  if (Array.isArray(r)) return String(r[0]);
  if (typeof r === "object" && r !== null) return Object.keys(r)[0];
  return String(r);
}
function stroopsToXlm(s: bigint | number) {
  return (Number(s) / 10_000_000).toFixed(2);
}
function formatAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
function formatTime(s: number) {
  if (s >= 3600)
    return `${Math.floor(s / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
type Color = "w" | "b";
type Piece = { type: PieceType; color: Color } | null;
type Board = Piece[][];
type Square = { row: number; col: number };
type CastlingRights = {
  wK: boolean; // white kingside
  wQ: boolean; // white queenside
  bK: boolean; // black kingside
  bQ: boolean; // black queenside
};

const PIECE_UNICODE: Record<PieceType, { w: string; b: string }> = {
  K: { w: "♔", b: "♚" },
  Q: { w: "♕", b: "♛" },
  R: { w: "♖", b: "♜" },
  B: { w: "♗", b: "♝" },
  N: { w: "♘", b: "♞" },
  P: { w: "♙", b: "♟" },
};

function createInitialBoard(): Board {
  const b: Board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));
  (["R", "N", "B", "Q", "K", "B", "N", "R"] as PieceType[]).forEach((t, c) => {
    b[0][c] = { type: t, color: "b" };
    b[7][c] = { type: t, color: "w" };
  });
  for (let c = 0; c < 8; c++) {
    b[1][c] = { type: "P", color: "b" };
    b[6][c] = { type: "P", color: "w" };
  }
  return b;
}

function fenToBoard(fen: string): Board {
  const board: Board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));
  const pm: Record<string, PieceType> = {
    p: "P",
    n: "N",
    b: "B",
    r: "R",
    q: "Q",
    k: "K",
  };
  fen
    .split(" ")[0]
    .split("/")
    .forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) c += parseInt(ch);
        else {
          board[r][c] = {
            type: pm[ch.toLowerCase()] as PieceType,
            color: ch === ch.toUpperCase() ? "w" : "b",
          };
          c++;
        }
      }
    });
  return board;
}

function boardToFen(board: Board, turn: Color, moveCount: number): string {
  const rows = board.map((row) => {
    let s = "",
      e = 0;
    for (const p of row) {
      if (!p) e++;
      else {
        if (e) {
          s += e;
          e = 0;
        }
        s += p.color === "w" ? p.type : p.type.toLowerCase();
      }
    }
    return e ? s + e : s;
  });
  return `${rows.join("/")} ${turn} - - 0 ${Math.floor(moveCount / 2) + 1}`;
}

function toSAN(piece: Piece, from: Square, to: Square, cap: Piece): string {
  if (!piece) return "";
  const f = "abcdefgh",
    toSq = `${f[to.col]}${8 - to.row}`;
  if (piece.type === "P") return cap ? `${f[from.col]}x${toSq}` : toSq;
  return `${piece.type}${cap ? "x" : ""}${toSq}`;
}

// ─── Chess Logic ──────────────────────────────────────────────────────────────
function updateCastlingRights(
  rights: CastlingRights,
  from: Square,
  piece: Piece
): CastlingRights {
  const r = { ...rights };
  if (!piece) return r;
  // King moves revoke both rights for that color
  if (piece.type === "K") {
    if (piece.color === "w") {
      r.wK = false;
      r.wQ = false;
    } else {
      r.bK = false;
      r.bQ = false;
    }
  }
  // Rook moves revoke one side
  if (piece.type === "R") {
    if (from.row === 7 && from.col === 7) r.wK = false;
    if (from.row === 7 && from.col === 0) r.wQ = false;
    if (from.row === 0 && from.col === 7) r.bK = false;
    if (from.row === 0 && from.col === 0) r.bQ = false;
  }
  return r;
}

// Returns true if `sq` is attacked by any piece of `byColor`
// Uses pseudo-moves WITHOUT castling to avoid recursion
function squareAttackedBy(board: Board, sq: Square, byColor: Color): boolean {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === byColor) {
        // Use raw pseudo-moves (no castling context) to check attacks
        const ms = getPseudoMovesRaw(board, { row: r, col: c });
        if (ms.some((m) => m.row === sq.row && m.col === sq.col)) return true;
      }
    }
  return false;
}

// Get pseudo-legal moves (no castling, clean pawn diagonals) ─────────────────
function getPseudoMovesRaw(board: Board, sq: Square): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece) return [];
  const moves: Square[] = [];
  const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const canL = (r: number, c: number) =>
    inB(r, c) && board[r][c]?.color !== piece.color;
  const isEn = (r: number, c: number) =>
    inB(r, c) && board[r][c] !== null && board[r][c]?.color !== piece.color;
  const slide = (drs: number[], dcs: number[]) => {
    for (let i = 0; i < drs.length; i++) {
      let r = sq.row + drs[i],
        c = sq.col + dcs[i];
      while (inB(r, c)) {
        if (!board[r][c]) moves.push({ row: r, col: c });
        else {
          if (board[r][c]?.color !== piece.color)
            moves.push({ row: r, col: c });
          break;
        }
        r += drs[i];
        c += dcs[i];
      }
    }
  };
  switch (piece.type) {
    case "P": {
      // Pawns attack diagonally only
      const d = piece.color === "w" ? -1 : 1;
      [-1, 1].forEach((dc) => {
        if (inB(sq.row + d, sq.col + dc))
          moves.push({ row: sq.row + d, col: sq.col + dc });
      });
      break;
    }
    case "N":
      [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ].forEach(([dr, dc]) => {
        if (canL(sq.row + dr!, sq.col + dc!))
          moves.push({ row: sq.row + dr!, col: sq.col + dc! });
      });
      break;
    case "B":
      slide([-1, -1, 1, 1], [-1, 1, -1, 1]);
      break;
    case "R":
      slide([-1, 1, 0, 0], [0, 0, -1, 1]);
      break;
    case "Q":
      slide([-1, 1, 0, 0, -1, -1, 1, 1], [0, 0, -1, 1, -1, 1, -1, 1]);
      break;
    case "K":
      [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ].forEach(([dr, dc]) => {
        if (canL(sq.row + dr!, sq.col + dc!))
          moves.push({ row: sq.row + dr!, col: sq.col + dc! });
      });
      break;
  }
  return moves;
}

// ── Full pseudo-legal moves with castling + en passant ───────────────────────
function getPseudoMoves(
  board: Board,
  sq: Square,
  castling?: CastlingRights,
  epSquare?: Square | null
): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece) return [];
  const moves: Square[] = [];
  const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const canL = (r: number, c: number) =>
    inB(r, c) && board[r][c]?.color !== piece.color;
  const isEn = (r: number, c: number) =>
    inB(r, c) && board[r][c] !== null && board[r][c]?.color !== piece.color;
  const slide = (drs: number[], dcs: number[]) => {
    for (let i = 0; i < drs.length; i++) {
      let r = sq.row + drs[i],
        c = sq.col + dcs[i];
      while (inB(r, c)) {
        if (!board[r][c]) moves.push({ row: r, col: c });
        else {
          if (board[r][c]?.color !== piece.color)
            moves.push({ row: r, col: c });
          break;
        }
        r += drs[i];
        c += dcs[i];
      }
    }
  };
  switch (piece.type) {
    case "P": {
      const d = piece.color === "w" ? -1 : 1,
        sr = piece.color === "w" ? 6 : 1;
      if (inB(sq.row + d, sq.col) && !board[sq.row + d][sq.col])
        moves.push({ row: sq.row + d, col: sq.col });
      if (
        sq.row === sr &&
        !board[sq.row + d][sq.col] &&
        !board[sq.row + 2 * d][sq.col]
      )
        moves.push({ row: sq.row + 2 * d, col: sq.col });
      [-1, 1].forEach((dc) => {
        if (isEn(sq.row + d, sq.col + dc))
          moves.push({ row: sq.row + d, col: sq.col + dc });
        if (
          epSquare &&
          epSquare.row === sq.row + d &&
          epSquare.col === sq.col + dc
        )
          moves.push({ row: sq.row + d, col: sq.col + dc });
      });
      break;
    }
    case "N":
      [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ].forEach(([dr, dc]) => {
        if (canL(sq.row + dr!, sq.col + dc!))
          moves.push({ row: sq.row + dr!, col: sq.col + dc! });
      });
      break;
    case "B":
      slide([-1, -1, 1, 1], [-1, 1, -1, 1]);
      break;
    case "R":
      slide([-1, 1, 0, 0], [0, 0, -1, 1]);
      break;
    case "Q":
      slide([-1, 1, 0, 0, -1, -1, 1, 1], [0, 0, -1, 1, -1, 1, -1, 1]);
      break;
    case "K": {
      [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ].forEach(([dr, dc]) => {
        if (canL(sq.row + dr!, sq.col + dc!))
          moves.push({ row: sq.row + dr!, col: sq.col + dc! });
      });
      if (castling && piece.color === "w" && sq.row === 7 && sq.col === 4) {
        if (
          castling.wK &&
          !board[7][5] &&
          !board[7][6] &&
          board[7][7]?.type === "R" &&
          board[7][7]?.color === "w" &&
          !isInCheck(board, "w") &&
          !squareAttackedBy(board, { row: 7, col: 5 }, "b") &&
          !squareAttackedBy(board, { row: 7, col: 6 }, "b")
        )
          moves.push({ row: 7, col: 6 });
        if (
          castling.wQ &&
          !board[7][3] &&
          !board[7][2] &&
          !board[7][1] &&
          board[7][0]?.type === "R" &&
          board[7][0]?.color === "w" &&
          !isInCheck(board, "w") &&
          !squareAttackedBy(board, { row: 7, col: 3 }, "b") &&
          !squareAttackedBy(board, { row: 7, col: 2 }, "b")
        )
          moves.push({ row: 7, col: 2 });
      }
      if (castling && piece.color === "b" && sq.row === 0 && sq.col === 4) {
        if (
          castling.bK &&
          !board[0][5] &&
          !board[0][6] &&
          board[0][7]?.type === "R" &&
          board[0][7]?.color === "b" &&
          !isInCheck(board, "b") &&
          !squareAttackedBy(board, { row: 0, col: 5 }, "w") &&
          !squareAttackedBy(board, { row: 0, col: 6 }, "w")
        )
          moves.push({ row: 0, col: 6 });
        if (
          castling.bQ &&
          !board[0][3] &&
          !board[0][2] &&
          !board[0][1] &&
          board[0][0]?.type === "R" &&
          board[0][0]?.color === "b" &&
          !isInCheck(board, "b") &&
          !squareAttackedBy(board, { row: 0, col: 3 }, "w") &&
          !squareAttackedBy(board, { row: 0, col: 2 }, "w")
        )
          moves.push({ row: 0, col: 2 });
      }
      break;
    }
  }
  return moves;
}

// Is the given color's king in check on this board?
function isInCheck(board: Board, color: Color): boolean {
  let kr = -1,
    kc = -1;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.type === "K" && board[r][c]?.color === color) {
        kr = r;
        kc = c;
      }
  if (kr === -1) return false;
  return squareAttackedBy(
    board,
    { row: kr, col: kc },
    color === "w" ? "b" : "w"
  );
}

// Apply a move to a board copy
function applyMove(
  board: Board,
  from: Square,
  to: Square,
  epSquare?: Square | null
): Board {
  const nb = board.map((r) => [...r]);
  let p = nb[from.row][from.col]!;
  // Pawn promotion
  if (p.type === "P" && (to.row === 0 || to.row === 7)) p = { ...p, type: "Q" };
  nb[to.row][to.col] = p;
  nb[from.row][from.col] = null;

  // En passant: remove the captured pawn
  if (
    p.type === "P" &&
    epSquare &&
    to.row === epSquare.row &&
    to.col === epSquare.col
  ) {
    // The captured pawn is on the same row as `from`, same col as `to`
    nb[from.row][to.col] = null;
  }

  // Castling: move the rook
  if (p.type === "K") {
    const colDiff = to.col - from.col;
    if (colDiff === 2) {
      // Kingside — move rook from h-file to f-file
      nb[from.row][5] = nb[from.row][7];
      nb[from.row][7] = null;
    } else if (colDiff === -2) {
      // Queenside — move rook from a-file to d-file
      nb[from.row][3] = nb[from.row][0];
      nb[from.row][0] = null;
    }
  }
  return nb;
}

// Diff two boards to find the from/to squares of the move made
function diffBoards(
  before: Board,
  after: Board
): { from: Square; to: Square } | null {
  const disappeared: Square[] = [];
  const appeared: Square[] = [];
  const captured: Square[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const b = before[r][c],
        a = after[r][c];
      if (b && !a) disappeared.push({ row: r, col: c });
      else if (!b && a) appeared.push({ row: r, col: c });
      else if (b && a && b.color !== a.color) captured.push({ row: r, col: c }); // capture: enemy replaced
    }
  const from = disappeared[0] ?? null;
  const to = captured[0] ?? appeared[0] ?? null;
  if (from && to) return { from, to };
  return null;
}

// Get fully legal moves — filters out any that leave own king in check
function getLegalMoves(
  board: Board,
  sq: Square,
  turn: Color,
  castling?: CastlingRights,
  epSquare?: Square | null
): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece || piece.color !== turn) return [];
  return getPseudoMoves(board, sq, castling, epSquare).filter((to) => {
    const nb = applyMove(board, sq, to, epSquare);
    return !isInCheck(nb, turn);
  });
}

// Is the position checkmate or stalemate for `color`?
function getGameResult(
  board: Board,
  color: Color,
  castling?: CastlingRights,
  epSquare?: Square | null
): "checkmate" | "stalemate" | null {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color)
        if (
          getLegalMoves(board, { row: r, col: c }, color, castling, epSquare)
            .length > 0
        )
          return null;
    }
  return isInCheck(board, color) ? "checkmate" : "stalemate";
}

// ─── RPC ─────────────────────────────────────────────────────────────────────
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
  const r = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationSuccess(r))
    return scValToNative(r.result!.retval);
  throw new Error("Simulation failed");
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
      fee: "1000",
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
      const errText = await bumpRes.text();
      console.error("[fee-bump] response error:", bumpRes.status, errText);
      throw new Error(`Fee bump failed (${bumpRes.status}): ${errText}`);
    }
    
    const bumpJson = await bumpRes.json();
    console.log("[fee-bump] response:", bumpJson);
    
    if (!bumpJson.feeBumpXdr) {
      throw new Error("Fee bump returned no XDR: " + JSON.stringify(bumpJson));
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

export default function GamePage() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const { recordGameResult } = useKingFallAuth();

  const params = useParams();
  const router = useRouter();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const escrowId = useMemo(() => (rawId ? BigInt(rawId) : null), [rawId]);

  const [escrowStatus, setEscrowStatus] = useState<string>("loading");
  const [escrowData, setEscrowData] = useState<any>(null);
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [gameContractId, setGameContractId] = useState<bigint | null>(null);

  const [board, setBoard] = useState<Board>(createInitialBoard());
  const [currentTurn, setCurrentTurn] = useState<Color>("w");
  const [selected, setSelected] = useState<Square | null>(null);
  const [validMoves, setValidMoves] = useState<Square[]>([]);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [capturedW, setCapturedW] = useState<Piece[]>([]);
  const [capturedB, setCapturedB] = useState<Piece[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(
    null
  );
  const [winner, setWinner] = useState<"w" | "b" | "draw" | null>(null);
  const [inCheck, setInCheck] = useState<Color | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live
  const [fenHistory, setFenHistory] = useState<string[]>([]); // fen after each move
  const [viewBoard, setViewBoard] = useState<Board | null>(null); // board at viewIndex

  const [loading, setLoading] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [drawOffered, setDrawOffered] = useState(false);
  const [txStatus, setTxStatus] = useState<{
    type: "success" | "error" | "pending";
    msg: string;
    hash?: string;
  } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [mounted, setMounted] = useState(false);
  const [potSize, setPotSize] = useState<bigint>(0n);
  const [castlingRights, setCastlingRights] = useState<CastlingRights>({
    wK: true,
    wQ: true,
    bK: true,
    bQ: true,
  });
  const [epSquare, setEpSquare] = useState<Square | null>(null);
  const [whiteTimeLeft, setWhiteTimeLeft] = useState(TIMER_SECONDS);
  const [blackTimeLeft, setBlackTimeLeft] = useState(TIMER_SECONDS);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const escrowStatusRef = useRef(escrowStatus);
  const connectedRef = useRef(connectedAddress);
  const escrowIdRef = useRef(escrowId);
  const gameContractIdRef = useRef(gameContractId);
  useEffect(() => {
    escrowStatusRef.current = escrowStatus;
  }, [escrowStatus]);
  useEffect(() => {
    connectedRef.current = connectedAddress;
  }, [connectedAddress]);
  useEffect(() => {
    escrowIdRef.current = escrowId;
  }, [escrowId]);
  useEffect(() => {
    gameContractIdRef.current = gameContractId;
  }, [gameContractId]);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    if (mounted) loadBalance();
  }, [loadBalance, mounted]);

  // Load game state on mount
  useEffect(() => {
    if (!mounted || !escrowId) return;
    loadGameState();
  }, [mounted, escrowId]);

  // When wallet connects, update playerColor without full reload
  useEffect(() => {
    if (!connectedAddress || !escrowData) return;
    if (escrowData.white === connectedAddress) setPlayerColor("w");
    else if (
      escrowData.black &&
      escrowData.black !== escrowData.white &&
      escrowData.black === connectedAddress
    )
      setPlayerColor("b");
  }, [connectedAddress, escrowData]);

  const parseMoves = (movesArr: any[]): string[] =>
    movesArr
      .map((m: any) => {
        const s = m.san;
        if (typeof s === "string") return s;
        if (Array.isArray(s)) return String(s[0]);
        return String(Object.values(s || {})[0] || "");
      })
      .filter(Boolean);

  const parseMoveFens = (movesArr: any[]): string[] =>
    movesArr.map((m: any) => {
      const f = m.fen_after;
      if (typeof f === "string") return f;
      if (Array.isArray(f)) return String(f[0]);
      if (f && typeof f === "object") return String(Object.values(f)[0] || "");
      return "";
    });

  const parseFen = (raw: any): string => {
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return String(raw[0]);
    return String(Object.values(raw || {})[0] || "");
  };

  const findAndSetGameContract = async (addr?: string): Promise<boolean> => {
    try {
      const ids_raw = await simRead(
        GAME_CONTRACT_ID,
        "get_all_games",
        [],
        addr || connectedAddress || undefined
      );
      const ids: bigint[] = Array.isArray(ids_raw)
        ? ids_raw.map((x: any) =>
            typeof x === "bigint"
              ? x
              : BigInt(
                  typeof x === "object" && !Array.isArray(x)
                    ? (Object.values(x)[0] as any)
                    : Array.isArray(x)
                    ? x[0]
                    : x
                )
          )
        : [];
      for (const gid of ids) {
        try {
          const gs = await simRead(
            GAME_CONTRACT_ID,
            "get_game",
            [nativeToScVal(gid, { type: "u64" })],
            addr || connectedAddress || undefined
          );
          const rawEId = gs.escrow_id;
          const gsEId =
            typeof rawEId === "bigint"
              ? rawEId
              : typeof rawEId === "number"
              ? BigInt(rawEId)
              : Array.isArray(rawEId)
              ? BigInt(String(rawEId[0]))
              : BigInt(String(Object.values(rawEId || {})[0]));
          if (gsEId === escrowId) {
            setGameContractId(gid);
            const moves = parseMoves(gs.moves as any[]);
            setMoveHistory(moves);
            const fen = parseFen(gs.current_fen);
            if (fen && fen !== "") {
              const b = fenToBoard(fen);
              setBoard(b);
              const turn: Color = moves.length % 2 === 0 ? "w" : "b";
              setCurrentTurn(turn);
              setCastlingRights({ wK: true, wQ: true, bK: true, bQ: true });
              setEpSquare(null);
              setInCheck(isInCheck(b, turn) ? turn : null);
            }
            return true;
          }
        } catch {}
      }
    } catch {}
    return false;
  };

  const loadGameState = async () => {
    if (!escrowId) return;

    // ── Instant render from cache ──────────────────────────────────────────
    const cached = readCachedGame(rawId!);
    if (cached?.fen) {
      const b = fenToBoard(cached.fen);
      setBoard(b);
      const turn: Color = cached.moves.length % 2 === 0 ? "w" : "b";
      setCurrentTurn(turn);
      setMoveHistory(cached.moves);
      setInCheck(isInCheck(b, turn) ? turn : null);
    }
    try {
      const ed = await simRead(
        ESCROW_CONTRACT_ID,
        "get_game",
        [nativeToScVal(escrowId, { type: "u64" })],
        connectedAddress || undefined
      );
      setEscrowData(ed);
      const status = parseStatus(ed.status);
      setEscrowStatus(status);
      setPotSize(
        status === "Active" ? BigInt(ed.stake) * 2n : BigInt(ed.stake)
      );
      if (connectedAddress) {
        if (ed.white === connectedAddress) setPlayerColor("w");
        else if (
          ed.black &&
          ed.black !== ed.white &&
          ed.black === connectedAddress
        )
          setPlayerColor("b");
      }
      if (status === "Active" || status === "Finished" || status === "Drawn") {
        setWinner(
          status === "Drawn"
            ? "draw"
            : ed.white === connectedAddress
            ? "w"
            : "b"
        );
        const found = await findAndSetGameContract();
        if (
          !found &&
          status === "Active" &&
          ed.white &&
          ed.black &&
          ed.black !== ed.white &&
          connectedAddress &&
          walletsKit
        ) {
          const gcResult = await sendTx(
            connectedAddress,
            walletsKit,
            GAME_CONTRACT_ID,
            "create_game",
            [
              new Address(ed.white).toScVal(),
              new Address(ed.black).toScVal(),
              nativeToScVal(escrowId, { type: "u64" }),
              nativeToScVal(0n, { type: "u64" }),
            ],
            (s) => console.log("[create_game]", s)
          );
          if (gcResult) {
            const gcId = scValToNative(gcResult) as bigint;
            setGameContractId(gcId);
          }
        }
      }
    } catch (e) {
      console.error("[loadGameState]", e);
      setEscrowStatus("error");
    }
  };

  // Get the last committed move
  const logLastCommittedMove = async (gameId: bigint | null) => {
    if (!gameId) return;

    try {
      const gameData = await simRead(
        GAME_CONTRACT_ID,
        "get_game",
        [nativeToScVal(gameId, { type: "u64" })],
        connectedAddress || undefined
      );

      const moves = gameData?.moves || [];
      if (moves.length === 0) {
        console.log("No moves committed yet on-chain");
        return;
      }

      const lastMove = moves[moves.length - 1];

      const parsed = {
        san:
          typeof lastMove.san === "string"
            ? lastMove.san
            : Array.isArray(lastMove.san)
            ? String(lastMove.san[0] || "")
            : Object.values(lastMove.san || {})[0] || "",

        fen_after:
          typeof lastMove.fen_after === "string"
            ? lastMove.fen_after
            : Array.isArray(lastMove.fen_after)
            ? String(lastMove.fen_after[0] || "")
            : Object.values(lastMove.fen_after || {})[0] || "",

        player: lastMove.player || "",
        move_number: lastMove.move_number || moves.length,
        committed_at: lastMove.committed_at || null,
      };

      console.log(
        `✅ Last committed move on-chain (#${parsed.move_number}):`,
        parsed
      );

      if (parsed.san) {
        let timeStr = "unknown time";

        if (parsed.committed_at) {
          // Convert Soroban u64 timestamp (seconds since Unix epoch) to readable date
          const date = new Date(Number(parsed.committed_at) * 1000);
          timeStr = date.toLocaleString();
        }

        console.log(
          `Last on-chain move: ${parsed.san} by ${formatAddress(
            parsed.player
          )} at ${timeStr}`
        );
      }

      return parsed;
    } catch (err) {
      console.error("Failed to fetch last committed move:", err);
    }
  };

  // Calculate accurate remaining time based on last committed move
  useEffect(() => {
    if (escrowStatus !== "Active" || !gameContractId) return;

    const calculateTimeLeft = async () => {
      const lastMove = await logLastCommittedMove(gameContractId);

      if (!lastMove || !lastMove.committed_at) {
        setWhiteTimeLeft(TIMER_SECONDS);
        setBlackTimeLeft(TIMER_SECONDS);
        return;
      }

      const lastCommittedSeconds = Number(lastMove.committed_at);
      const nowSeconds = Math.floor(Date.now() / 1000);

      const elapsedSinceLastMove = nowSeconds - lastCommittedSeconds;

      const isWhiteTurn = lastMove.move_number % 2 === 1;

      let whiteRemaining = TIMER_SECONDS;
      let blackRemaining = TIMER_SECONDS;

      if (isWhiteTurn) {
        whiteRemaining = Math.max(0, TIMER_SECONDS - elapsedSinceLastMove);
      } else {
        blackRemaining = Math.max(0, TIMER_SECONDS - elapsedSinceLastMove);
      }

      setWhiteTimeLeft(whiteRemaining);
      setBlackTimeLeft(blackRemaining);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 10000);

    return () => clearInterval(interval);
  }, [gameContractId, escrowStatus]);

  // Live countdown timer
  useEffect(() => {
    if (escrowStatus !== "Active") return;

    timerRef.current = setInterval(() => {
      if (currentTurn === "w") {
        setWhiteTimeLeft((t) => Math.max(0, t - 1));
      } else {
        setBlackTimeLeft((t) => Math.max(0, t - 1));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [escrowStatus, currentTurn]);

  // Poll
  useEffect(() => {
    if (!mounted || !escrowId) return;
    const poll = setInterval(async () => {
      const status = escrowStatusRef.current;
      if (
        status === "error" ||
        status === "loading" ||
        status === "Finished" ||
        status === "Drawn" ||
        status === "Cancelled"
      )
        return;
      try {
        const pollId = escrowIdRef.current;
        if (!pollId) return;
        const ed = await simRead(
          ESCROW_CONTRACT_ID,
          "get_game",
          [nativeToScVal(pollId, { type: "u64" })],
          connectedRef.current || undefined
        );
        const newStatus = parseStatus(ed.status);
        if (newStatus !== escrowStatusRef.current) {
          setEscrowStatus(newStatus);
          setEscrowData(ed);
          if (newStatus === "Active") {
            setPotSize(BigInt(ed.stake) * 2n);
            const addr = connectedRef.current;
            if (addr) {
              if (ed.white === addr) setPlayerColor("w");
              else if (ed.black && ed.black !== ed.white && ed.black === addr)
                setPlayerColor("b");
            }
          }
          if (newStatus === "Finished" || newStatus === "Drawn") {
            setEscrowStatus(newStatus);
            setWinner(
              newStatus === "Drawn"
                ? "draw"
                : ed.white === connectedRef.current
                ? "w"
                : "b"
            );
          }
        }
        if (newStatus === "Active" || status === "Active") {
          const gcPollId = gameContractIdRef.current ?? pollId;
          try {
            const gd = await simRead(
              GAME_CONTRACT_ID,
              "get_game",
              [nativeToScVal(gcPollId, { type: "u64" })],
              connectedRef.current || undefined
            );
            const moves = parseMoves(gd.moves as any[]);
            setMoveHistory((prev) => {
              if (moves.length > prev.length) {
                const fen = parseFen(gd.current_fen);
                if (fen && fen !== "") {
                  const b = fenToBoard(fen);
                  const turn: Color = moves.length % 2 === 0 ? "w" : "b";
                  setBoard(b);
                  setCurrentTurn(turn);
                  setCastlingRights({ wK: true, wQ: true, bK: true, bQ: true });
                  setEpSquare(null);
                  setInCheck(isInCheck(b, turn) ? turn : null);
                  setLastMove(null);
                  writeGameCache(rawId!, fen, moves);
                }
                return moves;
              }
              return prev;
            });
          } catch {}
        }
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, [mounted, escrowId]);

  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 8000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // Keyboard navigation for move history
  useEffect(() => {
    if (moveHistory.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")
        setViewIndex((v) => {
          const cur = v ?? moveHistory.length;
          return Math.max(0, cur - 1);
        });
      if (e.key === "ArrowRight")
        setViewIndex((v) => {
          const cur = v ?? -1;
          const next = cur + 1;
          return next >= moveHistory.length ? null : next;
        });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveHistory.length]);

  // ── Chess ─────────────────────────────────────────────────────────────────
  const handleSquareClick = async (row: number, col: number) => {
    if (escrowStatus !== "Active") return;
    if (viewIndex !== null) return;
    if (currentTurn !== playerColor) return;
    if (selected) {
      const isValid = validMoves.some((m) => m.row === row && m.col === col);
      if (isValid) {
        const dest = { row, col };
        const nb = applyMove(board, selected, dest, epSquare);
        const cap = board[row][col];

        // Captured pieces — en passant capture removes a pawn not on dest
        if (cap) {
          if (cap.color === "b") setCapturedW((p) => [...p, cap]);
          else setCapturedB((p) => [...p, cap]);
        } else if (
          board[selected.row][selected.col]?.type === "P" &&
          epSquare?.row === row &&
          epSquare?.col === col
        ) {
          // En passant: the captured pawn
          const epCaptured: Piece = {
            type: "P",
            color: currentTurn === "w" ? "b" : "w",
          };
          if (currentTurn === "w") setCapturedW((p) => [...p, epCaptured]);
          else setCapturedB((p) => [...p, epCaptured]);
        }

        let mp = board[selected.row][selected.col]!;
        if (mp.type === "P" && (row === 0 || row === 7))
          mp = { ...mp, type: "Q" };

        // SAN for castling
        let san: string;
        if (mp.type === "K" && Math.abs(col - selected.col) === 2) {
          san = col > selected.col ? "O-O" : "O-O-O";
        } else if (
          mp.type === "P" &&
          !board[row][col] && // destination is empty
          epSquare?.row === row &&
          epSquare?.col === col
        ) {
          const f = "abcdefgh";
          san = `${f[selected.col]}x${f[col]}${8 - row}`;
        } else {
          san = toSAN(mp, selected, dest, cap);
        }

        const newMoves = [...moveHistory, san];
        const newTurn: Color = currentTurn === "w" ? "b" : "w";

        // Update castling rights
        const newCastling = updateCastlingRights(
          castlingRights,
          selected,
          board[selected.row][selected.col]
        );
        setCastlingRights(newCastling);

        // Update en passant square: set if pawn double-push, else clear
        let newEp: Square | null = null;
        if (mp.type === "P" && Math.abs(row - selected.row) === 2) {
          newEp = { row: (selected.row + row) / 2, col: col };
        }
        setEpSquare(newEp);

        const fen = boardToFen(nb, newTurn, newMoves.length);
        setBoard(nb);
        setCurrentTurn(newTurn);
        setMoveHistory(newMoves);
        setFenHistory((prev) => [...prev, fen]);
        setViewIndex(null);
        setLastMove({ from: selected, to: dest });
        setSelected(null);
        setValidMoves([]);

        const oppInCheck = isInCheck(nb, newTurn);
        setInCheck(oppInCheck ? newTurn : null);
        const result = getGameResult(nb, newTurn, newCastling, newEp);
        if (result === "checkmate") {
          const outcome = currentTurn === "w" ? "WhiteWins" : "BlackWins";
          await handleGameOver(outcome, newMoves);
        } else if (result === "stalemate") {
          await handleGameOver("Draw", newMoves);
        }

        // Commit onchain
        console.log("🔥 About to commit_move", {
          gameContractId,
          escrowId,
          gcId: gameContractId ?? escrowId,
          san,
          fen,
          connected: !!connectedAddress,
          hasKit: !!walletsKit,
          isKingMove: board[selected.row][selected.col]?.type === "K",
        });
        if (connectedAddress && walletsKit) {
          const gcId = gameContractId;
          if (!gcId) {
            console.error("No gameContractId - move only local");
            return;
          }

          const previousBoard = [...board.map((row) => [...row])];
          const previousMoveHistory = [...moveHistory];
          const previousFenHistory = [...fenHistory];
          const previousTurn = currentTurn;
          const previousCastling = { ...castlingRights };
          const previousEp = epSquare;
          const previousInCheck = inCheck;

          setMovePending(true);

          try {
            const txResult = await sendTx(
              connectedAddress,
              walletsKit,
              GAME_CONTRACT_ID,
              "commit_move",
              [
                nativeToScVal(gcId, { type: "u64" }),
                new Address(connectedAddress).toScVal(),
                nativeToScVal(san, { type: "string" }),
                nativeToScVal(fen, { type: "string" }),
              ],
              (s) => {
                if (s.type !== "pending") setMovePending(false);
                if (s.type === "success") {
                  setTxStatus({
                    type: "success",
                    msg: "Move confirmed",
                    hash: s.hash,
                  });
                  writeGameCache(rawId!, fen, newMoves);
                }
              }
            );

            if (!txResult) {
              throw new Error("Transaction failed or was rejected");
            }
          } catch (err: any) {
            console.error("❌ commit_move failed", err);

            // REVERT all local state
            setBoard(previousBoard);
            setMoveHistory(previousMoveHistory);
            setFenHistory(previousFenHistory);
            setCurrentTurn(previousTurn);
            setCastlingRights(previousCastling);
            setEpSquare(previousEp);
            setInCheck(previousInCheck);
            setLastMove(null);
            setSelected(null);
            setValidMoves([]);

            // Show clear error to user
            setTxStatus({
              type: "error",
              msg: `Error executing Move "${san}"`,
            });

            // Optional: alert for extra visibility
            alert(
              `Move failed: ${err.message || "Contract rejected the move"}`
            );
          }
        }
        return;
      }
    }
    const piece = board[row][col];
    if (piece && piece.color === currentTurn) {
      const legal = getLegalMoves(
        board,
        { row, col },
        currentTurn,
        castlingRights,
        epSquare
      );
      setSelected({ row, col });
      setValidMoves(legal);
    } else {
      setSelected(null);
      setValidMoves([]);
    }
  };

  // ── Onchain ───────────────────────────────────────────────────────────────
  const escrowTx = async (method: string, args: xdr.ScVal[]) => {
    if (!connectedAddress || !walletsKit || !escrowId) return null;
    setLoading(true);
    const r = await sendTx(
      connectedAddress,
      walletsKit,
      ESCROW_CONTRACT_ID,
      method,
      args,
      setTxStatus
    );
    setLoading(false);
    loadBalance();
    return r;
  };

  const handleJoinGame = async () => {
    if (!connectedAddress || !walletsKit || !escrowId || !escrowData) return;
    setJoinLoading(true);
  
    let joinSucceeded = false;
  
    const joined = await escrowTx("join_game", [
      nativeToScVal(escrowId, { type: "u64" }),
      new Address(connectedAddress).toScVal(),
    ]);

    const escrowAfter = await simRead(
      ESCROW_CONTRACT_ID,
      "get_game",
      [nativeToScVal(escrowId, { type: "u64" })],
      connectedAddress
    ).catch(() => null);
  
    const newStatus = escrowAfter ? parseStatus(escrowAfter.status) : null;
    joinSucceeded = newStatus === "Active";
  
    if (joinSucceeded) {
      const gcResult = await sendTx(
        connectedAddress,
        walletsKit,
        GAME_CONTRACT_ID,
        "create_game",
        [
          new Address(escrowData.white).toScVal(),
          new Address(connectedAddress).toScVal(),
          nativeToScVal(escrowId, { type: "u64" }),
          nativeToScVal(0n, { type: "u64" }),
        ],
        (s) => console.log("[create_game]", s)
      );
      if (gcResult) {
        setGameContractId(scValToNative(gcResult) as bigint);
      }
      setPlayerColor("b");
      await loadGameState();
    }
  
    setJoinLoading(false);
  };

  const handleGameOver = async (
    outcome: "WhiteWins" | "BlackWins" | "Draw",
    moves: string[]
  ) => {
    if (!connectedAddress || !escrowId || !walletsKit) {
      setWinner(
        outcome === "WhiteWins" ? "w" : outcome === "BlackWins" ? "b" : "draw"
      );
      return;
    }
    if (outcome !== "Draw") {
      const callerWouldWin =
        (outcome === "WhiteWins" && connectedAddress === escrowData?.white) ||
        (outcome === "BlackWins" && connectedAddress === escrowData?.black);

      const isCheckmate =
        getGameResult(board, outcome === "WhiteWins" ? "b" : "w") ===
        "checkmate";

      if (callerWouldWin && !isCheckmate) {
        console.error(
          "[handleGameOver] Blocked: caller cannot award themselves the pot via resign"
        );
        setTxStatus({
          type: "error",
          msg: "Invalid outcome — cannot resign in your favor",
        });
        return;
      }
    }

    setTxStatus({
      type: "pending",
      msg: outcome === "Draw" ? "Accepting draw..." : "Finishing game...",
    });

    try {
      const txResult = await escrowTx("finish_game", [
        nativeToScVal(escrowId, { type: "u64" }),
        new Address(connectedAddress).toScVal(),
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
        nativeToScVal(moves.join(" "), { type: "string" }),
      ]);

      if (gameContractId) {
        sendTx(
          connectedAddress,
          walletsKit,
          GAME_CONTRACT_ID,
          "complete_game",
          [
            nativeToScVal(gameContractId, { type: "u64" }),
            new Address(connectedAddress).toScVal(),
            xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
            nativeToScVal(moves.join(" "), { type: "string" }),
          ],
          () => {}
        ).catch(console.warn);
      }

      if (txResult) {
        const winnerColor =
          outcome === "WhiteWins"
            ? "w"
            : outcome === "BlackWins"
            ? "b"
            : "draw";

        setWinner(winnerColor);
        setEscrowStatus("Finished");

        // ── Record result to backend ──────────────────────────────────────────
        if (escrowData) {
          const txHash =
            typeof txResult === "object" && (txResult as any).hash
              ? (txResult as any).hash
              : undefined;

          recordGameResult({
            escrow_game_id: Number(escrowId),
            game_contract_id: gameContractId
              ? Number(gameContractId)
              : undefined,
            white_address: escrowData.white,
            black_address: escrowData.black,
            outcome,
            stake_each: Number(escrowData.stake),
            tx_hash_finish: txHash,
            move_count: moves.length,
            pgn: moves.join(" "),
            termination:
              outcome === "Draw"
                ? "Draw"
                : getGameResult(board, outcome === "WhiteWins" ? "b" : "w") ===
                  "checkmate"
                ? "Checkmate"
                : "Resignation",
            network: "testnet",
          }).catch((e) => console.warn("[recordGameResult]", e));
        }
        await loadGameState();
      } else {
        setTxStatus({ type: "error", msg: "Transaction failed or rejected" });
      }
    } catch (err: any) {
      console.error("handleGameOver error:", err);
      setTxStatus({
        type: "error",
        msg: err.message || "Failed to finish game",
      });
    }
  };

  const handleResign = () => {
    const outcome = playerColor === "w" ? "BlackWins" : "WhiteWins";
    handleGameOver(outcome, moveHistory);
  };
  const handleOfferDraw = async () => {
    setDrawOffered(true);
    await escrowTx("offer_draw", [
      nativeToScVal(escrowId!, { type: "u64" }),
      new Address(connectedAddress!).toScVal(),
    ]);
  };
  const handleAcceptDraw = async () => {
    await escrowTx("accept_draw", [
      nativeToScVal(escrowId!, { type: "u64" }),
      new Address(connectedAddress!).toScVal(),
    ]);
    handleGameOver("Draw", moveHistory);
  };

  if (!mounted || !escrowId) return null;

  const isWhitePlayer = !!(
    connectedAddress &&
    escrowData &&
    escrowData.white === connectedAddress
  );
  const isBlackPlayer = !!(
    connectedAddress &&
    escrowData &&
    escrowData.black &&
    escrowData.black !== escrowData.white &&
    escrowData.black === connectedAddress
  );
  const isPlayer = isWhitePlayer || isBlackPlayer;
  const isMyTurn = currentTurn === playerColor;
  const flipped = playerColor === "b";
  const opColor: Color = playerColor === "w" ? "b" : "w";
  const stakeXlm = escrowData
    ? (Number(escrowData.stake) / 10_000_000).toFixed(2)
    : "0";
  const canJoin = !!(
    connectedAddress &&
    escrowData &&
    escrowData.white !== connectedAddress &&
    escrowStatus === "Waiting"
  );

  // Find king square for check highlight
  const kingInCheckSq: Square | null = inCheck
    ? (() => {
        for (let r = 0; r < 8; r++)
          for (let c = 0; c < 8; c++)
            if (board[r][c]?.type === "K" && board[r][c]?.color === inCheck)
              return { row: r, col: c };
        return null;
      })()
    : null;

  // Derived board/lastMove for viewing historical positions
  const isViewingHistory = viewIndex !== null;

  const displayBoard: Board = (() => {
    if (viewIndex !== null && viewIndex >= 0 && viewIndex < fenHistory.length)
      return fenToBoard(fenHistory[viewIndex]);
    return board;
  })();

  // Derive highlight squares by diffing prev FEN → current FEN
  const displayLastMove = (() => {
    if (!isViewingHistory) return lastMove; // live: use locally tracked lastMove
    if (viewIndex === 0) {
      // First move: diff starting position vs fenHistory[0]
      const before = createInitialBoard();
      const after = fenToBoard(fenHistory[0]);
      return diffBoards(before, after);
    }
    if (viewIndex !== null && viewIndex > 0 && viewIndex < fenHistory.length) {
      const before = fenToBoard(fenHistory[viewIndex - 1]);
      const after = fenToBoard(fenHistory[viewIndex]);
      return diffBoards(before, after);
    }
    return null;
  })();

  const renderBoard = (interactive: boolean) => (
    <div
      className="relative"
      style={{
        overflow: "hidden",
        boxShadow:
          "0 0 60px -15px rgba(0,0,0,0.9),0 0 30px -8px rgba(217,119,6,0.12)",
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-5 flex flex-col pointer-events-none z-10 "
        style={{
          lineHeight: 1,
          transform: "translateY(-16px)",
        }}
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex-1 flex items-center justify-center">
            <span className="text-[9px] text-zinc-600">
              {flipped ? i + 1 : 8 - i}
            </span>
          </div>
        ))}
      </div>
      <div className="ml-5 mb-4">
        {(flipped ? [...displayBoard].reverse() : displayBoard).map(
          (row, rIdx) => {
            const displayR = flipped ? 7 - rIdx : rIdx;
            return (
              <div key={displayR} className="flex">
                {(flipped ? [...row].reverse() : row).map((piece, cIdx) => {
                  const displayC = flipped ? 7 - cIdx : cIdx;
                  const isLight = (displayR + displayC) % 2 === 0;
                  const isSel =
                    selected?.row === displayR && selected?.col === displayC;
                  const isVal = validMoves.some(
                    (m) => m.row === displayR && m.col === displayC
                  );
                  const isFrom =
                    displayLastMove?.from.row === displayR &&
                    displayLastMove?.from.col === displayC;
                  const isTo =
                    displayLastMove?.to.row === displayR &&
                    displayLastMove?.to.col === displayC;
                  const isKingCheck =
                    !isViewingHistory &&
                    kingInCheckSq?.row === displayR &&
                    kingInCheckSq?.col === displayC;
                  let bg = isLight ? "#c8a97e" : "#8b6340";
                  if (isKingCheck) bg = "#c0392b";
                  else if (isSel) bg = "#f0c040";
                  else if (isFrom || isTo) bg = isLight ? "#d4c060" : "#a09040";
                  return (
                    <button
                      key={displayC}
                      onClick={() =>
                        interactive && handleSquareClick(displayR, displayC)
                      }
                      className="relative w-10.5 h-10.5 min-[390px]:w-10.5 min-[390px]:h-10.5 min-[430px]:w-[47.4px] min-[430px]:h-[47.4px]  sm:w-12 sm:h-12 md:w-14 md:h-14 flex items-center justify-center group"
                      style={{ background: bg }}
                    >
                      {isVal &&
                        (piece ? (
                          <div className="absolute inset-0.5 rounded-sm border-[3px] border-black/30 pointer-events-none" />
                        ) : (
                          <div className="absolute w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-black/25 pointer-events-none" />
                        ))}
                      {piece && (
                        <span
                          className="text-3xl sm:text-3xl md:text-4xl lg:text-4xl select-none transition-transform group-hover:scale-110"
                          style={{
                            color: piece.color === "w" ? "#fff" : "#1a1a1a",
                            textShadow:
                              piece.color === "w"
                                ? "0 2px 5px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.1)"
                                : "0 3px 8px rgba(255,255,255,0.25)",
                            lineHeight: 1,
                            filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))",
                          }}
                        >
                          {PIECE_UNICODE[piece.type][piece.color]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          }
        )}
        <div className="flex">
          {(flipped ? "hgfedcba" : "abcdefgh").split("").map((f) => (
            <div
              key={f}
              className="w-10.5 h-4 min-[390px]:w-10.5 min-[430px]:w-[47.4px] sm:w-12 md:w-14 flex items-center justify-center"
            >
              <span className="text-[9px] text-zinc-600">{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── WAITING VIEW ─────────────────────────────────────────────────────────
  if (escrowStatus === "Waiting" || escrowStatus === "loading") {
    const isCreator = !!(
      connectedAddress && escrowData?.white === connectedAddress
    );
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
        <div className="relative max-w-6xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-8">
            <button
              onClick={() => router.push("/play")}
              className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest"
            >
              <ArrowLeft size={14} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-600 font-mono">
              Game #{params.id}
            </span>
            {escrowStatus === "loading" && (
              <RotateCcw size={12} className="animate-spin text-zinc-600" />
            )}
          </header>

          {escrowStatus === "loading" ? (
            <div className="flex items-center justify-center py-32">
              <RotateCcw size={24} className="animate-spin text-zinc-600" />
            </div>
          ) : (
            <div className="flex flex-col xl:flex-row gap-6 items-start">
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-120 flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl opacity-30">♛</div>
                    <div>
                      <p className="text-xs font-bold text-zinc-600">Black</p>
                      <p className="text-[9px] text-zinc-700 flex items-center gap-1">
                        Waiting to join
                        <ClockIcon className="w-3 h-3 top-[3.5px]" />
                      </p>
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-amber-500/30 animate-pulse" />
                </div>
                {renderBoard(false)}
                <div className="w-full max-w-120 flex items-center justify-between px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">♕</div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">
                        {isCreator ? "You — White" : "White"}
                      </p>
                      <p className="text-[9px] text-zinc-600">
                        {escrowData?.white
                          ? formatAddress(escrowData.white)
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4 w-full xl:w-72 shrink-0">
                <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">
                      Waiting for Opponent
                    </p>
                  </div>
                  <p className="text-zinc-500 text-sm">
                    Game #{params.id} · {stakeXlm} XLM locked
                  </p>
                </div>

                {/* Join button for non-creators */}
                {canJoin && (
                  <div className="border border-emerald-500/25 rounded-2xl p-5 bg-emerald-500/5 space-y-4">
                    <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                      Join This Game
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div>
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">
                          Stake required
                        </p>
                        <p className="text-amber-400 font-black text-base">
                          {stakeXlm} XLM
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">
                          Prize pot
                        </p>
                        <p className="text-white font-bold">
                          {(parseFloat(stakeXlm) * 2).toFixed(2)} XLM
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleJoinGame}
                      disabled={joinLoading}
                      className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2"
                    >
                      {joinLoading ? (
                        <>
                          <RotateCcw size={14} className="animate-spin" />{" "}
                          Joining
                        </>
                      ) : (
                        <>Stake & Join as Black</>
                      )}
                    </button>
                  </div>
                )}

                {isCreator && (
                  <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/30">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <Users size={12} className="text-amber-400" /> Invite
                    </h3>
                    <div className="flex items-center gap-2 px-3 py-3 bg-black border border-zinc-800 rounded-xl">
                      <span className="text-zinc-400 text-[10px] font-mono flex-1 truncate">
                        {typeof window !== "undefined"
                          ? `${window.location.origin}/play/${params.id}`
                          : ""}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/play/${params.id}`
                          );
                          setInviteCopied(true);
                          setTimeout(() => setInviteCopied(false), 2000);
                        }}
                      >
                        {inviteCopied ? (
                          <CheckCheck size={13} className="text-emerald-400" />
                        ) : (
                          <Copy
                            size={13}
                            className="text-zinc-600 hover:text-amber-400"
                          />
                        )}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div className="bg-black border border-zinc-800 rounded-xl px-3 py-2.5">
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">
                          Game ID
                        </p>
                        <p className="text-amber-400 font-black">
                          #{params.id}
                        </p>
                      </div>
                      <div className="bg-black border border-zinc-800 rounded-xl px-3 py-2.5">
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">
                          Stake
                        </p>
                        <p className="text-amber-400 font-black">
                          {stakeXlm} XLM
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border border-zinc-800/50 rounded-2xl p-5 bg-zinc-900/20 space-y-3 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-600 uppercase tracking-widest">
                      Stake locked
                    </span>
                    <span className="text-amber-400 font-bold">
                      {stakeXlm} XLM
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-600 uppercase tracking-widest">
                      Winner gets
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {(parseFloat(stakeXlm) * 2 * 0.985).toFixed(2)} XLM
                    </span>
                  </div>
                </div>

                <button
                  onClick={loadGameState}
                  className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <RotateCcw size={11} /> Reload
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (escrowStatus === "error") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "#050508",
          fontFamily: "'Courier New',Courier,monospace",
        }}
      >
        <div className="text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-rose-500" />
          <p className="text-zinc-400">Game #{params.id} not found</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={loadGameState}
              className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-2"
            >
              <RotateCcw size={14} /> Retry
            </button>
            <button
              onClick={() => router.push("/play")}
              className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLAYING / FINISHED ────────────────────────────────────────────────────
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
      <div className="relative max-w-6xl mx-auto px-4 py-6 pb-32">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/play")}
              className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest"
            >
              <ArrowLeft size={13} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              Game #{params.id}
            </span>
            {/* Move Saving / Transaction Modal */}
            <AnimatePresence>
              {movePending && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-zinc-900 border border-amber-500/30 rounded-3xl p-8 max-w-sm w-full mx-4 text-center"
                  >
                    <div className="flex justify-center mb-6">
                      <div className="w-16 h-16 rounded-full border-4 border-amber-500/30 border-t-amber-500 animate-spin" />
                    </div>

                    <h3 className="text-xl font-bold text-white mb-2">
                      Confirm Move
                    </h3>
                    <p className="text-zinc-400 text-sm mb-6">
                      Please confirm the transaction in your wallet
                    </p>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            {/* {inCheck && (
              <div className="flex items-center gap-1.5 px-2 py-1 border border-rose-500/40 rounded-lg bg-rose-500/10">
                <span className="text-[9px] text-rose-400 font-bold uppercase tracking-wider">
                  ⚠ {inCheck === "w" ? "White" : "Black"} in Check
                </span>
              </div>
            )} */}
          </div>
          <div className="flex items-center gap-3">
            {/* {connectedAddress && (
              <div className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 rounded-xl bg-zinc-900/40">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] text-zinc-400">
                  {formatAddress(connectedAddress)}
                </span>
                <span className="text-[10px] text-zinc-600">·</span>
                <span className="text-[10px] text-amber-400 font-bold">
                  {xlmBalance} XLM
                </span>
              </div>
            )} */}
            {!isPlayer && (
             <div className="px-3 py-1.5 border border-zinc-700 rounded-xl flex items-center justify-center">
             <EyeIcon className="w-3 h-3 text-zinc-500" />
           </div>
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">
            {(() => {
              const opActive =
                currentTurn === opColor && escrowStatus === "Active";
              const opTime = opColor === "w" ? whiteTimeLeft : blackTimeLeft;
              const opCap = opColor === "w" ? capturedW : capturedB;
              const opAddr =
                opColor === "w" ? escrowData?.white : escrowData?.black;
              return (
                <div
                  className={`w-full max-w-120 flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    opActive
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-zinc-800/40 bg-zinc-900/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">
                      {opColor === "w" ? "♕" : "♛"}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">
                        {isPlayer ? "Opponent" : "Player"}
                      </p>
                      <p className="text-[9px] text-zinc-600">
                        {opColor === "w" ? "White" : "Black"}
                        {opAddr ? " · " + formatAddress(opAddr) : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {opCap.slice(-8).map((p, i) => (
                        <span key={i} className="text-xs text-zinc-500">
                          {p ? PIECE_UNICODE[p.type][p.color] : ""}
                        </span>
                      ))}
                    </div>
                    <div
                      className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                        escrowStatus === "Finished" || escrowStatus === "Drawn"
                          ? winner === opColor
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : winner === "draw"
                            ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                            : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          : opActive
                          ? "bg-amber-500 text-black border-amber-400"
                          : "bg-zinc-900 text-zinc-500 border-zinc-800"
                      }`}
                    >
                      {escrowStatus === "Finished" || escrowStatus === "Drawn"
                        ? winner === opColor
                          ? "Won"
                          : winner === "draw"
                          ? "Draw"
                          : "Lost"
                        : formatTime(opTime)}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Result banner */}
            {/* {(escrowStatus === "Finished" || escrowStatus === "Drawn") &&
              winner && (
                <div
                  className={`w-full max-w-120 flex items-center justify-between px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                    winner === "draw"
                      ? "border-zinc-600/30 bg-zinc-800/40 text-zinc-400"
                      : winner === playerColor
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      : "border-zinc-700/30 bg-zinc-900/40 text-zinc-500"
                  }`}
                >
                  <span>
                    {winner === "draw"
                      ? "½ · ½  Draw"
                      : winner === playerColor
                      ? "1 · 0  You won"
                      : "0 · 1  You lost"}
                  </span>
                  <span className="text-base">
                    {winner === "draw"
                      ? "🤝"
                      : winner === playerColor
                      ? "🏆"
                      : "✗"}
                  </span>
                </div>
              )} */}
            <div className="relative">
              {renderBoard(
                escrowStatus === "Active" &&
                  (isWhitePlayer || isBlackPlayer) &&
                  !isViewingHistory
              )}
              {(escrowStatus === "Finished" || escrowStatus === "Drawn") &&
                winner && (
                  <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{ background: "rgba(5,5,8,0.35)" }}
                  />
                )}
            </div>

            {/* Move navigation */}
            {/* {moveHistory.length > 0 && (
              <div className="w-full max-w-[480px] flex items-center justify-between px-3 py-2 rounded-xl border border-zinc-800/50 bg-zinc-900/20">
                <div className="flex items-center gap-1">
                  <button
                    onClick={()=>setViewIndex(0)}
                    disabled={viewIndex===0}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                    title="First move">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                  </button>
                  <button
                    onClick={()=>setViewIndex(v=>{ const cur=v??moveHistory.length; return Math.max(0,cur-1); })}
                    disabled={viewIndex===0}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                    title="Previous move">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                  </button>
                </div>

                <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
                  {viewIndex===null
                    ? <span className="text-amber-400/70">Live · Move {moveHistory.length}</span>
                    : <span>Move {viewIndex+1} <span className="text-zinc-700">of {moveHistory.length}</span></span>
                  }
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={()=>setViewIndex(v=>{ const cur=v??-1; const next=cur+1; return next>=moveHistory.length?null:next; })}
                    disabled={viewIndex===null}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                    title="Next move">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                  </button>
                  <button
                    onClick={()=>setViewIndex(null)}
                    disabled={viewIndex===null}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                    title="Latest position">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>
                  </button>
                </div>
              </div>
            )} */}

            {(() => {
              const myActive =
                currentTurn === playerColor && escrowStatus === "Active";
              const myTime =
                playerColor === "w" ? whiteTimeLeft : blackTimeLeft;
              const myCap = playerColor === "w" ? capturedW : capturedB;
              return (
                <div
                  className={`w-full max-w-120 flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    myActive
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-zinc-800/40 bg-zinc-900/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">
                      {playerColor === "w" ? "♕" : "♛"}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">
                        {isPlayer ? "You" : "Spectating"}
                      </p>
                      <p className="text-[9px] text-zinc-600">
                        {playerColor === "w" ? "White" : "Black"}
                        {connectedAddress
                          ? " · " + formatAddress(connectedAddress)
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {myCap.slice(-8).map((p, i) => (
                        <span key={i} className="text-xs text-zinc-300">
                          {p ? PIECE_UNICODE[p.type][p.color] : ""}
                        </span>
                      ))}
                    </div>
                    <div
                      className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                        escrowStatus === "Finished" || escrowStatus === "Drawn"
                          ? winner === playerColor
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : winner === "draw"
                            ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                            : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          : myActive
                          ? "bg-amber-500 text-black border-amber-400"
                          : "bg-zinc-900 text-zinc-500 border-zinc-800"
                      }`}
                    >
                      {escrowStatus === "Finished" || escrowStatus === "Drawn"
                        ? winner === playerColor
                          ? "Won"
                          : winner === "draw"
                          ? "Draw"
                          : "Lost"
                        : formatTime(myTime)}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex flex-col gap-4 w-full lg:w-64">
            <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5">
              <p className="text-[9px] text-amber-600/80 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Coins size={10} /> Prize Pot
              </p>
              <p className="text-3xl font-black text-amber-400 tabular-nums">
                {stroopsToXlm(potSize)}
                <span className="text-sm text-amber-600 ml-2 font-bold">
                  XLM
                </span>
              </p>
              <p className="text-[9px] text-zinc-600 mt-1">
                Winner takes 98.5% · 1.5% fee
              </p>
            </div>

            <div
              className={`rounded-2xl p-4 border ${
                escrowStatus === "Finished" || escrowStatus === "Drawn"
                  ? winner === playerColor
                    ? "border-amber-500/40 bg-amber-500/8"
                    : winner === "draw"
                    ? "border-zinc-600/40 bg-zinc-800/30"
                    : "border-zinc-800/40 bg-zinc-900/20"
                  : "border-zinc-800 bg-zinc-900/20"
              }`}
            >
              {(escrowStatus === "Finished" || escrowStatus === "Drawn") &&
              winner ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        winner === "draw" ? "bg-zinc-400" : "bg-amber-400"
                      }`}
                    />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                      Game Over
                    </span>
                  </div>
                  {/* Winner row */}
                  <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                    <div className="flex items-center gap-2">
                      <span className="text-base">
                        {winner === "w" || winner === "draw" ? "♕" : "♛"}
                      </span>
                      <div>
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                          {winner === "draw"
                            ? "Draw"
                            : winner === "w"
                            ? "White wins"
                            : "Black wins"}
                        </p>
                        <p className="text-[9px] text-zinc-600 font-mono">
                          {winner === "draw"
                            ? formatAddress(escrowData?.white || "")
                            : winner === "w"
                            ? formatAddress(escrowData?.white || "")
                            : formatAddress(escrowData?.black || "")}
                        </p>
                      </div>
                    </div>
                    <span className="text-emerald-400 text-lg">🏆</span>
                  </div>
                  {/* Loser row — only for decisive games */}
                  {winner !== "draw" && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-zinc-900/40 border border-zinc-800/50">
                      <div className="flex items-center gap-2">
                        <span className="text-base opacity-40">
                          {winner === "w" ? "♛" : "♕"}
                        </span>
                        <div>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                            {winner === "w" ? "Black" : "White"}
                          </p>
                          <p className="text-[9px] text-zinc-700 font-mono">
                            {winner === "w"
                              ? formatAddress(escrowData?.black || "")
                              : formatAddress(escrowData?.white || "")}
                          </p>
                        </div>
                      </div>
                      <span className="text-zinc-700 text-sm">✗</span>
                    </div>
                  )}
                </div>
              ) : escrowStatus === "Active" ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isMyTurn && isPlayer
                          ? "bg-amber-400 animate-pulse"
                          : "bg-zinc-600"
                      }`}
                    />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isPlayer
                        ? isMyTurn
                          ? "Your move"
                          : "Opponent's move"
                        : "Spectating"}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Move{" "}
                    <span className="text-white font-bold">
                      {moveHistory.length + 1}
                    </span>{" "}
                    ·{" "}
                    <span
                      className={
                        currentTurn === "w" ? "text-zinc-200" : "text-zinc-500"
                      }
                    >
                      {currentTurn === "w" ? "White" : "Black"} to play
                    </span>
                  </p>
                  {inCheck && (
                    <p className="text-[10px] text-rose-400 mt-1 font-bold">
                      ⚠ {inCheck === "w" ? "White" : "Black"} is in check!
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                    {escrowStatus}
                  </span>
                </div>
              )}
            </div>

            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20 flex-1">
              <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center justify-between">
                <span>Moves ({moveHistory.length})</span>
              </h3>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {moveHistory.length === 0 ? (
                  <p className="text-[10px] text-zinc-700 italic">
                    No moves yet
                  </p>
                ) : (
                  moveHistory
                    .reduce<string[][]>((p, m, i) => {
                      if (i % 2 === 0) p.push([m]);
                      else p[p.length - 1].push(m);
                      return p;
                    }, [])
                    .map((pair, i) => (
                      <div key={i} className="flex gap-2 text-[10px] font-mono">
                        <span className="text-zinc-700 w-5 shrink-0">
                          {i + 1}.
                        </span>
                        <button
                          // onClick={()=>setViewIndex(i*2)}
                          className={`w-14 text-left rounded px-1 transition-colors ${
                            viewIndex === i * 2
                              ? "bg-amber-500/20 text-amber-400"
                              : "text-zinc-300 hover:text-white"
                          }`}
                        >
                          {pair[0]}
                        </button>
                        {pair[1] && (
                          <button
                            // onClick={()=>setViewIndex(i*2+1)}
                            className={`w-14 text-left rounded px-1 transition-colors ${
                              viewIndex === i * 2 + 1
                                ? "bg-amber-500/20 text-amber-400"
                                : "text-zinc-500 hover:text-zinc-300"
                            }`}
                          >
                            {pair[1]}
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>

            {isPlayer && escrowStatus === "Active" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={drawOffered ? handleAcceptDraw : handleOfferDraw}
                  disabled={loading}
                  className={`flex items-center justify-center gap-1.5 py-3 rounded-xl border transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40 ${
                    drawOffered
                      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/5"
                      : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <Handshake size={12} /> {drawOffered ? "Accept" : "Draw"}
                </button>
                <button
                  onClick={handleResign}
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40"
                >
                  <Flag size={12} /> Resign
                </button>
              </div>
            )}

            <div className="border border-zinc-800/50 rounded-xl p-3 space-y-1">
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

      {/* <AnimatePresence>
        {winner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="border border-amber-500/30 rounded-3xl p-10 text-center space-y-5 max-w-sm mx-4"
              style={{
                background: "linear-gradient(135deg,#0f0800,#0a0a0f)",
                boxShadow: "0 0 80px -20px rgba(217,119,6,0.4)",
              }}
            >
              <div
                className="text-6xl"
                style={{ filter: "drop-shadow(0 0 30px rgba(217,119,6,0.6))" }}
              >
                {winner === "w" ? "♔" : winner === "b" ? "♚" : "🤝"}
              </div>
              <div>
                <p className="text-[10px] text-amber-600 uppercase tracking-[0.3em] mb-2">
                  Game Over
                </p>
                <h2 className="text-3xl font-black text-white">
                  {winner === "draw" ? (
                    "Draw!"
                  ) : winner === playerColor ? (
                    <>
                      <span className="text-amber-400">Victory</span> is yours
                    </>
                  ) : isPlayer ? (
                    "You lost"
                  ) : (
                    "Game ended"
                  )}
                </h2>
                <p className="text-zinc-500 text-sm mt-2">
                  {winner === "draw"
                    ? "Stakes returned"
                    : winner === playerColor
                    ? ``
                    : "Better luck next time"}
                </p>
                {txStatus?.hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-amber-600/70 hover:text-amber-400 mt-2 transition-colors"
                  >
                    View tx <ExternalLink size={8} />
                  </a>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push("/play")}
                  className="flex-1 py-4 rounded-2xl font-black tracking-wider uppercase text-sm active:scale-95"
                  style={{
                    background: "linear-gradient(135deg,#d97706,#b45309)",
                    color: "#000",
                  }}
                >
                  New Game
                </button>
                <button
                  onClick={() => setWinner(null)}
                  className="px-5 py-4 rounded-2xl border border-zinc-800 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence> */}

      <AnimatePresence>
        {txStatus && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${
              txStatus.type === "success"
                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                : txStatus.type === "error"
                ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                : "bg-zinc-800/50 border-zinc-700/30 text-zinc-300"
            }`}
          >
            <div className="flex items-center gap-3 text-sm">
              {txStatus.type === "pending" ? (
                <RotateCcw size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              <span className="text-xs">{txStatus.msg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 hover:bg-white/10 rounded-lg"
                >
                  <ExternalLink size={12} />
                </a>
              )}
              <button
                onClick={() => setTxStatus(null)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
