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
  Coins, RotateCcw, AlertCircle, ExternalLink, X,
  Users, Flag, Copy, CheckCheck, ArrowLeft, Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { ClockIcon, EyeIcon } from "@heroicons/react/24/solid";

// ─── Config ───────────────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID = "CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN";
const NATIVE_TOKEN_ID   = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const FALLBACK_ACCOUNT  = "GDXK7EYVBXTITLBW2ZCODJW3B7VTVCNNNWDDEHKJ7Y67TZVW5VKRRMU6";
const RPC_URL           = "https://soroban-testnet.stellar.org:443";
const server            = new StellarRpc.Server(RPC_URL);
const networkPassphrase  = Networks.TESTNET;

const TIMER_SECONDS = 86400;

const STATUS_MAP: Record<number, string> = {
  0: "Waiting", 1: "Active", 2: "Finished", 3: "Drawn", 4: "Cancelled", 5: "Timeout",
};

function parseStatus(r: any): string {
  if (typeof r === "number") return STATUS_MAP[r] ?? String(r);
  if (Array.isArray(r)) return String(r[0]);
  if (typeof r === "object" && r !== null) return Object.keys(r)[0];
  return String(r);
}
function stroopsToXlm(s: bigint | number) { return (Number(s) / 10_000_000).toFixed(2); }
function formatAddress(a: string) { return `${a.slice(0, 6)}...${a.slice(-4)}`; }
function formatTime(s: number) {
  if (s >= 3600)
    return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

// ─── Dice pip layout ─────────────────────────────────────────────────────────
const DOTS: [number, number][][] = [
  [[0, 0]],
  [[-1, -1], [1, 1]],
  [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
];

// ─── Die component ────────────────────────────────────────────────────────────
function Die({
  value, hidden = false, size = 52, highlight = false, shaking = false,
}: {
  value: number; hidden?: boolean; size?: number; highlight?: boolean; shaking?: boolean;
}) {
  const SPREAD = size * 0.27;
  const DOT_R  = size * 0.09;
  return (
    <div
      className={`relative rounded-lg flex items-center justify-center transition-all select-none ${shaking ? "animate-bounce" : ""}`}
      style={{
        width: size, height: size, flexShrink: 0,
        background:    hidden ? "#1a2036" : "#f5f0e8",
        border:        `1.5px solid ${highlight ? "#d97706" : hidden ? "#2e3d5a" : "#c8b890"}`,
        boxShadow:     highlight ? "0 0 12px rgba(217,119,6,0.4)" : "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      {hidden ? (
        <span style={{ color: "#4a6080", fontSize: size * 0.48, fontWeight: "bold", fontFamily: "monospace", lineHeight: 1 }}>?</span>
      ) : (
        <svg viewBox={`-${size / 2} -${size / 2} ${size} ${size}`} width={size * 0.75} height={size * 0.75}>
          {(DOTS[value - 1] || []).map(([dx, dy], i) => (
            <circle key={i} cx={dx * SPREAD} cy={dy * SPREAD} r={DOT_R * (size / 2)} fill={highlight ? "#d97706" : "#2a1a0a"} />
          ))}
        </svg>
      )}
    </div>
  );
}

// ─── Animated lobby canvas ────────────────────────────────────────────────────
function LiarsDiceCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = 480, H = 280;
    canvas.width = W; canvas.height = H;
    const DIE = 50, GAP = 12;

    type Die = { value: number; revealed: boolean; x: number; y: number; shaking: boolean };
    const makeDice = (): { top: Die[]; bottom: Die[] } => ({
      top:    Array.from({ length: 5 }, (_, i) => ({ value: Math.ceil(Math.random() * 6), revealed: false, shaking: false, x: W / 2 - 2 * (DIE + GAP) + i * (DIE + GAP), y: H * 0.22 })),
      bottom: Array.from({ length: 5 }, (_, i) => ({ value: Math.ceil(Math.random() * 6), revealed: true,  shaking: false, x: W / 2 - 2 * (DIE + GAP) + i * (DIE + GAP), y: H * 0.65 })),
    });

    type Phase = "show" | "shaking" | "reveal" | "pause";
    let dice = makeDice(), phase: Phase = "show", tick = 0, pauseT = 0;
    let bidQty = 3, bidFace = 4;

    const drawDie = (d: Die) => {
      const s = DIE;
      const ox = d.shaking ? (Math.random() - 0.5) * 3.5 : 0;
      const oy = d.shaking ? (Math.random() - 0.5) * 3.5 : 0;
      const x = d.x + ox, y = d.y + oy;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.roundRect(x - s / 2 + 2, y - s / 2 + 2, s, s, 6); ctx.fill();
      ctx.fillStyle = d.revealed ? "#f5f0e8" : "#1a2036";
      ctx.strokeStyle = d.revealed ? "#c8b890" : "#2e3d5a";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 6); ctx.fill(); ctx.stroke();
      if (!d.revealed) {
        ctx.fillStyle = "#4a6080"; ctx.font = `bold ${s * 0.48}px monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("?", x, y + 1); return;
      }
      const SPREAD = s * 0.27, DOT_R = s * 0.09;
      ctx.fillStyle = "#2a1a0a";
      (DOTS[d.value - 1] || []).forEach(([dx, dy]) => {
        ctx.beginPath(); ctx.arc(x + dx * SPREAD, y + dy * SPREAD, DOT_R, 0, Math.PI * 2); ctx.fill();
      });
    };

    const drawBid = () => {
      const cx = W / 2, by = H / 2;
      const pillW = 170, pillH = 34;
      ctx.fillStyle = "#0f111a"; ctx.strokeStyle = "#d97706"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(cx - pillW / 2, by - pillH / 2, pillW, pillH, pillH / 2); ctx.fill(); ctx.stroke();
      const t = Date.now() / 500;
      ctx.strokeStyle = `rgba(217,119,6,${0.3 + 0.2 * Math.sin(t)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(cx - pillW / 2 - 2, by - pillH / 2 - 2, pillW + 4, pillH + 4, pillH / 2 + 2); ctx.stroke();
      ctx.fillStyle = "#f0c060"; ctx.font = "bold 14px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`BID: ${bidQty} × [${bidFace}]`, cx, by);
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#08090f"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(217,119,6,0.025)"; ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(20, H / 2); ctx.lineTo(W - 20, H / 2); ctx.stroke();
      ctx.font = "10px monospace"; ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("OPPONENT", 10, dice.top[0].y);
      ctx.fillText("YOU", 10, dice.bottom[0].y);
      [...dice.top, ...dice.bottom].forEach(drawDie);
      drawBid();
    };

    const step = () => {
      tick++;
      if (phase === "show") {
        if (tick > 100) { phase = "shaking"; tick = 0; bidQty = Math.ceil(Math.random() * 4) + 1; bidFace = Math.ceil(Math.random() * 5) + 1; }
      } else if (phase === "shaking") {
        dice.top.forEach(d => { d.shaking = true; }); dice.bottom.forEach(d => { d.shaking = true; });
        if (tick > 40) {
          dice.top.forEach(d => { d.shaking = false; d.value = Math.ceil(Math.random() * 6); });
          dice.bottom.forEach(d => { d.shaking = false; d.value = Math.ceil(Math.random() * 6); d.revealed = false; });
          phase = "reveal"; tick = 0;
        }
      } else if (phase === "reveal") {
        const idx = Math.floor(tick / 14);
        dice.bottom.forEach((d, i) => { if (i <= idx) d.revealed = true; });
        if (idx >= 5) { phase = "pause"; tick = 0; pauseT = 90; }
      } else if (phase === "pause") {
        pauseT--; if (pauseT <= 0) { dice = makeDice(); phase = "show"; tick = 0; }
      }
      draw();
    };

    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, []);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }} />;
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────
async function simRead(contractId: string, method: string, args: xdr.ScVal[] = [], src?: string): Promise<any> {
  const acct = await server.getAccount(src || FALLBACK_ACCOUNT);
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30).build();
  const r = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationSuccess(r)) return scValToNative(r.result!.retval);
  throw new Error("Simulation failed");
}

