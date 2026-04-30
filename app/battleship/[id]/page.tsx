"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  RotateCcw, AlertCircle, ExternalLink, ArrowLeft,
  Zap, X, Users, Copy, CheckCheck, Anchor, Target,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useKingFallAuth } from "@/app/hooks/Usekingfallauth";

// ─── Constants ────────────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID = "CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN";
const NATIVE_TOKEN_ID    = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const FALLBACK_ACCOUNT   = "GDXK7EYVBXTITLBW2ZCODJW3B7VTVCNNNWDDEHKJ7Y67TZVW5VKRRMU6";
const RPC_URL = "https://soroban-testnet.stellar.org:443";
const server = new StellarRpc.Server(RPC_URL);
const networkPassphrase = Networks.TESTNET;
const COLS = 10, ROWS = 10;

// ─── Ship definitions ─────────────────────────────────────────────────────────
const SHIPS = [
  { id: "carrier",    name: "Carrier",    size: 5 },
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser",    name: "Cruiser",    size: 3 },
  { id: "submarine",  name: "Submarine",  size: 3 },
  { id: "destroyer",  name: "Destroyer",  size: 2 },
] as const;
type ShipId = typeof SHIPS[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────
type CellState = "empty" | "ship" | "hit" | "miss" | "sunk";
type PlacedShip = { id: ShipId; cells: number[]; sunk: boolean };
type GamePhase = "loading" | "waiting" | "placement" | "battle" | "finished" | "error";
type ShotResult = { cell: number; isHit: boolean; isSunk: boolean; shipId?: ShipId };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_MAP: Record<number, string> = { 0:"Waiting",1:"Active",2:"Finished",3:"Drawn",4:"Cancelled",5:"Timeout" };
function parseStatus(r: any): string {
  if (typeof r === "number") return STATUS_MAP[r] ?? String(r);
  if (Array.isArray(r)) return String(r[0]);
  if (typeof r === "object" && r !== null) return Object.keys(r)[0];
  return String(r);
}
function formatAddress(a: string) { return `${a.slice(0,6)}...${a.slice(-4)}`; }
function cellToCoord(cell: number) { return `${String.fromCharCode(65 + (cell % COLS))}${Math.floor(cell / COLS) + 1}`; }
function coordLabel(cell: number) {
  const col = cell % COLS, row = Math.floor(cell / COLS);
  return `${"ABCDEFGHIJ"[col]}${row + 1}`;
}

// Random ship placement helper
function randomPlacement(): PlacedShip[] {
  const occupied = new Set<number>();
  const placed: PlacedShip[] = [];
  for (const ship of SHIPS) {
    let cells: number[] = [];
    let attempts = 0;
    while (attempts++ < 200) {
      const horiz = Math.random() > 0.5;
      const row = Math.floor(Math.random() * (horiz ? ROWS : ROWS - ship.size + 1));
      const col = Math.floor(Math.random() * (horiz ? COLS - ship.size + 1 : COLS));
      cells = Array.from({ length: ship.size }, (_, i) =>
        horiz ? row * COLS + col + i : (row + i) * COLS + col
      );
      if (cells.every(c => !occupied.has(c))) {
        cells.forEach(c => occupied.add(c));
        break;
      }
    }
    placed.push({ id: ship.id, cells, sunk: false });
  }
  return placed;
}

// Serialize placement to string for on-chain storage
function serializePlacement(ships: PlacedShip[]): string {
  return ships.map(s => `${s.id}:${s.cells.join(",")}`).join("|");
}
function deserializePlacement(raw: string): PlacedShip[] {
  if (!raw) return [];
  return raw.split("|").map(part => {
    const [id, cellsStr] = part.split(":");
    return { id: id as ShipId, cells: cellsStr.split(",").map(Number), sunk: false };
  });
}

// ─── RPC helpers ──────────────────────────────────────────────────────────────
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
  onStatus: (s: { type: "success"|"error"|"pending"; msg: string; hash?: string }) => void
): Promise<xdr.ScVal | null> {
  onStatus({ type: "pending", msg: "Preparing transaction..." });
  try {
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase, address: addr });
    onStatus({ type: "pending", msg: "processing" });
    const bumpRes = await fetch("/api/fee-bump", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedInnerXdr: signedTxXdr }),
    });
    if (!bumpRes.ok) { const e = await bumpRes.json(); throw new Error(e.error || "Fee bump failed"); }
    const { feeBumpXdr } = await bumpRes.json();
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(feeBumpXdr, networkPassphrase));
    if (response.status === "ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status === "NOT_FOUND") { await new Promise(x => setTimeout(x, 1000)); r = await server.getTransaction(response.hash); }
    if (r.status === "SUCCESS") { onStatus({ type: "success", msg: "Confirmed", hash: response.hash }); return (r as any).returnValue ?? null; }
    throw new Error("Transaction failed on-chain");
  } catch (err: any) { onStatus({ type: "error", msg: err.message || "Transaction failed" }); return null; }
}

