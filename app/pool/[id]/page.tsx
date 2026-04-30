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
  Copy,
  CheckCheck,
  ArrowLeft,
  Zap,
  Circle,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { EyeIcon } from "@heroicons/react/24/solid";


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
      const err = await bumpRes.json();
      throw new Error(err.error || "Fee bump failed");
    }
    const bumpJson = await bumpRes.json();
    if (!bumpJson.feeBumpXdr)
      throw new Error("Fee bump returned no XDR: " + JSON.stringify(bumpJson));
    const response = await server.sendTransaction(
      TransactionBuilder.fromXDR(bumpJson.feeBumpXdr, networkPassphrase)
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

// ─── Pool Types & Constants ───────────────────────────────────────────────────
type BallId = number; // 0 = cue, 1–7 = solids, 8 = eight, 9–15 = stripes

interface Ball {
  id: BallId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
  color: string;
  isStripe: boolean;
  isCue: boolean;
  isEight: boolean;
}

type PlayerGroup = "solids" | "stripes" | null;

interface GameState {
  balls: Ball[];
  currentPlayer: 1 | 2; // 1 = player1 (breaks), 2 = player2
  player1Group: PlayerGroup;
  player2Group: PlayerGroup;
  turnCount: number;
  winner: 1 | 2 | null;
  foul: boolean;
  lastPocketed: BallId[];
  cueBallPocketed: boolean;
}

const TABLE_W = 560;
const TABLE_H = 280;
const BALL_R = 10;
const POCKET_R = 14;
const FRICTION = 0.985;
const MIN_V = 0.1;

const POCKET_POSITIONS = [
  { x: POCKET_R, y: POCKET_R },
  { x: TABLE_W / 2, y: POCKET_R - 2 },
  { x: TABLE_W - POCKET_R, y: POCKET_R },
  { x: POCKET_R, y: TABLE_H - POCKET_R },
  { x: TABLE_W / 2, y: TABLE_H - POCKET_R + 2 },
  { x: TABLE_W - POCKET_R, y: TABLE_H - POCKET_R },
];

function ballColor(id: BallId): string {
  const colors: Record<number, string> = {
    0: "#ffffff",
    1: "#f59e0b",
    2: "#3b82f6",
    3: "#ef4444",
    4: "#8b5cf6",
    5: "#f97316",
    6: "#10b981",
    7: "#dc2626",
    8: "#1a1a1a",
    9: "#f59e0b",
    10: "#3b82f6",
    11: "#ef4444",
    12: "#8b5cf6",
    13: "#f97316",
    14: "#10b981",
    15: "#dc2626",
  };
  return colors[id] || "#aaa";
}

function createRack(): Ball[] {
  const balls: Ball[] = [];
  // Cue ball
  balls.push({
    id: 0,
    x: TABLE_W * 0.25,
    y: TABLE_H / 2,
    vx: 0,
    vy: 0,
    pocketed: false,
    color: "#ffffff",
    isStripe: false,
    isCue: true,
    isEight: false,
  });

  // Triangle rack positions
  const apexX = TABLE_W * 0.72;
  const apexY = TABLE_H / 2;
  const spacing = BALL_R * 2.1;
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let idx = 0;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = order[idx++];
      balls.push({
        id,
        x: apexX + row * spacing,
        y: apexY + (col - row / 2) * spacing,
        vx: 0,
        vy: 0,
        pocketed: false,
        color: ballColor(id),
        isStripe: id >= 9,
        isCue: false,
        isEight: id === 8,
      });
    }
  }
  return balls;
}

function createInitialGameState(): GameState {
  return {
    balls: createRack(),
    currentPlayer: 1,
    player1Group: null,
    player2Group: null,
    turnCount: 0,
    winner: null,
    foul: false,
    lastPocketed: [],
    cueBallPocketed: false,
  };
}

// ─── Pool Table Canvas Component ─────────────────────────────────────────────
interface PoolTableProps {
  gameState: GameState;
  isMyTurn: boolean;
  onShot: (angle: number, power: number) => void;
  placingCueBall: boolean;
  onPlaceCueBall: (x: number, y: number) => void;
}