async function sendTx(
  addr: string, kit: any, contractId: string, method: string, args: xdr.ScVal[],
  onStatus: (s: { type: "success" | "error" | "pending"; msg: string; hash?: string }) => void
): Promise<xdr.ScVal | null> {
  onStatus({ type: "pending", msg: "Preparing transaction..." });
  try {
    const account  = await server.getAccount(addr);
    const tx       = new TransactionBuilder(account, { fee: "1000", networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase, address: addr });
    onStatus({ type: "pending", msg: "processing" });
    const bumpRes = await fetch("/api/fee-bump", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedInnerXdr: signedTxXdr }),
    });
    if (!bumpRes.ok) { const err = await bumpRes.json(); throw new Error(err.error || "Fee bump failed"); }
    const bumpJson = await bumpRes.json();
    if (!bumpJson.feeBumpXdr) throw new Error("Fee bump returned no XDR: " + JSON.stringify(bumpJson));
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(bumpJson.feeBumpXdr, networkPassphrase));
    if (response.status === "ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status === "NOT_FOUND") { await new Promise(x => setTimeout(x, 1000)); r = await server.getTransaction(response.hash); }
    if (r.status === "SUCCESS") { onStatus({ type: "success", msg: "Confirmed", hash: response.hash }); return (r as any).returnValue ?? null; }
    throw new Error("Transaction failed on-chain");
  } catch (err: any) {
    onStatus({ type: "error", msg: err.message || "Transaction failed" });
    return null;
  }
}