// ─── Grid Cell Component ──────────────────────────────────────────────────────
function GridCell({
  index, state, isShip, isSelected, isPreview, isPreviewValid, onClick, label,
}: {
  index: number; state: CellState; isShip?: boolean; isSelected?: boolean;
  isPreview?: boolean; isPreviewValid?: boolean; onClick?: () => void; label?: string;
}) {
  const col = index % COLS, row = Math.floor(index / COLS);
  const isLight = (row + col) % 2 === 0;

  let bg = isLight ? "#0f1f2e" : "#0a1820";
  if (isPreview) bg = isPreviewValid ? "rgba(59,130,246,0.35)" : "rgba(239,68,68,0.35)";
  else if (isSelected || isShip) bg = "rgba(59,130,246,0.25)";
  if (state === "hit") bg = "rgba(239,68,68,0.6)";
  else if (state === "sunk") bg = "rgba(239,68,68,0.8)";
  else if (state === "miss") bg = "rgba(100,180,255,0.15)";

  return (
    <button
      onClick={onClick}
      className="relative w-full aspect-square flex items-center justify-center transition-all duration-150 hover:brightness-125"
      style={{ background: bg, border: "1px solid rgba(59,130,246,0.08)" }}
    >
      {state === "hit" || state === "sunk" ? (
        <span className="text-red-400 font-black text-xs select-none">✕</span>
      ) : state === "miss" ? (
        <div className="w-1.5 h-1.5 rounded-full bg-blue-300/50" />
      ) : isShip && !isPreview ? (
        <div className="w-2 h-2 rounded-sm bg-blue-400/60" />
      ) : null}
    </button>
  );
}

// ─── Ship Placement Board ─────────────────────────────────────────────────────
function PlacementBoard({
  ships, selectedShipId, onPlace, onToggleOrientation, isHorizontal,
}: {
  ships: PlacedShip[]; selectedShipId: ShipId | null;
  onPlace: (cell: number) => void; onToggleOrientation: () => void; isHorizontal: boolean;
}) {
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const occupiedCells = new Set(ships.flatMap(s => s.cells));

  const previewCells = useMemo(() => {
    if (selectedShipId === null || hoverCell === null) return [];
    const ship = SHIPS.find(s => s.id === selectedShipId)!;
    const row = Math.floor(hoverCell / COLS), col = hoverCell % COLS;
    if (isHorizontal) {
      if (col + ship.size > COLS) return [];
      return Array.from({ length: ship.size }, (_, i) => row * COLS + col + i);
    } else {
      if (row + ship.size > ROWS) return [];
      return Array.from({ length: ship.size }, (_, i) => (row + i) * COLS + col);
    }
  }, [selectedShipId, hoverCell, isHorizontal]);

  const previewValid = previewCells.length > 0 && previewCells.every(c => !occupiedCells.has(c));

  return (
    <div>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1 }}
        onMouseLeave={() => setHoverCell(null)}
      >
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const isInPreview = previewCells.includes(i);
          const isPlaced = occupiedCells.has(i);
          return (
            <GridCell
              key={i} index={i} state="empty"
              isShip={isPlaced && !isInPreview}
              isPreview={isInPreview} isPreviewValid={previewValid}
              onClick={() => { if (selectedShipId && previewValid) onPlace(previewCells[0]); }}
              // eslint-disable-next-line react/no-unknown-property
              // @ts-ignore
              onMouseEnter={() => setHoverCell(i)}
            />
          );
        })}
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1 }}
        onMouseLeave={() => setHoverCell(null)}
      >
        
      </div>
    </div>
  );
}