function PoolTable({
  gameState,
  isMyTurn,
  onShot,
  placingCueBall,
  onPlaceCueBall,
}: PoolTableProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aiming, setAiming] = useState(false);
  const [aimStart, setAimStart] = useState<{ x: number; y: number } | null>(null);
  const [aimCurrent, setAimCurrent] = useState<{ x: number; y: number } | null>(null);
  const animFrameRef = useRef<number>(0);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = TABLE_W / rect.width;
    const scaleY = TABLE_H / rect.height;
    let clientX: number, clientY: number;
    if ("touches" in e) {
      clientX = e.touches[0]?.clientX ?? 0;
      clientY = e.touches[0]?.clientY ?? 0;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      ctx.clearRect(0, 0, TABLE_W, TABLE_H);

      // Table felt
      ctx.fillStyle = "#1a5c2a";
      ctx.fillRect(0, 0, TABLE_W, TABLE_H);

      // Rail shadow
      ctx.fillStyle = "#4a2c0a";
      ctx.fillRect(0, 0, TABLE_W, 8);
      ctx.fillRect(0, TABLE_H - 8, TABLE_W, 8);
      ctx.fillRect(0, 0, 8, TABLE_H);
      ctx.fillRect(TABLE_W - 8, 0, 8, TABLE_H);

      // Center line
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(TABLE_W / 2, 0);
      ctx.lineTo(TABLE_W / 2, TABLE_H);
      ctx.stroke();

      // Head string
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(TABLE_W * 0.25, 0);
      ctx.lineTo(TABLE_W * 0.25, TABLE_H);
      ctx.stroke();

      // Pockets
      POCKET_POSITIONS.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
        ctx.fillStyle = "#0a0a0f";
        ctx.fill();
        ctx.strokeStyle = "#4a2c0a";
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Balls
      gameState.balls.forEach((ball) => {
        if (ball.pocketed) return;

        // Shadow
        ctx.beginPath();
        ctx.arc(ball.x + 2, ball.y + 2, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fill();

        // Ball
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);

        if (ball.isStripe) {
          // White base
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          // Stripe band
          ctx.save();
          ctx.clip();
          ctx.fillStyle = ball.color;
          ctx.fillRect(ball.x - BALL_R, ball.y - BALL_R * 0.5, BALL_R * 2, BALL_R);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = ball.color;
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Number
        if (!ball.isCue) {
          ctx.fillStyle = ball.isStripe ? ball.color : "rgba(255,255,255,0.9)";
          if (ball.isEight) ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.font = `bold ${BALL_R * 0.9}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(ball.id), ball.x, ball.y + 0.5);
        }

        // Highlight
        const grad = ctx.createRadialGradient(
          ball.x - BALL_R * 0.3,
          ball.y - BALL_R * 0.3,
          1,
          ball.x,
          ball.y,
          BALL_R
        );
        grad.addColorStop(0, "rgba(255,255,255,0.4)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      });

      // Aim line
      if (aiming && aimStart && aimCurrent && isMyTurn && !placingCueBall) {
        const cueBall = gameState.balls.find((b) => b.isCue && !b.pocketed);
        if (cueBall) {
          const dx = aimStart.x - aimCurrent.x;
          const dy = aimStart.y - aimCurrent.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          const power = Math.min(dist / 80, 1);

          // Dotted aim line
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = `rgba(255,255,255,${0.3 + power * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cueBall.x, cueBall.y);
          ctx.lineTo(
            cueBall.x + Math.cos(angle) * 120,
            cueBall.y + Math.sin(angle) * 120
          );
          ctx.stroke();
          ctx.restore();

          // Power indicator arc
          ctx.beginPath();
          ctx.arc(cueBall.x, cueBall.y, BALL_R + 4, angle - 0.3, angle + 0.3);
          ctx.strokeStyle = `rgba(${power > 0.5 ? "239,68,68" : "16,185,129"},0.8)`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // Ghost cue ball for placement
      if (placingCueBall && aimCurrent && isMyTurn) {
        ctx.beginPath();
        ctx.arc(aimCurrent.x, aimCurrent.y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [gameState, aiming, aimStart, aimCurrent, isMyTurn, placingCueBall]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMyTurn) return;
    const pos = getCanvasPos(e);
    if (placingCueBall) {
      onPlaceCueBall(pos.x, pos.y);
      return;
    }
    setAiming(true);
    setAimStart(pos);
    setAimCurrent(pos);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    setAimCurrent(pos);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMyTurn || !aiming || !aimStart || placingCueBall) {
      setAiming(false);
      return;
    }
    const pos = getCanvasPos(e);
    const dx = aimStart.x - pos.x;
    const dy = aimStart.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) {
      const angle = Math.atan2(dy, dx);
      const power = Math.min(dist / 80, 1);
      onShot(angle, power);
    }
    setAiming(false);
    setAimStart(null);
    setAimCurrent(null);
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border-4"
      style={{ borderColor: "#4a2c0a", boxShadow: "0 0 40px -10px rgba(0,0,0,0.8), 0 0 20px -5px rgba(16,185,129,0.1)" }}
    >
      <canvas
        ref={canvasRef}
        width={TABLE_W}
        height={TABLE_H}
        className="block w-full"
        style={{ maxWidth: "100%", cursor: isMyTurn ? (placingCueBall ? "crosshair" : "crosshair") : "default" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setAiming(false); setAimStart(null); }}
      />
    </div>
  );
}

// ─── Physics Engine ───────────────────────────────────────────────────────────
function stepPhysics(balls: Ball[]): { balls: Ball[]; pocketed: BallId[] } {
  const newBalls = balls.map((b) => ({ ...b }));
  const newPocketed: BallId[] = [];

  // Move & friction
  for (const b of newBalls) {
    if (b.pocketed) continue;
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= FRICTION;
    b.vy *= FRICTION;
    if (Math.abs(b.vx) < MIN_V) b.vx = 0;
    if (Math.abs(b.vy) < MIN_V) b.vy = 0;

    // Wall collisions
    if (b.x - BALL_R < 8) { b.x = 8 + BALL_R; b.vx = Math.abs(b.vx); }
    if (b.x + BALL_R > TABLE_W - 8) { b.x = TABLE_W - 8 - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.y - BALL_R < 8) { b.y = 8 + BALL_R; b.vy = Math.abs(b.vy); }
    if (b.y + BALL_R > TABLE_H - 8) { b.y = TABLE_H - 8 - BALL_R; b.vy = -Math.abs(b.vy); }

    // Pocket check
    for (const p of POCKET_POSITIONS) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < POCKET_R) {
        b.pocketed = true;
        b.vx = 0;
        b.vy = 0;
        newPocketed.push(b.id);
        break;
      }
    }
  }

  // Ball-ball collisions
  for (let i = 0; i < newBalls.length; i++) {
    for (let j = i + 1; j < newBalls.length; j++) {
      const a = newBalls[i], b = newBalls[j];
      if (a.pocketed || b.pocketed) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < BALL_R * 2) {
        const nx = dx / dist, ny = dy / dist;
        const overlap = BALL_R * 2 - dist;
        a.x -= nx * overlap / 2;
        a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2;
        b.y += ny * overlap / 2;
        const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
        const dot = dvx * nx + dvy * ny;
        if (dot < 0) {
          a.vx += dot * nx;
          a.vy += dot * ny;
          b.vx -= dot * nx;
          b.vy -= dot * ny;
        }
      }
    }
  }

  return { balls: newBalls, pocketed: newPocketed };
}