async function sendTxDirect(
  addr: string, kit: any, contractId: string, method: string, args: xdr.ScVal[],
  onStatus: (s: { type: "success" | "error" | "pending"; msg: string; hash?: string }) => void
): Promise<xdr.ScVal | null> {
  onStatus({ type: "pending", msg: "Preparing transaction..." });
  try {
    const account  = await server.getAccount(addr);
    const tx       = new TransactionBuilder(account, { fee: "1000000", networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase, address: addr });
    onStatus({ type: "pending", msg: "Submitting..." });
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
    if (response.status === "ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status === "NOT_FOUND") { await new Promise(x => setTimeout(x, 1000)); r = await server.getTransaction(response.hash); }
    if (r.status === "SUCCESS") { onStatus({ type: "success", msg: "Confirmed", hash: response.hash }); return (r as any).returnValue ?? null; }
    throw new Error("Transaction failed on-chain");
  } catch (err: any) {
    onStatus({ type: "error", msg: err.message || "Transaction failed" });
    return null;
  }
}

// ─── Game types ───────────────────────────────────────────────────────────────
type GamePhase = "bidding" | "challenged" | "finished";
type PlayerSeat = "player1" | "player2";

interface Bid { qty: number; face: number; by: string; }

export default function LiarsDiceGamePage() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const params   = useParams();
  const router   = useRouter();
  const rawId    = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const escrowId = useMemo(() => (rawId ? BigInt(rawId) : null), [rawId]);

  // ── Escrow state ─────────────────────────────────────────────────────────
  const [escrowStatus, setEscrowStatus] = useState("loading");
  const [escrowData,   setEscrowData]   = useState<any>(null);
  const [potSize,      setPotSize]      = useState<bigint>(0n);
  const [mounted,      setMounted]      = useState(false);
  const [xlmBalance,   setXlmBalance]   = useState("0");
  const [loading,      setLoading]      = useState(false);
  const [joinLoading,  setJoinLoading]  = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [txStatus,     setTxStatus]     = useState<{ type: "success" | "error" | "pending"; msg: string; hash?: string } | null>(null);

  // ── Timer state (mirrors chess) ──────────────────────────────────────────
  const [p1TimeLeft, setP1TimeLeft] = useState(TIMER_SECONDS);
  const [p2TimeLeft, setP2TimeLeft] = useState(TIMER_SECONDS);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Game state ────────────────────────────────────────────────────────────
  const [myDice,       setMyDice]       = useState<number[]>([1, 2, 3, 4, 5]);
  const [oppDice,      setOppDice]      = useState<number[]>([1, 2, 3, 4, 5]);
  const [lastBid,      setLastBid]      = useState<Bid | null>(null);
  const [bidQty,       setBidQty]       = useState(1);
  const [bidFace,      setBidFace]      = useState(2);
  const [myTurn,       setMyTurn]       = useState(true);
  const [gamePhase,    setGamePhase]    = useState<GamePhase>("bidding");
  const [winner,       setWinner]       = useState<"player1" | "player2" | "draw" | null>(null);
  const [gameLog,      setGameLog]      = useState<string[]>(["Game started. Make the first bid."]);
  const [roundCount,   setRoundCount]   = useState(1);
  const [revealedDice, setRevealedDice] = useState<{ my: number[]; opp: number[] } | null>(null);
  const [shakingDice,  setShakingDice]  = useState(false);
  const [mySeat,       setMySeat]       = useState<PlayerSeat>("player1");

  // ── Refs for polling ─────────────────────────────────────────────────────
  const escrowStatusRef = useRef(escrowStatus);
  const connectedRef    = useRef(connectedAddress);
  const escrowIdRef     = useRef(escrowId);
  useEffect(() => { escrowStatusRef.current = escrowStatus; }, [escrowStatus]);
  useEffect(() => { connectedRef.current    = connectedAddress; }, [connectedAddress]);
  useEffect(() => { escrowIdRef.current     = escrowId; }, [escrowId]);

  useEffect(() => { setMounted(true); }, []);

  const loadBalance = useCallback(async () => {
    if (!connectedAddress) return;
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const d   = await res.json();
      const n   = d.balances?.find((b: any) => b.asset_type === "native");
      setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  useEffect(() => { if (mounted) loadBalance(); }, [loadBalance, mounted]);

  // ── Load escrow state ─────────────────────────────────────────────────────
  const loadGameState = useCallback(async () => {
    if (!escrowId) return;
    try {
      const ed = await simRead(ESCROW_CONTRACT_ID, "get_game",
        [nativeToScVal(escrowId, { type: "u64" })], connectedAddress || undefined);
      setEscrowData(ed);
      const status = parseStatus(ed.status);
      setEscrowStatus(status);
      setPotSize(status === "Active" ? BigInt(ed.stake) * 2n : BigInt(ed.stake));

      if (connectedAddress) {
        if (ed.white === connectedAddress)       setMySeat("player1");
        else if (ed.black === connectedAddress)  setMySeat("player2");
      }
      if (status === "Finished") setWinner("player1");
      if (status === "Drawn")    setWinner("draw");
    } catch { setEscrowStatus("error"); }
  }, [escrowId, connectedAddress]);

  useEffect(() => { if (mounted && escrowId) loadGameState(); }, [mounted, escrowId, loadGameState]);

  // Update seat when wallet connects after data loads
  useEffect(() => {
    if (!connectedAddress || !escrowData) return;
    if (escrowData.white === connectedAddress)      setMySeat("player1");
    else if (escrowData.black === connectedAddress) setMySeat("player2");
  }, [connectedAddress, escrowData]);

  // ── Timer (mirrors chess) ─────────────────────────────────────────────────
  useEffect(() => {
    if (escrowStatus !== "Active") return;
    timerRef.current = setInterval(() => {
      if (myTurn) setP1TimeLeft(t => Math.max(0, t - 1));
      else        setP2TimeLeft(t => Math.max(0, t - 1));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [escrowStatus, myTurn]);

  // ── Poll ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !escrowId) return;
    const poll = setInterval(async () => {
      const status = escrowStatusRef.current;
      if (["error", "loading", "Finished", "Drawn", "Cancelled"].includes(status)) return;
      try {
        const ed = await simRead(ESCROW_CONTRACT_ID, "get_game",
          [nativeToScVal(escrowIdRef.current!, { type: "u64" })], connectedRef.current || undefined);
        const newStatus = parseStatus(ed.status);
        if (newStatus !== escrowStatusRef.current) {
          setEscrowStatus(newStatus); setEscrowData(ed);
          if (newStatus === "Active")   setPotSize(BigInt(ed.stake) * 2n);
          if (newStatus === "Finished") setWinner("player1");
          if (newStatus === "Drawn")    setWinner("draw");
        }
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, [mounted, escrowId]);

  // Auto-dismiss toast
  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 8000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // ── Roll fresh dice for a new round ──────────────────────────────────────
  const rollDice = useCallback(() => {
    setMyDice(Array.from({ length: 5 }, () => Math.ceil(Math.random() * 6)));
    setOppDice(Array.from({ length: 5 }, () => Math.ceil(Math.random() * 6)));
  }, []);

  // Roll on game start
  useEffect(() => {
    if (escrowStatus === "Active") rollDice();
  }, [escrowStatus, rollDice]);

  // ── Join game ─────────────────────────────────────────────────────────────
  const handleJoinGame = async () => {
    if (!connectedAddress || !walletsKit || !escrowId || !escrowData) return;
    setJoinLoading(true);
    try {
      const joined = await sendTxDirect(connectedAddress, walletsKit,
        ESCROW_CONTRACT_ID, "join_game",
        [nativeToScVal(escrowId, { type: "u64" }), new Address(connectedAddress).toScVal()],
        setTxStatus);
      if (joined !== null) {
        setMySeat("player2");
        await loadGameState();
      } else {
        setTxStatus({ type: "error", msg: "Join failed — game not active after tx" });
      }
    } catch (err: any) {
      setTxStatus({ type: "error", msg: err.message || "Join failed" });
    } finally {
      setJoinLoading(false);
    }
  };

  // ── Escrow helper (mirrors chess escrowTx) ────────────────────────────────
  const escrowTx = useCallback(async (method: string, args: xdr.ScVal[]) => {
    if (!connectedAddress || !walletsKit || !escrowId) return null;
    setLoading(true);
    const r = await sendTx(connectedAddress, walletsKit, ESCROW_CONTRACT_ID, method, args, setTxStatus);
    setLoading(false);
    loadBalance();
    return r;
  }, [connectedAddress, walletsKit, escrowId, loadBalance]);

  // ── Finish game on-chain ──────────────────────────────────────────────────
  const handleFinishGame = useCallback(async (outcome: "WhiteWins" | "BlackWins" | "Draw") => {
    if (!connectedAddress || !escrowId || !walletsKit) {
      setWinner(outcome === "WhiteWins" ? "player1" : outcome === "BlackWins" ? "player2" : "draw");
      return;
    }
    setTxStatus({ type: "pending", msg: "Finishing game on-chain..." });
    const result = await escrowTx("finish_game", [
      nativeToScVal(escrowId, { type: "u64" }),
      new Address(connectedAddress).toScVal(),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
      nativeToScVal(`round_${roundCount}`, { type: "string" }),
    ]);
    if (result) {
      setWinner(outcome === "WhiteWins" ? "player1" : outcome === "BlackWins" ? "player2" : "draw");
      setEscrowStatus("Finished");
      await loadGameState();
    } else {
      setTxStatus({ type: "error", msg: "Transaction failed or rejected" });
    }
  }, [connectedAddress, escrowId, walletsKit, escrowTx, roundCount, loadGameState]);

  // ── Game actions ──────────────────────────────────────────────────────────
  const handlePlaceBid = useCallback(async () => {
    if (!myTurn || gamePhase !== "bidding") return;

    // Validate raise
    if (lastBid) {
      if (bidQty < lastBid.qty) {
        setTxStatus({ type: "error", msg: "Quantity must be ≥ current bid" });
        return;
      }
      if (bidQty === lastBid.qty && bidFace <= lastBid.face) {
        setTxStatus({ type: "error", msg: "Same quantity — must raise the face value" });
        return;
      }
    }

    const newBid: Bid = { qty: bidQty, face: bidFace, by: connectedAddress || "You" };
    setLastBid(newBid);
    setMyTurn(false);
    setGameLog(prev => [...prev, `You bid: ${bidQty} × [${bidFace}]`]);

    // ── Commit bid on-chain (wire your contract method here) ─────────────
    // await escrowTx("place_bid", [...]);

    // ── Simulate opponent response ────────────────────────────────────────
    setActionPending(true);
    setTimeout(() => {
      const oppQty  = bidQty + Math.ceil(Math.random() * 2);
      const oppFace = Math.ceil(Math.random() * 6);
      setLastBid({ qty: oppQty, face: oppFace, by: escrowData?.black || "Opponent" });
      setGameLog(prev => [...prev, `Opponent bid: ${oppQty} × [${oppFace}]`]);
      setBidQty(oppQty + 1);
      setMyTurn(true);
      setActionPending(false);
    }, 1600);
  }, [myTurn, gamePhase, lastBid, bidQty, bidFace, connectedAddress, escrowData]);

  const handleCallBluff = useCallback(async () => {
    if (!myTurn || gamePhase !== "bidding" || !lastBid) return;
    setGamePhase("challenged");
    setMyTurn(false);

    // Shake animation
    setShakingDice(true);
    setTimeout(() => setShakingDice(false), 600);

    const allDice  = [...myDice, ...oppDice];
    const actual   = allDice.filter(d => d === lastBid.face).length;
    const iWin     = actual < lastBid.qty;

    setRevealedDice({ my: myDice, opp: oppDice });
    setGameLog(prev => [
      ...prev,
      `You called the bluff! Actual [${lastBid.face}]s on the table: ${actual} (bid was ${lastBid.qty}).`,
      iWin ? "You win! The bid was a lie." : "Opponent wins! The bid was valid.",
    ]);

    // Determine on-chain outcome: player1 = white, player2 = black
    const outcome = iWin
      ? (mySeat === "player1" ? "WhiteWins" : "BlackWins")
      : (mySeat === "player1" ? "BlackWins" : "WhiteWins");

    setTimeout(async () => {
      setGamePhase("finished");
      await handleFinishGame(outcome);
    }, 2200);
  }, [myTurn, gamePhase, lastBid, myDice, oppDice, mySeat, handleFinishGame]);

  const handleResign = useCallback(async () => {
    const outcome = mySeat === "player1" ? "BlackWins" : "WhiteWins";
    setGameLog(prev => [...prev, "You resigned."]);
    await handleFinishGame(outcome);
  }, [mySeat, handleFinishGame]);

  const startNewRound = useCallback(() => {
    setLastBid(null);
    setBidQty(1);
    setBidFace(2);
    setMyTurn(true);
    setGamePhase("bidding");
    setRevealedDice(null);
    setRoundCount(r => r + 1);
    rollDice();
    setGameLog(prev => [...prev, `--- Round ${roundCount + 1} ---`]);
  }, [roundCount, rollDice]);

  if (!mounted || !escrowId) return null;

  const isPlayer1 = !!(connectedAddress && escrowData?.white === connectedAddress);
  const isPlayer2 = !!(connectedAddress && escrowData?.black && escrowData.black !== escrowData.white && escrowData.black === connectedAddress);
  const isPlayer  = isPlayer1 || isPlayer2;
  const canJoin   = !!(connectedAddress && escrowData && escrowData.white !== connectedAddress && escrowStatus === "Waiting");
  const stakeXlm  = escrowData ? (Number(escrowData.stake) / 10_000_000).toFixed(2) : "0";
  const opponentAddr = mySeat === "player1" ? escrowData?.black : escrowData?.white;
  const myAddr       = mySeat === "player1" ? escrowData?.white : escrowData?.black;
  const opTimeLeft   = mySeat === "player1" ? p2TimeLeft : p1TimeLeft;
  const myTimeLeft   = mySeat === "player1" ? p1TimeLeft : p2TimeLeft;

  // ── WAITING / LOADING VIEW ────────────────────────────────────────────────
  if (escrowStatus === "Waiting" || escrowStatus === "loading") {
    const isCreator = !!(connectedAddress && escrowData?.white === connectedAddress);
    return (
      <div className="min-h-screen text-zinc-200 overflow-x-hidden"
        style={{ background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily: "'Courier New',Courier,monospace" }}>
        <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)" }} />

        <div className="relative max-w-6xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-8">
            <button onClick={() => router.push("/liars-dice")}
              className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={14} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-600 font-mono">Game #{rawId}</span>
            {escrowStatus === "loading" && <RotateCcw size={12} className="animate-spin text-zinc-600" />}
          </header>

          {escrowStatus === "loading" ? (
            <div className="flex items-center justify-center py-32"><RotateCcw size={24} className="animate-spin text-zinc-600" /></div>
          ) : (
            <div className="flex flex-col xl:flex-row gap-6 items-start">
              {/* Canvas + player rows */}
              <div className="flex flex-col items-center gap-3 w-full xl:flex-1">
                {/* Opponent slot */}
                <div className="w-full max-w-xl flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl opacity-30">🎲</span>
                    <div>
                      <p className="text-xs font-bold text-zinc-600">Player 2</p>
                      <p className="text-[9px] text-zinc-700 flex items-center gap-1">
                        Waiting to join <ClockIcon className="w-3 h-3" />
                      </p>
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-amber-500/30 animate-pulse" />
                </div>

                {/* Animated preview */}
                <div className="w-full max-w-xl rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900/30" style={{ height: 280 }}>
                  <LiarsDiceCanvas />
                </div>

                {/* Creator slot */}
                <div className="w-full max-w-xl flex items-center justify-between px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🎲</span>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">{isCreator ? "You — Player 1" : "Player 1"}</p>
                      <p className="text-[9px] text-zinc-600">{escrowData?.white ? formatAddress(escrowData.white) : ""}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Side panel */}
              <div className="flex flex-col gap-4 w-full xl:w-72 shrink-0">
                <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">Waiting for Opponent</p>
                  </div>
                  <p className="text-zinc-500 text-sm">Game #{rawId} · {stakeXlm} XLM locked</p>
                </div>

                {canJoin && (
                  <div className="border border-emerald-500/25 rounded-2xl p-5 bg-emerald-500/5 space-y-4">
                    <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Join This Game</h3>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Stake required</p><p className="text-amber-400 font-black text-base">{stakeXlm} XLM</p></div>
                      <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Prize pot</p><p className="text-white font-bold">{(parseFloat(stakeXlm) * 2).toFixed(2)} XLM</p></div>
                    </div>
                    <button onClick={handleJoinGame} disabled={joinLoading}
                      className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2">
                      {joinLoading ? <><RotateCcw size={14} className="animate-spin" /> Joining</> : <>Stake & Join as Player 2</>}
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
                        {typeof window !== "undefined" ? `${window.location.origin}/liars-dice/${rawId}` : ""}
                      </span>
                      <button onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/liars-dice/${rawId}`);
                        setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000);
                      }}>
                        {inviteCopied ? <CheckCheck size={13} className="text-emerald-400" /> : <Copy size={13} className="text-zinc-600 hover:text-amber-400" />}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div className="bg-black border border-zinc-800 rounded-xl px-3 py-2.5">
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">Game ID</p>
                        <p className="text-amber-400 font-black">#{rawId}</p>
                      </div>
                      <div className="bg-black border border-zinc-800 rounded-xl px-3 py-2.5">
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">Stake</p>
                        <p className="text-amber-400 font-black">{stakeXlm} XLM</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border border-zinc-800/50 rounded-2xl p-5 bg-zinc-900/20 space-y-3 text-[10px]">
                  <div className="flex justify-between"><span className="text-zinc-600 uppercase tracking-widest">Stake locked</span><span className="text-amber-400 font-bold">{stakeXlm} XLM</span></div>
                  <div className="flex justify-between"><span className="text-zinc-600 uppercase tracking-widest">Winner gets</span><span className="text-emerald-400 font-bold">{(parseFloat(stakeXlm) * 2 * 0.985).toFixed(2)} XLM</span></div>
                </div>

                <button onClick={loadGameState}
                  className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                  <RotateCcw size={11} /> Reload
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ERROR VIEW ────────────────────────────────────────────────────────────
  if (escrowStatus === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "#050508", fontFamily: "'Courier New',Courier,monospace" }}>
        <div className="text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-rose-500" />
          <p className="text-zinc-400">Game #{rawId} not found</p>
          <div className="flex gap-3 justify-center">
            <button onClick={loadGameState}
              className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-2">
              <RotateCcw size={14} /> Retry
            </button>
            <button onClick={() => router.push("/liars-dice")}
              className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors">
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ACTIVE / FINISHED VIEW ────────────────────────────────────────────────
  const opActive = !myTurn && escrowStatus === "Active";
  const myActive =  myTurn && escrowStatus === "Active";

  return (
    <div className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{ background: "radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily: "'Courier New',Courier,monospace" }}>
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)" }} />

      <div className="relative max-w-6xl mx-auto px-4 py-6 pb-32">
        {/* ── Header ── */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/liars-dice")}
              className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">Game #{rawId}</span>
            <span className="text-[10px] text-zinc-700 font-mono">Round {roundCount}</span>

            {/* Action pending overlay */}
            <AnimatePresence>
              {actionPending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
                  <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-zinc-900 border border-amber-500/30 rounded-3xl p-8 max-w-sm w-full mx-4 text-center">
                    <div className="flex justify-center mb-6">
                      <div className="w-16 h-16 rounded-full border-4 border-amber-500/30 border-t-amber-500 animate-spin" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Confirm Action</h3>
                    <p className="text-zinc-400 text-sm">Please confirm the transaction in your wallet</p>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-3">
            {!isPlayer && (
              <div className="px-3 py-1.5 border border-zinc-700 rounded-xl flex items-center justify-center">
                <EyeIcon className="w-3 h-3 text-zinc-500" />
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          {/* ── Board / Dice area ── */}
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">

            {/* Opponent row */}
            <div className={`w-full max-w-xl flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${opActive ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800/40 bg-zinc-900/20"}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎲</span>
                <div>
                  <p className="text-xs font-bold text-zinc-300">{isPlayer ? "Opponent" : "Player 2"}</p>
                  <p className="text-[9px] text-zinc-600">
                    {mySeat === "player1" ? "Player 2" : "Player 1"}
                    {opponentAddr ? " · " + formatAddress(opponentAddr) : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Hidden opponent dice */}
                <div className="flex gap-1.5">
                  {(revealedDice ? revealedDice.opp : Array(5).fill(1)).map((v, i) => (
                    <Die key={i} value={v} hidden={!revealedDice} size={34} shaking={shakingDice} />
                  ))}
                </div>
                {/* Timer */}
                <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                  escrowStatus === "Finished" || escrowStatus === "Drawn"
                    ? winner === (mySeat === "player1" ? "player2" : "player1")
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : winner === "draw"
                      ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                      : "bg-zinc-900 text-zinc-600 border-zinc-800"
                    : opActive
                    ? "bg-amber-500 text-black border-amber-400"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800"
                }`}>
                  {escrowStatus === "Finished" || escrowStatus === "Drawn"
                    ? winner === (mySeat === "player1" ? "player2" : "player1") ? "Won"
                      : winner === "draw" ? "Draw" : "Lost"
                    : formatTime(opTimeLeft)}
                </div>
              </div>
            </div>

            {/* ── Current bid display ── */}
            <div className="w-full max-w-xl rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
              {lastBid ? (
                <div className="space-y-1">
                  <p className="text-[9px] text-amber-600 uppercase tracking-widest">Current Bid</p>
                  <p className="text-4xl font-black text-amber-400 tabular-nums">
                    {lastBid.qty} × <span className="text-white">[{lastBid.face}]</span>
                  </p>
                  <p className="text-[10px] text-zinc-600">by {formatAddress(lastBid.by)}</p>
                  {/* Visual dice face reminder */}
                  <div className="flex justify-center mt-2">
                    <Die value={lastBid.face} size={40} highlight />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest">No bid yet</p>
                  <p className="text-zinc-500 text-sm">Be the first to bid</p>
                </div>
              )}
            </div>

            {/* ── Bid controls (only when it's my turn & game is active) ── */}
            {isPlayer && escrowStatus === "Active" && gamePhase === "bidding" && myTurn && (
              <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Your Bid</p>

                <div className="grid grid-cols-2 gap-5">
                  {/* Quantity */}
                  <div className="space-y-2">
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Quantity (how many)</p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setBidQty(q => Math.max(1, q - 1))}
                        className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 flex items-center justify-center text-xl font-black transition-colors">
                        −
                      </button>
                      <span className="text-3xl font-black text-white w-10 text-center tabular-nums">{bidQty}</span>
                      <button onClick={() => setBidQty(q => Math.min(10, q + 1))}
                        className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 flex items-center justify-center text-xl font-black transition-colors">
                        +
                      </button>
                    </div>
                    {lastBid && <p className="text-[9px] text-zinc-700">Min: {lastBid.qty}</p>}
                  </div>

                  {/* Face value */}
                  <div className="space-y-2">
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Face value</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1, 2, 3, 4, 5, 6].map(f => (
                        <button key={f} onClick={() => setBidFace(f)}
                          className={`rounded-lg border flex items-center justify-center transition-all p-1.5 ${bidFace === f ? "border-amber-500/60 bg-amber-500/15" : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"}`}>
                          <svg viewBox="-1.5 -1.5 3 3" width="22" height="22">
                            {(DOTS[f - 1] || []).map(([dx, dy], i) => (
                              <circle key={i} cx={dx * 0.82} cy={dy * 0.82} r={0.28} fill={bidFace === f ? "#d97706" : "#888"} />
                            ))}
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bid summary line */}
                <div className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-center">
                  <p className="text-xs text-zinc-400">
                    Your bid: <span className="text-amber-400 font-black">{bidQty} × [{bidFace}]</span>
                    {lastBid && (
                      <span className="text-zinc-600 ml-2">
                        (current: {lastBid.qty} × [{lastBid.face}])
                      </span>
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handlePlaceBid} disabled={actionPending}
                    className="py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg,#d97706,#b45309)", boxShadow: "0 0 20px -6px rgba(217,119,6,0.5)", color: "#000" }}>
                    {actionPending ? <RotateCcw size={14} className="animate-spin" /> : "Place Bid"}
                  </button>
                  {lastBid && (
                    <button onClick={handleCallBluff} disabled={actionPending}
                      className="py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all active:scale-95 disabled:opacity-40 border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 flex items-center justify-center gap-2">
                      <Flag size={14} /> Call Bluff!
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Waiting for opponent */}
            {isPlayer && escrowStatus === "Active" && gamePhase === "bidding" && !myTurn && (
              <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/20 p-5 flex items-center gap-3">
                <RotateCcw size={14} className="animate-spin text-amber-500 shrink-0" />
                <p className="text-sm text-zinc-500">Waiting for opponent to bid...</p>
              </div>
            )}

            {/* Reveal phase */}
            {gamePhase === "challenged" && revealedDice && (
              <div className="w-full max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
                <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">Dice Revealed!</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Your dice</p>
                    <div className="flex gap-2">
                      {revealedDice.my.map((v, i) => (
                        <Die key={i} value={v} size={44}
                          highlight={lastBid ? v === lastBid.face : false}
                          shaking={shakingDice} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Opponent's dice</p>
                    <div className="flex gap-2">
                      {revealedDice.opp.map((v, i) => (
                        <Die key={i} value={v} size={44}
                          highlight={lastBid ? v === lastBid.face : false}
                          shaking={shakingDice} />
                      ))}
                    </div>
                  </div>
                  {lastBid && (
                    <div className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500">
                      Total [{lastBid.face}]s found: <span className="text-white font-bold">
                        {[...revealedDice.my, ...revealedDice.opp].filter(d => d === lastBid.face).length}
                      </span> / bid was <span className="text-amber-400 font-bold">{lastBid.qty}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* My dice row */}
            <div className={`w-full max-w-xl flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${myActive ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800/40 bg-zinc-900/20"}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎲</span>
                <div>
                  <p className="text-xs font-bold text-zinc-300">{isPlayer ? "You" : "Spectating"}</p>
                  <p className="text-[9px] text-zinc-600">
                    {mySeat === "player1" ? "Player 1" : "Player 2"}
                    {connectedAddress ? " · " + formatAddress(connectedAddress) : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* My dice — always visible to me */}
                <div className="flex gap-1.5">
                  {myDice.map((v, i) => (
                    <Die key={i} value={v} size={34}
                      highlight={lastBid ? v === lastBid.face : false} />
                  ))}
                </div>
                {/* Timer */}
                <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${
                  escrowStatus === "Finished" || escrowStatus === "Drawn"
                    ? winner === mySeat
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : winner === "draw"
                      ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                      : "bg-zinc-900 text-zinc-600 border-zinc-800"
                    : myActive
                    ? "bg-amber-500 text-black border-amber-400"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800"
                }`}>
                  {escrowStatus === "Finished" || escrowStatus === "Drawn"
                    ? winner === mySeat ? "Won" : winner === "draw" ? "Draw" : "Lost"
                    : formatTime(myTimeLeft)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Side panel ── */}
          <div className="flex flex-col gap-4 w-full lg:w-64">
            {/* Pot */}
            <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5">
              <p className="text-[9px] text-amber-600/80 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Coins size={10} /> Prize Pot
              </p>
              <p className="text-3xl font-black text-amber-400 tabular-nums">
                {stroopsToXlm(potSize)}
                <span className="text-sm text-amber-600 ml-2 font-bold">XLM</span>
              </p>
              <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98.5% · 1.5% fee</p>
            </div>

            {/* Status card — mirrors chess exactly */}
            <div className={`rounded-2xl p-4 border ${
              escrowStatus === "Finished" || escrowStatus === "Drawn"
                ? winner === mySeat
                  ? "border-amber-500/40 bg-amber-500/8"
                  : winner === "draw"
                  ? "border-zinc-600/40 bg-zinc-800/30"
                  : "border-zinc-800/40 bg-zinc-900/20"
                : "border-zinc-800 bg-zinc-900/20"
            }`}>
              {(escrowStatus === "Finished" || escrowStatus === "Drawn") && winner ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${winner === "draw" ? "bg-zinc-400" : "bg-amber-400"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Game Over</span>
                  </div>
                  {/* Winner row */}
                  <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🎲</span>
                      <div>
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                          {winner === "draw" ? "Draw" : winner === "player1" ? "Player 1 wins" : "Player 2 wins"}
                        </p>
                        <p className="text-[9px] text-zinc-600 font-mono">
                          {winner === "draw"
                            ? formatAddress(escrowData?.white || "")
                            : winner === "player1"
                            ? formatAddress(escrowData?.white || "")
                            : formatAddress(escrowData?.black || "")}
                        </p>
                      </div>
                    </div>
                    <span className="text-lg">🏆</span>
                  </div>
                  {/* Loser row */}
                  {winner !== "draw" && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-zinc-900/40 border border-zinc-800/50">
                      <div className="flex items-center gap-2">
                        <span className="text-base opacity-40">🎲</span>
                        <div>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                            {winner === "player1" ? "Player 2" : "Player 1"}
                          </p>
                          <p className="text-[9px] text-zinc-700 font-mono">
                            {winner === "player1" ? formatAddress(escrowData?.black || "") : formatAddress(escrowData?.white || "")}
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
                    <div className={`w-2 h-2 rounded-full ${myTurn && isPlayer ? "bg-amber-400 animate-pulse" : "bg-zinc-600"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isPlayer ? (myTurn ? "Your turn" : "Opponent's turn") : "Spectating"}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Round <span className="text-white font-bold">{roundCount}</span>
                    {lastBid
                      ? <> · Last bid: <span className="text-amber-400">{lastBid.qty} × [{lastBid.face}]</span></>
                      : <> · No bid placed yet</>}
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span className="text-[10px] uppercase tracking-widest text-zinc-500">{escrowStatus}</span>
                </div>
              )}
            </div>

            {/* New Round button (after a round ends but game continues) */}
            {isPlayer && escrowStatus === "Active" && gamePhase === "challenged" && (
              <button onClick={startNewRound}
                className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all active:scale-95 border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 flex items-center justify-center gap-2">
                <RotateCcw size={13} /> New Round
              </button>
            )}

            {/* Resign */}
            {isPlayer && escrowStatus === "Active" && gamePhase === "bidding" && (
              <button onClick={handleResign} disabled={loading}
                className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40">
                <Flag size={12} /> Resign
              </button>
            )}

            {/* Game log */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
              <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">
                Game Log ({gameLog.length})
              </h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {gameLog.map((entry, i) => (
                  <p key={i} className={`text-[10px] font-mono leading-relaxed ${
                    entry.startsWith("---") ? "text-zinc-600 text-center" :
                    entry.includes("win") || entry.includes("Won") ? "text-emerald-400" :
                    entry.includes("Opponent") ? "text-zinc-400" : "text-zinc-500"
                  }`}>{entry}</p>
                ))}
              </div>
            </div>

            {/* Contract link */}
            <div className="border border-zinc-800/50 rounded-xl p-3">
              <a href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1">
                Escrow · {formatAddress(ESCROW_CONTRACT_ID)} <ExternalLink size={8} />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {txStatus && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${
              txStatus.type === "success" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
              txStatus.type === "error"   ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
                                           "bg-zinc-800/50 border-zinc-700/30 text-zinc-300"
            }`}>
            <div className="flex items-center gap-3 text-sm">
              {txStatus.type === "pending" ? <RotateCcw size={14} className="animate-spin" /> : <Zap size={14} />}
              <span className="text-xs">{txStatus.msg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash && (
                <a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`}
                  target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-white/10 rounded-lg">
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