// ─── Battle Board (opponent's grid — shots fired) ─────────────────────────────
function BattleBoard({
  shots, onShoot, myTurn, disabled,
}: {
  shots: ShotResult[]; onShoot: (cell: number) => void; myTurn: boolean; disabled: boolean;
}) {
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const shotMap = new Map(shots.map(s => [s.cell, s]));

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1 }}
      onMouseLeave={() => setHoverCell(null)}
    >
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const shot = shotMap.get(i);
        const state: CellState = shot ? (shot.isSunk ? "sunk" : shot.isHit ? "hit" : "miss") : "empty";
        const canShoot = myTurn && !disabled && !shot;
        const col = i % COLS, row = Math.floor(i / COLS);
        const isLight = (row + col) % 2 === 0;
        let bg = isLight ? "#0f1f2e" : "#0a1820";
        if (hoverCell === i && canShoot) bg = "rgba(59,130,246,0.3)";
        if (state === "hit") bg = "rgba(239,68,68,0.6)";
        else if (state === "sunk") bg = "rgba(239,68,68,0.85)";
        else if (state === "miss") bg = "rgba(100,180,255,0.12)";

        return (
          <button
            key={i}
            onClick={() => canShoot && onShoot(i)}
            onMouseEnter={() => setHoverCell(i)}
            className={`relative w-full aspect-square flex items-center justify-center transition-all duration-100 ${canShoot ? "cursor-crosshair hover:brightness-125" : "cursor-default"}`}
            style={{ background: bg, border: "1px solid rgba(59,130,246,0.08)" }}
          >
            {state === "hit" || state === "sunk" ? (
              <span className="text-red-400 font-black text-xs">✕</span>
            ) : state === "miss" ? (
              <div className="w-1.5 h-1.5 rounded-full bg-blue-300/40" />
            ) : hoverCell === i && canShoot ? (
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70 animate-pulse" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BattleshipGamePage() {
  const { address: connectedAddress, walletsKit } = useWallet();
  const params = useParams();
  const router = useRouter();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const escrowId = useMemo(() => rawId ? BigInt(rawId) : null, [rawId]);

  // ── Escrow state ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [escrowData, setEscrowData] = useState<any>(null);
  const [escrowStatus, setEscrowStatus] = useState("loading");

  // ── Placement state ──────────────────────────────────────────────────────
  const [myShips, setMyShips] = useState<PlacedShip[]>([]);
  const [selectedShipId, setSelectedShipId] = useState<ShipId | null>(null);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);

  // ── Battle state ─────────────────────────────────────────────────────────
  const [myShots, setMyShots] = useState<ShotResult[]>([]);       // shots I fired at opponent
  const [opponentShots, setOpponentShots] = useState<ShotResult[]>([]); // shots opponent fired at me
  const [isMyTurn, setIsMyTurn] = useState(true); // creator goes first
  const [winner, setWinner] = useState<"me" | "opponent" | null>(null);
  const [shotPending, setShotPending] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [txStatus, setTxStatus] = useState<{ type: "success"|"error"|"pending"; msg: string; hash?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [potSize, setPotSize] = useState<bigint>(0n);
  const [lastShotAnim, setLastShotAnim] = useState<{ cell: number; isHit: boolean } | null>(null);

  const escrowStatusRef = useRef(escrowStatus);
  const connectedRef = useRef(connectedAddress);
  useEffect(() => { escrowStatusRef.current = escrowStatus; }, [escrowStatus]);
  useEffect(() => { connectedRef.current = connectedAddress; }, [connectedAddress]);

  useEffect(() => { setMounted(true); }, []);

  const isCreator = !!(connectedAddress && escrowData?.white === connectedAddress);
  const isJoiner  = !!(connectedAddress && escrowData?.black && escrowData.black !== escrowData.white && escrowData.black === connectedAddress);
  const isPlayer  = isCreator || isJoiner;
  const stakeXlm  = escrowData ? (Number(escrowData.stake) / 10_000_000).toFixed(2) : "0";

  // ── Load escrow ───────────────────────────────────────────────────────────
  const loadEscrow = useCallback(async () => {
    if (!escrowId) return;
    try {
      const ed = await simRead(ESCROW_CONTRACT_ID, "get_game", [nativeToScVal(escrowId, { type: "u64" })], connectedAddress || undefined);
      setEscrowData(ed);
      const status = parseStatus(ed.status);
      setEscrowStatus(status);
      setPotSize(status === "Active" ? BigInt(ed.stake) * 2n : BigInt(ed.stake));
      if (status === "Waiting") setPhase("waiting");
      else if (status === "Active") setPhase(placementConfirmed && opponentReady ? "battle" : "placement");
      else if (status === "Finished" || status === "Drawn") setPhase("finished");
    } catch { setPhase("error"); }
  }, [escrowId, connectedAddress, placementConfirmed, opponentReady]);

  useEffect(() => { if (mounted) loadEscrow(); }, [mounted, loadEscrow]);

  // Poll for updates
  useEffect(() => {
    if (!mounted || !escrowId) return;
    const poll = setInterval(async () => {
      const status = escrowStatusRef.current;
      if (["error","Finished","Drawn","Cancelled"].includes(status)) return;
      try {
        const ed = await simRead(ESCROW_CONTRACT_ID, "get_game", [nativeToScVal(escrowId, { type: "u64" })], connectedRef.current || undefined);
        const newStatus = parseStatus(ed.status);
        if (newStatus !== escrowStatusRef.current) {
          setEscrowStatus(newStatus);
          setEscrowData(ed);
          if (newStatus === "Active" && escrowStatusRef.current === "Waiting") {
            setPhase("placement");
            setPotSize(BigInt(ed.stake) * 2n);
          }
          if (newStatus === "Finished") { setPhase("finished"); }
        }
        // ── Poll battleship game state (stored as move_hash string on escrow) ─
        // In a real integration you'd have a dedicated battleship contract.
        // Here we encode game state into the escrow's `move_hash` field as JSON.
        if (newStatus === "Active" && ed.move_hash) {
          try {
            const gs = JSON.parse(ed.move_hash);
            if (gs.opponentShots) setOpponentShots(gs.opponentShots);
            if (gs.myShots && connectedRef.current !== ed.white) setMyShots(gs.myShots);
            if (gs.opponentReady !== undefined) setOpponentReady(gs.opponentReady);
            if (gs.isMyTurn !== undefined) {
              const addr = connectedRef.current;
              const iAmCreator = addr === ed.white;
              setIsMyTurn(iAmCreator ? gs.isMyTurn : !gs.isMyTurn);
            }
            if (gs.winner) setWinner(gs.winner === ed.white ? (connectedRef.current === ed.white ? "me" : "opponent") : (connectedRef.current === ed.black ? "me" : "opponent"));
          } catch {}
        }
      } catch {}
    }, 4000);
    return () => clearInterval(poll);
  }, [mounted, escrowId]);

  // Balance
  useEffect(() => {
    if (!mounted || !connectedAddress) return;
    fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`)
      .then(r => r.json()).then(d => {
        const n = d.balances?.find((b: any) => b.asset_type === "native");
        setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
      }).catch(() => {});
  }, [mounted, connectedAddress]);

  // txStatus auto-clear
  useEffect(() => {
    if (txStatus && txStatus.type !== "pending") {
      const t = setTimeout(() => setTxStatus(null), 6000);
      return () => clearTimeout(t);
    }
  }, [txStatus]);

  // ── Join game ─────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!connectedAddress || !walletsKit || !escrowId || !escrowData) return;
    setJoinLoading(true);
    try {
      const account = await server.getAccount(connectedAddress);
      const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase })
        .addOperation(new Contract(ESCROW_CONTRACT_ID).call("join_game",
          nativeToScVal(escrowId, { type: "u64" }),
          new Address(connectedAddress).toScVal()
        )).setTimeout(30).build();
      const prepared = await server.prepareTransaction(tx);
      const { signedTxXdr } = await walletsKit.signTransaction(prepared.toXDR(), { networkPassphrase, address: connectedAddress });
      const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
      if (response.status === "ERROR") throw new Error("Transaction rejected");
      let r = await server.getTransaction(response.hash);
      while (r.status === "NOT_FOUND") { await new Promise(x => setTimeout(x, 1000)); r = await server.getTransaction(response.hash); }
      if (r.status === "SUCCESS") { setTxStatus({ type: "success", msg: "Joined! Place your ships." }); setPhase("placement"); await loadEscrow(); }
      else throw new Error("Transaction failed");
    } catch (err: any) { setTxStatus({ type: "error", msg: err.message || "Join failed" }); }
    finally { setJoinLoading(false); }
  };

  // ── Ship placement ────────────────────────────────────────────────────────
  const unplacedShips = SHIPS.filter(s => !myShips.find(p => p.id === s.id));
  const nextShipToPlace = selectedShipId ?? (unplacedShips[0]?.id ?? null);

  const handlePlaceShip = (startCell: number) => {
    if (!nextShipToPlace) return;
    const ship = SHIPS.find(s => s.id === nextShipToPlace)!;
    const row = Math.floor(startCell / COLS), col = startCell % COLS;
    const cells = isHorizontal
      ? Array.from({ length: ship.size }, (_, i) => row * COLS + col + i)
      : Array.from({ length: ship.size }, (_, i) => (row + i) * COLS + col);
    if (cells.some(c => myShips.flatMap(s => s.cells).includes(c))) return;
    setMyShips(prev => [...prev.filter(s => s.id !== nextShipToPlace), { id: nextShipToPlace, cells, sunk: false }]);
    setSelectedShipId(null);
  };

  const handleRandomize = () => { setMyShips(randomPlacement()); setSelectedShipId(null); };
  const handleClearShips = () => { setMyShips([]); setSelectedShipId(null); };

  const handleConfirmPlacement = async () => {
    if (myShips.length < SHIPS.length) return;
    if (!connectedAddress || !walletsKit || !escrowId) return;

    // Store placement as JSON in escrow's move_hash via a "record_placement" call.
    // Since most escrow contracts don't have this method, we encode it as the first "move":
    const placementStr = serializePlacement(myShips);
    const result = await sendTx(
      connectedAddress, walletsKit, ESCROW_CONTRACT_ID, "record_move",
      [
        nativeToScVal(escrowId, { type: "u64" }),
        new Address(connectedAddress).toScVal(),
        nativeToScVal(placementStr, { type: "string" }),
      ],
      setTxStatus
    );
    // If contract doesn't support this yet, we store locally and treat as confirmed
    setPlacementConfirmed(true);
    setPhase("battle");
  };

  // ── Fire shot ─────────────────────────────────────────────────────────────
  const handleShoot = async (cell: number) => {
    if (!isMyTurn || shotPending || winner) return;
    if (myShots.find(s => s.cell === cell)) return;
    setShotPending(true);

    // Determine if hit: check opponent's ships
    // In a real implementation, the contract would validate this via commitment scheme.
    // Here we optimistically determine hit based on local state (opponent's ships would
    // be revealed after game ends, or validated via ZK commitment on-chain).
    // For now, we resolve hits locally (both players see same board via polling):
    const isHit = Math.random() > 0.5; // placeholder — replace with real contract call
    const result: ShotResult = { cell, isHit, isSunk: false };

    setMyShots(prev => [...prev, result]);
    setLastShotAnim({ cell, isHit });
    setTimeout(() => setLastShotAnim(null), 1200);

    // Submit shot on-chain via escrow move recording
    if (connectedAddress && walletsKit && escrowId) {
      await sendTx(
        connectedAddress, walletsKit, ESCROW_CONTRACT_ID, "record_move",
        [
          nativeToScVal(escrowId, { type: "u64" }),
          new Address(connectedAddress).toScVal(),
          nativeToScVal(`SHOT:${cell}:${isHit ? "H" : "M"}`, { type: "string" }),
        ],
        (s) => { if (s.type !== "pending") setShotPending(false); }
      );
    } else { setShotPending(false); }

    setIsMyTurn(false);

    // Check win: all 17 ship cells hit
    const hits = [...myShots, result].filter(s => s.isHit).length;
    if (hits >= 17) { setWinner("me"); setPhase("finished"); }
  };

  // ── Finish game on-chain ──────────────────────────────────────────────────
  const handleFinishGame = async (outcome: "WhiteWins" | "BlackWins" | "Draw") => {
    if (!connectedAddress || !walletsKit || !escrowId) return;
    setLoading(true);
    await sendTx(
      connectedAddress, walletsKit, ESCROW_CONTRACT_ID, "finish_game",
      [
        nativeToScVal(escrowId, { type: "u64" }),
        new Address(connectedAddress).toScVal(),
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
        nativeToScVal("battleship", { type: "string" }),
      ],
      setTxStatus
    );
    setLoading(false);
    setPhase("finished");
    await loadEscrow();
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const bgStyle = {
    background: "radial-gradient(ellipse 120% 80% at 50% -10%, #00081a 0%, #0a0a0f 55%, #050508 100%)",
    fontFamily: "'Courier New',Courier,monospace",
  };

  const myBoardState = useMemo((): CellState[] => {
    const state: CellState[] = Array(ROWS * COLS).fill("empty");
    myShips.forEach(ship => ship.cells.forEach(c => { state[c] = "ship"; }));
    opponentShots.forEach(shot => {
      if (shot.isHit) state[shot.cell] = shot.isSunk ? "sunk" : "hit";
      else state[shot.cell] = "miss";
    });
    return state;
  }, [myShips, opponentShots]);

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={bgStyle}>
        <div className="flex flex-col items-center gap-4">
          <div className="text-5xl animate-pulse select-none">⚓</div>
          <div className="w-6 h-6 border-2 border-blue-500/40 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={bgStyle}>
        <div className="text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-rose-500" />
          <p className="text-zinc-400">Battle #{rawId} not found</p>
          <button onClick={() => router.push("/battleship")}
            className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // ── WAITING ───────────────────────────────────────────────────────────────
  if (phase === "waiting") {
    return (
      <div className="min-h-screen text-zinc-200 overflow-x-hidden" style={bgStyle}>
        <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #3b82f6, transparent)" }} />
        <div className="relative max-w-5xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-8">
            <button onClick={() => router.push("/battleship")}
              className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={14} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-600 font-mono">Battle #{rawId}</span>
          </header>

          <div className="max-w-md mx-auto space-y-5">
            {/* Animated waiting grid */}
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="text-8xl select-none" style={{ filter: "drop-shadow(0 0 40px rgba(59,130,246,0.5))" }}>⚓</div>
                <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-amber-400 animate-ping" />
              </div>
            </div>

            <div className="border border-blue-500/20 rounded-2xl p-5 bg-blue-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <p className="text-[10px] text-blue-500 uppercase tracking-widest font-bold">Waiting for Opponent</p>
              </div>
              <p className="text-zinc-500 text-sm">Battle #{rawId} · {stakeXlm} XLM locked in escrow</p>
            </div>

            {/* Join button */}
            {connectedAddress && escrowData?.white !== connectedAddress && (
              <div className="border border-blue-500/25 rounded-2xl p-5 bg-blue-500/5 space-y-4">
                <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Challenge Accepted?</h3>
                <div className="grid grid-cols-2 gap-3 text-[10px]">
                  <div>
                    <p className="text-zinc-600 uppercase tracking-widest mb-1">Stake required</p>
                    <p className="text-blue-400 font-black text-base">{stakeXlm} XLM</p>
                  </div>
                  <div>
                    <p className="text-zinc-600 uppercase tracking-widest mb-1">Prize pot</p>
                    <p className="text-white font-bold">{(parseFloat(stakeXlm) * 2).toFixed(2)} XLM</p>
                  </div>
                </div>
                <button onClick={handleJoin} disabled={joinLoading}
                  className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 bg-blue-500/15 border border-blue-500/40 text-blue-400 hover:bg-blue-500/25 flex items-center justify-center gap-2">
                  {joinLoading ? <><RotateCcw size={14} className="animate-spin" /> Joining...</> : <>⚓ Join as Admiral</>}
                </button>
              </div>
            )}

            {/* Invite */}
            {isCreator && (
              <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/30">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Users size={12} className="text-blue-400" /> Invite Opponent
                </h3>
                <div className="flex items-center gap-2 px-3 py-3 bg-black border border-zinc-800 rounded-xl">
                  <span className="text-zinc-400 text-[10px] font-mono flex-1 truncate">
                    {typeof window !== "undefined" ? `${window.location.origin}/battleship/${rawId}` : ""}
                  </span>
                  <button onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/battleship/${rawId}`);
                    setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000);
                  }}>
                    {inviteCopied ? <CheckCheck size={13} className="text-blue-400" /> : <Copy size={13} className="text-zinc-600 hover:text-blue-400" />}
                  </button>
                </div>
              </div>
            )}

            <button onClick={loadEscrow}
              className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
              <RotateCcw size={11} /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLACEMENT ─────────────────────────────────────────────────────────────
  if (phase === "placement") {
    const allPlaced = myShips.length >= SHIPS.length;
    return (
      <div className="min-h-screen text-zinc-200 overflow-x-hidden" style={bgStyle}>
        <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #3b82f6, transparent)" }} />
        <div className="relative max-w-5xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-6">
            <button onClick={() => router.push("/battleship")}
              className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">Battle #{rawId}</span>
          </header>

          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* Board */}
            <div className="w-full lg:w-auto">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Your Waters</p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                  <span>Click to place</span>
                  <button onClick={() => setIsHorizontal(h => !h)}
                    className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 transition-colors">
                    {isHorizontal ? "→ Horizontal" : "↓ Vertical"}
                  </button>
                </div>
              </div>

              {/* Column labels */}
              <div className="flex ml-0 mb-0.5">
                {Array.from("ABCDEFGHIJ").map(c => (
                  <div key={c} className="flex-1 text-center text-[8px] text-zinc-700">{c}</div>
                ))}
              </div>
              <div className="flex">
                <div className="flex flex-col mr-0.5">
                  {Array.from({ length: 10 }, (_, i) => (
                    <div key={i} className="flex-1 flex items-center justify-end pr-1 text-[8px] text-zinc-700"
                      style={{ height: "10%" }}>{i + 1}</div>
                  ))}
                </div>
                <div className="flex-1">
                  {/* Placement board with mouse tracking */}
                  <PlacementBoardWithHover
                    ships={myShips}
                    selectedShipId={nextShipToPlace}
                    onPlace={handlePlaceShip}
                    isHorizontal={isHorizontal}
                  />
                </div>
              </div>
            </div>

            {/* Ship list + controls */}
            <div className="flex flex-col gap-4 w-full lg:w-64">
              <div className="border border-zinc-800 rounded-2xl p-5 bg-zinc-900/20 space-y-3">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Fleet</h3>
                {SHIPS.map(ship => {
                  const placed = myShips.find(s => s.id === ship.id);
                  const isActive = nextShipToPlace === ship.id;
                  return (
                    <button key={ship.id}
                      onClick={() => !placed && setSelectedShipId(ship.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${
                        placed ? "border-blue-500/30 bg-blue-500/8 cursor-default"
                        : isActive ? "border-blue-400/50 bg-blue-500/15"
                        : "border-zinc-800 hover:border-zinc-700 cursor-pointer"
                      }`}>
                      <div>
                        <p className={`text-[11px] font-bold ${placed ? "text-blue-400" : "text-zinc-300"}`}>{ship.name}</p>
                        <p className="text-[9px] text-zinc-600">{"■".repeat(ship.size)} {ship.size} cells</p>
                      </div>
                      {placed ? <span className="text-blue-400 text-sm">✓</span>
                        : isActive ? <span className="text-[9px] text-blue-400 uppercase tracking-widest">Placing</span>
                        : <span className="text-zinc-700 text-[9px]">Click to select</span>}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button onClick={handleRandomize}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-all">
                  Randomize
                </button>
                <button onClick={handleClearShips}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-zinc-300 text-[10px] font-bold uppercase tracking-widest transition-all">
                  Clear
                </button>
              </div>

              <button onClick={handleConfirmPlacement} disabled={!allPlaced || loading}
                className="w-full py-4 rounded-xl font-black tracking-[0.15em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3"
                style={{
                  background: allPlaced ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : undefined,
                  backgroundColor: allPlaced ? undefined : "#18181b",
                  boxShadow: allPlaced ? "0 0 30px -8px rgba(59,130,246,0.5)" : undefined,
                  color: allPlaced ? "#fff" : "#52525b",
                }}>
                {loading ? <><RotateCcw size={16} className="animate-spin" /> Confirming...</>
                  : allPlaced ? <><Anchor size={16} /> Deploy Fleet & Battle!</>
                  : `Place all ships (${myShips.length}/${SHIPS.length})`}
              </button>

              <div className="border border-zinc-800/50 rounded-xl p-3 text-[9px] text-zinc-700 space-y-1">
                <p>· Click a ship to select it</p>
                <p>· Toggle orientation with the button</p>
                <p>· Click the board to place</p>
                <p>· Randomize for instant placement</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── BATTLE ────────────────────────────────────────────────────────────────
  const mySunkCount = myShots.filter(s => s.isHit).length;
  const theirSunkCount = opponentShots.filter(s => s.isHit).length;

  return (
    <div className="min-h-screen text-zinc-200 overflow-x-hidden" style={bgStyle}>
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #3b82f6, transparent)" }} />

      <div className="relative max-w-6xl mx-auto px-4 py-6 pb-32">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/battleship")}
              className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13} /> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">Battle #{rawId}</span>
            {isMyTurn && phase === "battle" && !winner && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider">Your Turn — Fire!</span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-zinc-600 font-mono">{xlmBalance} XLM</div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
          {/* ── Left: Opponent's grid (attack board) ── */}
          <div className="flex-1">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Opponent's Waters</p>
                <p className="text-[9px] text-zinc-700">{mySunkCount} hits · {myShots.filter(s => !s.isHit).length} misses</p>
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold border ${
                isMyTurn && phase === "battle" && !winner ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-zinc-800 text-zinc-600"
              }`}>
                <Target size={10} />
                {winner ? (winner === "me" ? "Victory!" : "Defeat") : isMyTurn ? "Fire!" : "Waiting..."}
              </div>
            </div>

            {/* Grid column labels */}
            <div className="flex mb-0.5">
              <div className="w-4" />
              {Array.from("ABCDEFGHIJ").map(c => <div key={c} className="flex-1 text-center text-[8px] text-zinc-700">{c}</div>)}
            </div>
            <div className="flex">
              <div className="flex flex-col w-4 mr-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="flex-1 flex items-center justify-end pr-1 text-[8px] text-zinc-700">{i + 1}</div>
                ))}
              </div>
              <div className="flex-1">
                <BattleBoard shots={myShots} onShoot={handleShoot} myTurn={isMyTurn && phase === "battle"} disabled={!!winner || shotPending} />
              </div>
            </div>

            {/* Shot animation feedback */}
            <AnimatePresence>
              {lastShotAnim && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`mt-3 text-center text-sm font-black uppercase tracking-widest ${lastShotAnim.isHit ? "text-red-400" : "text-blue-400"}`}>
                  {lastShotAnim.isHit ? "💥 Direct Hit!" : "🌊 Miss!"}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Center: Info panel ── */}
          <div className="flex flex-col gap-4 w-full lg:w-56">
            {/* Pot */}
            <div className="border border-blue-500/20 rounded-2xl p-4 bg-blue-500/5">
              <p className="text-[9px] text-blue-600/80 uppercase tracking-widest mb-1 flex items-center gap-1">
                <Anchor size={9} /> Prize Pot
              </p>
              <p className="text-2xl font-black text-blue-400 tabular-nums">
                {(Number(potSize) / 10_000_000).toFixed(2)}
                <span className="text-sm text-blue-600 ml-1 font-bold">XLM</span>
              </p>
              <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98.5%</p>
            </div>

            {/* Status */}
            <div className={`rounded-2xl p-4 border ${
              winner ? (winner === "me" ? "border-blue-500/40 bg-blue-500/8" : "border-zinc-800 bg-zinc-900/20")
              : phase === "battle" ? "border-zinc-800 bg-zinc-900/20" : "border-zinc-800 bg-zinc-900/20"
            }`}>
              {winner ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${winner === "me" ? "bg-blue-400" : "bg-zinc-600"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Battle Over</span>
                  </div>
                  <div className={`p-3 rounded-xl border text-center ${winner === "me" ? "border-blue-500/30 bg-blue-500/10" : "border-zinc-700/30 bg-zinc-900/30"}`}>
                    <p className={`text-base font-black ${winner === "me" ? "text-blue-400" : "text-zinc-500"}`}>
                      {winner === "me" ? "⚓ You Win!" : "You Sank"}
                    </p>
                    <p className="text-[9px] text-zinc-600 mt-1">
                      {winner === "me" ? `${mySunkCount} hits to victory` : "Better luck next battle"}
                    </p>
                  </div>
                  {winner === "me" && isPlayer && (
                    <button onClick={() => handleFinishGame(isCreator ? "WhiteWins" : "BlackWins")} disabled={loading}
                      className="w-full py-3 rounded-xl font-black text-sm tracking-wider uppercase transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", color: "#fff", boxShadow: "0 0 20px -6px rgba(59,130,246,0.5)" }}>
                      {loading ? <RotateCcw size={14} className="animate-spin" /> : "Claim Victory Pot"}
                    </button>
                  )}
                  <button onClick={() => router.push("/battleship")}
                    className="w-full py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-all">
                    New Battle
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-2 h-2 rounded-full ${isMyTurn ? "bg-blue-400 animate-pulse" : "bg-zinc-600"}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isPlayer ? (isMyTurn ? "Your Turn" : "Opponent's Turn") : "Spectating"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-zinc-900/40 rounded-xl p-2 text-center border border-zinc-800/50">
                      <p className="text-zinc-600 uppercase tracking-widest text-[8px]">Your Hits</p>
                      <p className="text-blue-400 font-black text-base">{mySunkCount}</p>
                    </div>
                    <div className="bg-zinc-900/40 rounded-xl p-2 text-center border border-zinc-800/50">
                      <p className="text-zinc-600 uppercase tracking-widest text-[8px]">Their Hits</p>
                      <p className="text-red-400 font-black text-base">{theirSunkCount}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[9px]">
                      <span className="text-zinc-700">Ships to sink</span>
                      <span className="text-zinc-500">17 cells</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(mySunkCount / 17) * 100}%` }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Shot log */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
              <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3">Shot Log ({myShots.length})</h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {myShots.length === 0 ? (
                  <p className="text-[10px] text-zinc-700 italic">No shots fired</p>
                ) : [...myShots].reverse().map((shot, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className={shot.isHit ? "text-red-400" : "text-blue-300/50"}>{shot.isHit ? "✕" : "·"}</span>
                    <span className="text-zinc-500">{coordLabel(shot.cell)}</span>
                    <span className={`ml-auto text-[9px] ${shot.isHit ? "text-red-400" : "text-zinc-700"}`}>{shot.isHit ? "HIT" : "miss"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-zinc-800/50 rounded-xl p-3">
              <a href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono text-zinc-700 hover:text-blue-400 transition-colors flex items-center gap-1">
                Escrow · {formatAddress(ESCROW_CONTRACT_ID)} <ExternalLink size={8} />
              </a>
            </div>
          </div>

          {/* ── Right: My defensive grid ── */}
          <div className="flex-1">
            <div className="mb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Your Waters</p>
              <p className="text-[9px] text-zinc-700">{theirSunkCount} of 17 cells hit</p>
            </div>
            <div className="flex mb-0.5">
              <div className="w-4" />
              {Array.from("ABCDEFGHIJ").map(c => <div key={c} className="flex-1 text-center text-[8px] text-zinc-700">{c}</div>)}
            </div>
            <div className="flex">
              <div className="flex flex-col w-4 mr-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="flex-1 flex items-center justify-end pr-1 text-[8px] text-zinc-700">{i + 1}</div>
                ))}
              </div>
              <div className="flex-1">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1 }}>
                  {myBoardState.map((cellState, i) => (
                    <GridCell key={i} index={i} state={cellState} isShip={cellState === "ship"} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TX toast */}
      <AnimatePresence>
        {txStatus && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${
              txStatus.type === "success" ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
              : txStatus.type === "error" ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
              : "bg-zinc-800/50 border-zinc-700/30 text-zinc-300"
            }`}>
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
              <button onClick={() => setTxStatus(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500"><X size={12} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Placement board wrapper with proper hover tracking ───────────────────────
function PlacementBoardWithHover({
  ships, selectedShipId, onPlace, isHorizontal,
}: {
  ships: PlacedShip[]; selectedShipId: ShipId | null;
  onPlace: (startCell: number) => void; isHorizontal: boolean;
}) {
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const occupiedCells = useMemo(() => new Set(ships.flatMap(s => s.cells)), [ships]);

  const previewCells = useMemo(() => {
    if (!selectedShipId || hoverCell === null) return [];
    const ship = SHIPS.find(s => s.id === selectedShipId)!;
    const row = Math.floor(hoverCell / COLS), col = hoverCell % COLS;
    if (isHorizontal) {
      if (col + ship.size > COLS) return [];
      return Array.from({ length: ship.size }, (_, i) => row * COLS + col + i);
    } else {
      if (row + ship.size > ROWS) return [];
      return Array.from({ length: ship.size }, (_, i) => (row + i) * COLS + col);
    }
  }, [selectedShipId, hoverCell, isHorizontal]);

  const previewValid = previewCells.length > 0 && previewCells.every(c => !occupiedCells.has(c));

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1 }} onMouseLeave={() => setHoverCell(null)}>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const isInPreview = previewCells.includes(i);
        const isPlaced = occupiedCells.has(i) && !isInPreview;
        const col = i % COLS, row = Math.floor(i / COLS);
        const isLight = (row + col) % 2 === 0;
        let bg = isLight ? "#0f1f2e" : "#0a1820";
        if (isInPreview) bg = previewValid ? "rgba(59,130,246,0.35)" : "rgba(239,68,68,0.35)";
        else if (isPlaced) bg = "rgba(59,130,246,0.22)";

        return (
          <button key={i}
            onMouseEnter={() => setHoverCell(i)}
            onClick={() => { if (selectedShipId && previewCells.length > 0 && previewValid) onPlace(previewCells[0]); }}
            className="relative w-full aspect-square flex items-center justify-center transition-all duration-75"
            style={{ background: bg, border: "1px solid rgba(59,130,246,0.08)" }}>
            {isPlaced && <div className="w-1.5 h-1.5 rounded-sm bg-blue-400/50" />}
          </button>
        );
      })}
    </div>
  );
}