function allStopped(balls: Ball[]) {
  return balls.every((b) => b.pocketed || (b.vx === 0 && b.vy === 0));
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PoolGamePage() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const params = useParams();
  const router = useRouter();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const escrowId = useMemo(() => (rawId ? BigInt(rawId) : null), [rawId]);

  const [escrowStatus, setEscrowStatus] = useState<string>("loading");
  const [escrowData, setEscrowData] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [potSize, setPotSize] = useState<bigint>(0n);
  const [txStatus, setTxStatus] = useState<{
    type: "success" | "error" | "pending";
    msg: string;
    hash?: string;
  } | null>(null);

  // Pool game state
  const [gameState, setGameState] = useState<GameState>(createInitialGameState());
  const [simulating, setSimulating] = useState(false);
  const [placingCueBall, setPlacingCueBall] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [shotLog, setShotLog] = useState<string[]>([]);

  // Track which player the connected user is
  const isPlayer1 = !!(connectedAddress && escrowData?.white === connectedAddress);
  const isPlayer2 = !!(
    connectedAddress &&
    escrowData?.black &&
    escrowData.black !== escrowData.white &&
    escrowData.black === connectedAddress
  );
  const isPlayer = isPlayer1 || isPlayer2;
  const myPlayerNum: 1 | 2 | null = isPlayer1 ? 1 : isPlayer2 ? 2 : null;
  const isMyTurn =
    isPlayer &&
    gameState.winner === null &&
    escrowStatus === "Active" &&
    gameState.currentPlayer === myPlayerNum &&
    !simulating;

  const escrowStatusRef = useRef(escrowStatus);
  useEffect(() => { escrowStatusRef.current = escrowStatus; }, [escrowStatus]);

  useEffect(() => { setMounted(true); }, []);

  const loadBalance = useCallback(async () => {
    if (!connectedAddress) return;
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const d = await res.json();
      const n = d.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  const loadGameState = useCallback(async () => {
    if (!escrowId) return;
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
      setPotSize(status === "Active" ? BigInt(ed.stake) * 2n : BigInt(ed.stake));

      // Try to load game state from contract
      if (status === "Active" || status === "Finished") {
        try {
          const gd = await simRead(
            POOL_GAME_CONTRACT_ID,
            "get_game",
            [nativeToScVal(escrowId, { type: "u64" })],
            connectedAddress || undefined
          );
          if (gd?.state) {
            const parsedState = JSON.parse(
              typeof gd.state === "string" ? gd.state : String(Object.values(gd.state)[0])
            );
            setGameState(parsedState);
            setShotLog(gd.moves?.map((m: any) => String(Object.values(m)[0] || m)) ?? []);
          }
        } catch {
          // No game contract state yet — start fresh
        }
      }
    } catch (e) {
      console.error("[loadGameState]", e);
      setEscrowStatus("error");
    }
  }, [escrowId, connectedAddress]);

  useEffect(() => {
    if (mounted && escrowId) {
      loadGameState();
      loadBalance();
    }
  }, [mounted, escrowId, loadGameState, loadBalance]);

  // Poll for updates
  useEffect(() => {
    if (!mounted || !escrowId) return;
    const poll = setInterval(async () => {
      const status = escrowStatusRef.current;
      if (["error", "Finished", "Drawn", "Cancelled"].includes(status)) return;
      try {
        const ed = await simRead(
          ESCROW_CONTRACT_ID,
          "get_game",
          [nativeToScVal(escrowId, { type: "u64" })],
          connectedAddress || undefined
        );
        const newStatus = parseStatus(ed.status);
        if (newStatus !== escrowStatusRef.current) {
          setEscrowStatus(newStatus);
          setEscrowData(ed);
          if (newStatus === "Active") setPotSize(BigInt(ed.stake) * 2n);
        }
        // Sync game state from contract
        if (newStatus === "Active") {
          try {
            const gd = await simRead(
              POOL_GAME_CONTRACT_ID,
              "get_game",
              [nativeToScVal(escrowId, { type: "u64" })],
              connectedAddress || undefined
            );
            if (gd?.state) {
              const incoming = JSON.parse(
                typeof gd.state === "string" ? gd.state : String(Object.values(gd.state)[0])
              );
              setGameState((prev) => {
                if (incoming.turnCount > prev.turnCount) return incoming;
                return prev;
              });
            }
          } catch {}
        }
      } catch {}
    }, 4000);
    return () => clearInterval(poll);
  }, [mounted, escrowId, connectedAddress]);

  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 8000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // ── Shot Handling ─────────────────────────────────────────────────────────
  const handleShot = useCallback(
    async (angle: number, power: number) => {
      if (!isMyTurn || simulating) return;
      const cueBall = gameState.balls.find((b) => b.isCue && !b.pocketed);
      if (!cueBall) return;

      setSimulating(true);

      // Apply velocity to cue ball
      const speed = power * 18;
      let balls = gameState.balls.map((b) =>
        b.isCue ? { ...b, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed } : { ...b }
      );

      // Simulate until stopped (max 600 frames)
      let allPocketed: BallId[] = [];
      let cueWasPocketed = false;

      for (let frame = 0; frame < 600; frame++) {
        if (allStopped(balls)) break;
        const result = stepPhysics(balls);
        balls = result.balls;
        allPocketed = [...allPocketed, ...result.pocketed];
        if (result.pocketed.includes(0)) cueWasPocketed = true;

        // Animate at ~30fps by yielding periodically
        if (frame % 4 === 0) {
          setGameState((prev) => ({ ...prev, balls }));
          await new Promise((r) => setTimeout(r, 16));
        }
      }

      // Evaluate the shot result
      const solidsPocketed = allPocketed.filter((id) => id >= 1 && id <= 7);
      const stripesPocketed = allPocketed.filter((id) => id >= 9 && id <= 15);
      const eightPocketed = allPocketed.includes(8);

      let newState: GameState = { ...gameState, balls };
      const p = gameState.currentPlayer;
      const op: 1 | 2 = p === 1 ? 2 : 1;

      // Assign groups if not yet assigned
      if (!newState.player1Group && !eightPocketed) {
        const myPocketed = p === 1 ? solidsPocketed : stripesPocketed;
        const opPocketed = p === 1 ? stripesPocketed : solidsPocketed;
        if (myPocketed.length > 0 && !cueWasPocketed) {
          newState.player1Group = p === 1 ? "solids" : "stripes";
          newState.player2Group = p === 1 ? "stripes" : "solids";
        } else if (opPocketed.length > 0) {
          newState.player1Group = p === 1 ? "stripes" : "solids";
          newState.player2Group = p === 1 ? "solids" : "stripes";
        }
      }

      const myGroup = p === 1 ? newState.player1Group : newState.player2Group;
      const myBallsPocketed = myGroup === "solids" ? solidsPocketed : stripesPocketed;
      const legalPocket = myBallsPocketed.length > 0 && !cueWasPocketed;

      // Check 8-ball win/loss
      const myBallsRemaining = balls.filter(
        (b) =>
          !b.pocketed &&
          (myGroup === "solids" ? b.id >= 1 && b.id <= 7 : b.id >= 9 && b.id <= 15)
      );
      const clearedMyBalls = myBallsRemaining.length === 0 && myGroup !== null;

      if (eightPocketed) {
        if (clearedMyBalls && !cueWasPocketed) {
          newState.winner = p;
        } else {
          newState.winner = op; // foul - sank 8 early or with cue
        }
      } else if (cueWasPocketed) {
        // Foul: opponent places cue ball
        newState.foul = true;
        newState.currentPlayer = op;
        newState.cueBallPocketed = true;
      } else if (legalPocket) {
        // Extra turn
        newState.currentPlayer = p;
      } else {
        // Miss: switch player
        newState.currentPlayer = op;
        newState.foul = false;
      }

      newState.lastPocketed = allPocketed;
      newState.turnCount += 1;

      const shotDesc = `#${newState.turnCount} P${p}: power ${(power * 100).toFixed(0)}% | pocketed: [${allPocketed.join(",")}]${cueWasPocketed ? " FOUL" : ""}`;
      setShotLog((prev) => [...prev, shotDesc]);

      setGameState(newState);
      setSimulating(false);

      if (cueWasPocketed) setPlacingCueBall(true);

      // Commit to chain
      if (connectedAddress && walletsKit && !newState.winner) {
        setMovePending(true);
        try {
          await sendTx(
            connectedAddress,
            walletsKit,
            POOL_GAME_CONTRACT_ID,
            "commit_move",
            [
              nativeToScVal(escrowId!, { type: "u64" }),
              new Address(connectedAddress).toScVal(),
              nativeToScVal(shotDesc, { type: "string" }),
              nativeToScVal(JSON.stringify(newState), { type: "string" }),
            ],
            (s) => {
              if (s.type !== "pending") setMovePending(false);
              if (s.type === "success")
                setTxStatus({ type: "success", msg: "Shot confirmed", hash: s.hash });
            }
          );
        } catch (err: any) {
          setTxStatus({ type: "error", msg: err.message || "Shot commit failed" });
          setMovePending(false);
        }
      }

      // Handle game over
      if (newState.winner && connectedAddress && walletsKit && escrowId) {
        const outcome =
          newState.winner === 1
            ? "WhiteWins"
            : "BlackWins";
        await sendTx(
          connectedAddress,
          walletsKit,
          ESCROW_CONTRACT_ID,
          "finish_game",
          [
            nativeToScVal(escrowId, { type: "u64" }),
            new Address(connectedAddress).toScVal(),
            xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
            nativeToScVal(shotLog.join("|"), { type: "string" }),
          ],
          setTxStatus
        );
        setEscrowStatus("Finished");
      }
    },
    [isMyTurn, simulating, gameState, connectedAddress, walletsKit, escrowId, shotLog]
  );

  const handlePlaceCueBall = useCallback(
    (x: number, y: number) => {
      if (!placingCueBall) return;
      // Clamp inside table
      const cx = Math.max(8 + BALL_R, Math.min(TABLE_W - 8 - BALL_R, x));
      const cy = Math.max(8 + BALL_R, Math.min(TABLE_H - 8 - BALL_R, y));
      setGameState((prev) => ({
        ...prev,
        balls: prev.balls.map((b) =>
          b.isCue ? { ...b, x: cx, y: cy, pocketed: false, vx: 0, vy: 0 } : b
        ),
        cueBallPocketed: false,
        foul: false,
      }));
      setPlacingCueBall(false);
    },
    [placingCueBall]
  );

  const handleJoinGame = async () => {
    if (!connectedAddress || !walletsKit || !escrowId || !escrowData) return;
    setJoinLoading(true);
    try {
      const joined = await sendTx(
        connectedAddress,
        walletsKit,
        ESCROW_CONTRACT_ID,
        "join_game",
        [
          nativeToScVal(escrowId, { type: "u64" }),
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
            new Address(escrowData.white).toScVal(),
            new Address(connectedAddress).toScVal(),
            nativeToScVal(escrowId, { type: "u64" }),
            nativeToScVal(0n, { type: "u64" }),
          ],
          () => {}
        );
        await loadGameState();
      }
    } finally {
      setJoinLoading(false);
    }
  };

  const handleResign = async () => {
    if (!connectedAddress || !walletsKit || !escrowId) return;
    const outcome = myPlayerNum === 1 ? "BlackWins" : "WhiteWins";
    setLoading(true);
    await sendTx(
      connectedAddress,
      walletsKit,
      ESCROW_CONTRACT_ID,
      "finish_game",
      [
        nativeToScVal(escrowId, { type: "u64" }),
        new Address(connectedAddress).toScVal(),
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
        nativeToScVal("resign", { type: "string" }),
      ],
      setTxStatus
    );
    setLoading(false);
    setEscrowStatus("Finished");
    setGameState((prev) => ({
      ...prev,
      winner: myPlayerNum === 1 ? 2 : 1,
    }));
  };

  if (!mounted || !escrowId) return null;

  const stakeXlm = escrowData ? (Number(escrowData.stake) / 10_000_000).toFixed(2) : "0";
  const canJoin = !!(connectedAddress && escrowData && escrowData.white !== connectedAddress && escrowStatus === "Waiting");
  const isCreator = !!(connectedAddress && escrowData?.white === connectedAddress);

  const winner = gameState.winner;
  const myGroup = myPlayerNum === 1 ? gameState.player1Group : gameState.player2Group;
  const opGroup = myPlayerNum === 1 ? gameState.player2Group : gameState.player1Group;

  const solidCount = gameState.balls.filter((b) => b.id >= 1 && b.id <= 7 && !b.pocketed).length;
  const stripeCount = gameState.balls.filter((b) => b.id >= 9 && b.id <= 15 && !b.pocketed).length;
  const eightOnTable = !gameState.balls.find((b) => b.isEight)?.pocketed;

  // ── Waiting / Loading ──────────────────────────────────────────────────────
  if (escrowStatus === "Waiting" || escrowStatus === "loading") {
    return (
      <div
        className="min-h-screen text-zinc-200"
        style={{
          background: "radial-gradient(ellipse 120% 80% at 50% -10%, #001a0a 0%, #0a0f0a 55%, #050508 100%)",
          fontFamily: "'Courier New',Courier,monospace",
        }}
      >
        <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #10b981, transparent)" }} />
        <div className="relative max-w-5xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-8">
            <button onClick={() => router.push("/pool")} className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={14} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-600 font-mono">Game #{params.id}</span>
            {escrowStatus === "loading" && <RotateCcw size={12} className="animate-spin text-zinc-600" />}
          </header>

          {escrowStatus === "loading" ? (
            <div className="flex items-center justify-center py-32">
              <RotateCcw size={24} className="animate-spin text-zinc-600" />
            </div>
          ) : (
            <div className="flex flex-col xl:flex-row gap-6 items-start">
              <div className="flex-1">
                <div
                  className="rounded-xl overflow-hidden border-4 opacity-50"
                  style={{ borderColor: "#4a2c0a" }}
                >
                  <div className="w-full aspect-[2/1]" style={{ background: "#1a5c2a" }}>
                    <div className="flex items-center justify-center h-full">
                      <span className="text-6xl opacity-30">🎱</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4 w-full xl:w-72">
                <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">Waiting for Opponent</p>
                  </div>
                  <p className="text-zinc-500 text-sm">Game #{params.id} · {stakeXlm} XLM locked</p>
                </div>

                {canJoin && (
                  <div className="border border-emerald-500/25 rounded-2xl p-5 bg-emerald-500/5 space-y-4">
                    <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Join This Game</h3>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div>
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">Stake required</p>
                        <p className="text-amber-400 font-black text-base">{stakeXlm} XLM</p>
                      </div>
                      <div>
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">Prize pot</p>
                        <p className="text-white font-bold">{(parseFloat(stakeXlm) * 2).toFixed(2)} XLM</p>
                      </div>
                    </div>
                    <button
                      onClick={handleJoinGame}
                      disabled={joinLoading}
                      className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2"
                    >
                      {joinLoading ? <><RotateCcw size={14} className="animate-spin" /> Joining</> : <>Stake & Join as Player 2</>}
                    </button>
                  </div>
                )}

                {isCreator && (
                  <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/30">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                      <Users size={12} className="text-emerald-400" /> Invite
                    </h3>
                    <div className="flex items-center gap-2 px-3 py-3 bg-black border border-zinc-800 rounded-xl">
                      <span className="text-zinc-400 text-[10px] font-mono flex-1 truncate">
                        {typeof window !== "undefined" ? `${window.location.origin}/pool/${params.id}` : ""}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/pool/${params.id}`);
                          setInviteCopied(true);
                          setTimeout(() => setInviteCopied(false), 2000);
                        }}
                      >
                        {inviteCopied ? <CheckCheck size={13} className="text-emerald-400" /> : <Copy size={13} className="text-zinc-600 hover:text-emerald-400" />}
                      </button>
                    </div>
                  </div>
                )}

                <button onClick={loadGameState} className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#050508", fontFamily: "'Courier New',Courier,monospace" }}>
        <div className="text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-rose-500" />
          <p className="text-zinc-400">Game #{params.id} not found</p>
          <div className="flex gap-3 justify-center">
            <button onClick={loadGameState} className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-2">
              <RotateCcw size={14} /> Retry
            </button>
            <button onClick={() => router.push("/pool")} className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors">
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active / Finished ──────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{
        background: "radial-gradient(ellipse 120% 80% at 50% -10%, #001a0a 0%, #0a0f0a 55%, #050508 100%)",
        fontFamily: "'Courier New',Courier,monospace",
      }}
    >
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #10b981, transparent)" }} />

      <div className="relative max-w-5xl mx-auto px-4 py-6 pb-32">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/pool")} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">Game #{params.id}</span>
          </div>
          {!isPlayer && (
            <div className="px-3 py-1.5 border border-zinc-700 rounded-xl flex items-center justify-center">
              <EyeIcon className="w-3 h-3 text-zinc-500" />
            </div>
          )}
        </header>

        {/* Move Pending Modal */}
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
                className="bg-zinc-900 border border-emerald-500/30 rounded-3xl p-8 max-w-sm w-full mx-4 text-center"
              >
                <div className="flex justify-center mb-6">
                  <div className="w-16 h-16 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Confirm Shot</h3>
                <p className="text-zinc-400 text-sm">Please confirm the transaction in your wallet</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* ── Table & Players ── */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            {/* Opponent info */}
            <div className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${gameState.currentPlayer !== myPlayerNum && escrowStatus === "Active" ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800/40 bg-zinc-900/20"}`}>
              <div className="flex items-center gap-3">
                <div className="text-xl">🎱</div>
                <div>
                  <p className="text-xs font-bold text-zinc-300">
                    {isPlayer ? "Opponent" : "Player " + (myPlayerNum === 1 ? 2 : 1)}
                  </p>
                  <p className="text-[9px] text-zinc-600">
                    {(myPlayerNum === 1 ? gameState.player2Group : gameState.player1Group) ?? "Not assigned"}
                    {escrowData ? " · " + formatAddress(myPlayerNum === 1 ? (escrowData.black || "") : escrowData.white) : ""}
                  </p>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-lg font-black text-sm border ${
                escrowStatus === "Finished"
                  ? winner === (myPlayerNum === 1 ? 2 : 1) ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-zinc-900 text-zinc-600 border-zinc-800"
                  : gameState.currentPlayer !== myPlayerNum && escrowStatus === "Active" ? "bg-emerald-500 text-black border-emerald-400" : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`}>
                {escrowStatus === "Finished"
                  ? winner === (myPlayerNum === 1 ? 2 : 1) ? "Won" : "Lost"
                  : gameState.currentPlayer !== myPlayerNum ? "Their Turn" : "Waiting"}
              </div>
            </div>

            {/* Pool Table */}
            <PoolTable
              gameState={gameState}
              isMyTurn={isMyTurn}
              onShot={handleShot}
              placingCueBall={placingCueBall}
              onPlaceCueBall={handlePlaceCueBall}
            />

            {/* Instructions */}
            {isMyTurn && !simulating && (
              <div className="text-center text-[10px] text-zinc-500">
                {placingCueBall
                  ? "Click anywhere on the left half to place the cue ball"
                  : "Click and drag from the cue ball to aim · release to shoot"}
              </div>
            )}
            {simulating && (
              <div className="text-center text-[10px] text-emerald-400 animate-pulse flex items-center justify-center gap-1">
                <RotateCcw size={10} className="animate-spin" /> Simulating…
              </div>
            )}

            {/* My info */}
            <div className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${isMyTurn ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800/40 bg-zinc-900/20"}`}>
              <div className="flex items-center gap-3">
                <div className="text-xl">🎯</div>
                <div>
                  <p className="text-xs font-bold text-zinc-300">{isPlayer ? "You" : "Spectating"}</p>
                  <p className="text-[9px] text-zinc-600">
                    {myGroup ?? "Not assigned"}
                    {connectedAddress ? " · " + formatAddress(connectedAddress) : ""}
                  </p>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-lg font-black text-sm border ${
                escrowStatus === "Finished"
                  ? winner === myPlayerNum ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-zinc-900 text-zinc-600 border-zinc-800"
                  : isMyTurn ? "bg-emerald-500 text-black border-emerald-400" : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`}>
                {escrowStatus === "Finished"
                  ? winner === myPlayerNum ? "Won" : "Lost"
                  : isMyTurn ? "Your Turn" : "Waiting"}
              </div>
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="flex flex-col gap-4 w-full lg:w-60 shrink-0">
            {/* Pot */}
            <div className="border border-emerald-500/20 rounded-2xl p-5 bg-emerald-500/5">
              <p className="text-[9px] text-emerald-600/80 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Coins size={10} /> Prize Pot
              </p>
              <p className="text-3xl font-black text-emerald-400 tabular-nums">
                {stroopsToXlm(potSize)}
                <span className="text-sm text-emerald-600 ml-2 font-bold">XLM</span>
              </p>
              <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98.5% · 1.5% fee</p>
            </div>

            {/* Ball counts */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20 space-y-3">
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Balls Remaining</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: solidCount }).map((_, i) => (
                      <div key={i} className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-400">Solids</span>
                </div>
                <span className="text-sm font-black text-zinc-300">{solidCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: stripeCount }).map((_, i) => (
                      <div key={i} className="w-2.5 h-2.5 rounded-full border border-blue-400 bg-white" />
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-400">Stripes</span>
                </div>
                <span className="text-sm font-black text-zinc-300">{stripeCount}</span>
              </div>
              {eightOnTable && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-zinc-900 border border-zinc-600" />
                    <span className="text-[10px] text-zinc-400">8-ball</span>
                  </div>
                  <span className="text-sm font-black text-zinc-300">On table</span>
                </div>
              )}
            </div>

            {/* Game status */}
            <div className={`rounded-2xl p-4 border ${
              escrowStatus === "Finished"
                ? winner === myPlayerNum ? "border-emerald-500/40 bg-emerald-500/8" : "border-zinc-800/40 bg-zinc-900/20"
                : "border-zinc-800 bg-zinc-900/20"
            }`}>
              {escrowStatus === "Finished" && winner ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Game Over</span>
                  </div>
                  <p className="text-sm font-black text-white">
                    {winner === myPlayerNum ? "🏆 You won!" : "You lost"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${isMyTurn ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isPlayer ? isMyTurn ? "Your move" : "Opponent's move" : "Spectating"}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Shot <span className="text-white font-bold">{gameState.turnCount + 1}</span> ·{" "}
                    <span className="text-zinc-400">Player {gameState.currentPlayer} to shoot</span>
                  </p>
                  {gameState.foul && (
                    <p className="text-[10px] text-rose-400 mt-1 font-bold">⚠ Foul — place cue ball</p>
                  )}
                  {myGroup && (
                    <p className="text-[10px] text-emerald-400/70 mt-1">Your group: {myGroup}</p>
                  )}
                </>
              )}
            </div>

            {/* Shot log */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
              <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">
                Shot Log ({shotLog.length})
              </h3>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {shotLog.length === 0 ? (
                  <p className="text-[10px] text-zinc-700 italic">No shots yet</p>
                ) : (
                  shotLog.slice(-10).reverse().map((s, i) => (
                    <p key={i} className="text-[9px] text-zinc-600 font-mono truncate">{s}</p>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            {isPlayer && escrowStatus === "Active" && (
              <button
                onClick={handleResign}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40 w-full"
              >
                <Flag size={12} /> Forfeit
              </button>
            )}

            <div className="border border-zinc-800/50 rounded-xl p-3 space-y-1">
              <a
                href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-700 hover:text-emerald-400 transition-colors flex items-center gap-1"
              >
                Escrow · {formatAddress(ESCROW_CONTRACT_ID)} <ExternalLink size={8} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* TX Status Toast */}
      <AnimatePresence>
        {txStatus && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${
              txStatus.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : txStatus.type === "error" ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
              : "bg-zinc-800/50 border-zinc-700/30 text-zinc-300"
            }`}
          >
            <div className="flex items-center gap-3 text-sm">
              {txStatus.type === "pending" ? <RotateCcw size={14} className="animate-spin" /> : <Zap size={14} />}
              <span className="text-xs">{txStatus.msg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash && (
                <a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-white/10 rounded-lg">
                  <ExternalLink size={12} />
                </a>
              )}
              <button onClick={() => setTxStatus(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500">
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}