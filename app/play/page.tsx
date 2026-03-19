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
  Crown, Swords, Coins, RotateCcw, AlertCircle,
  ExternalLink, Users, Trophy, ChevronRight,
  List,
} from "lucide-react";
import { motion } from "framer-motion";

// ─── Config ───────────────────────────────────────────────────────────────────
const ESCROW_CONTRACT_ID = "CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN";
const GAME_CONTRACT_ID   = "CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54";
const NATIVE_TOKEN_ID    = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const FALLBACK_ACCOUNT   = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const RPC_URL            = "https://soroban-testnet.stellar.org:443";
const server             = new StellarRpc.Server(RPC_URL);
const networkPassphrase  = Networks.TESTNET;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_MAP: Record<number, string> = { 0:"Waiting", 1:"Active", 2:"Finished", 3:"Drawn", 4:"Cancelled", 5:"Timeout" };
function parseStatus(raw: any): string {
  if (typeof raw === "number") return STATUS_MAP[raw] ?? String(raw);
  if (typeof raw === "object" && raw !== null) return Object.keys(raw)[0];
  return String(raw);
}
function formatAddress(a: string) { return `${a.slice(0,6)}...${a.slice(-4)}`; }
function xlmToStroops(x: string) { return BigInt(Math.floor(parseFloat(x) * 10_000_000)); }

async function simRead(contractId: string, method: string, args: xdr.ScVal[] = [], src?: string): Promise<any> {
  const acct = await server.getAccount(src || FALLBACK_ACCOUNT);
  const tx = new TransactionBuilder(acct, { fee:"1000", networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args)).setTimeout(30).build();
  const result = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationSuccess(result)) return scValToNative(result.result!.retval);
  throw new Error((result as any).error || "Simulation failed");
}

async function sendTx(
  addr: string, kit: any, contractId: string, method: string, args: xdr.ScVal[],
  onStatus: (s:{type:"success"|"error"|"pending";msg:string;hash?:string})=>void
): Promise<xdr.ScVal|null> {
  onStatus({type:"pending", msg:`${method}...`});
  try {
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account, {fee:"10000", networkPassphrase})
      .addOperation(new Contract(contractId).call(method, ...args)).setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const {signedTxXdr} = await kit.signTransaction(prepared.toXDR());
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase));
    if (response.status==="ERROR") throw new Error("Transaction rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status==="NOT_FOUND") { await new Promise(x=>setTimeout(x,1000)); r=await server.getTransaction(response.hash); }
    if (r.status==="SUCCESS") {
      onStatus({type:"success", msg:"Confirmed", hash:response.hash});
      return (r as any).returnValue ?? null;
    }
    throw new Error("Transaction failed on-chain");
  } catch(err:any) {
    onStatus({type:"error", msg:err.message||`${method} failed`});
    return null;
  }
}

interface GameInfo { id:string; status:string; stake:string; white:string; black?:string; created_at:number; }

// ─── Component ────────────────────────────────────────────────────────────────
export default function PlayLobby() {
  const {address: connectedAddress, walletsKit} = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [stakeAmount, setStakeAmount]   = useState("5");
  const [xlmBalance, setXlmBalance]     = useState("0");
  const [loading, setLoading]           = useState(false);
  const [txStatus, setTxStatus]         = useState<{type:"success"|"error"|"pending";msg:string}|null>(null);

  // Join by ID
  const [lookupId, setLookupId]             = useState("");
  const [lookupResult, setLookupResult]     = useState<GameInfo|null>(null);
  const [lookupLoading, setLookupLoading]   = useState(false);
  const [lookupError, setLookupError]       = useState<string|null>(null);

  // Sidebar games
  const [activeGames, setActiveGames]               = useState<GameInfo[]>([]);
  const [activeGamesLoading, setActiveGamesLoading] = useState(false);
  const [showActiveGames, setShowActiveGames]       = useState(false);
  const [allGames, setAllGames]                     = useState<GameInfo[]>([]);
  const [allGamesLoading, setAllGamesLoading]       = useState(false);
  const [showAllGames, setShowAllGames]             = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Handle ?join=X invite links (no useSearchParams — avoids Suspense requirement)
  useEffect(() => {
    if (!mounted) return;
    const joinParam = new URLSearchParams(window.location.search).get("join");
    if (joinParam) router.replace(`/play/${joinParam}`);
  }, [mounted, router]);

  const loadBalance = useCallback(async () => {
    if (!connectedAddress) return;
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const d = await res.json();
      const n = d.balances?.find((b:any) => b.asset_type==="native");
      setXlmBalance(n ? parseFloat(n.balance).toFixed(2) : "0");
    } catch {}
  }, [connectedAddress]);

  useEffect(() => { if (mounted) loadBalance(); }, [loadBalance, mounted]);

  // ── Lookup game ───────────────────────────────────────────────────────────
  const handleLookup = async (id?: string) => {
    const gid = id ?? lookupId;
    if (!gid) return;
    setLookupLoading(true); setLookupError(null); setLookupResult(null);
    try {
      const data = await simRead(ESCROW_CONTRACT_ID, "get_game", [nativeToScVal(BigInt(gid), {type:"u64"})], connectedAddress||undefined);
      const status = parseStatus(data.status);
      const stake  = (Number(data.stake)/10_000_000).toFixed(2);
      setLookupResult({ id:gid, status, stake, white:data.white, black:data.black, created_at:Number(data.created_at) });
    } catch { setLookupError("Game not found or invalid ID"); }
    finally { setLookupLoading(false); }
  };

  // ── Create game ───────────────────────────────────────────────────────────
  const handleCreateGame = async () => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    const result = await sendTx(connectedAddress, walletsKit, ESCROW_CONTRACT_ID, "create_game", [
      new Address(connectedAddress).toScVal(),
      new Address(NATIVE_TOKEN_ID).toScVal(),
      nativeToScVal(xlmToStroops(stakeAmount), {type:"i128"}),
      nativeToScVal(0n, {type:"u64"}),
    ], setTxStatus);
    setLoading(false);
    if (result) {
      const id = scValToNative(result) as bigint;
      router.push(`/play/${id.toString()}`);
    }
  };

  // ── Join game ─────────────────────────────────────────────────────────────
  const handleJoinGame = async (game: GameInfo) => {
    if (!connectedAddress || !walletsKit) return;
    setLoading(true);
    const id = BigInt(game.id);

    // 1. Join escrow
    const joined = await sendTx(connectedAddress, walletsKit, ESCROW_CONTRACT_ID, "join_game", [
      nativeToScVal(id, {type:"u64"}),
      new Address(connectedAddress).toScVal(),
    ], setTxStatus);

    if (!joined && joined !== null) { setLoading(false); return; }

    // 2. Create game contract record (black signs)
    await sendTx(connectedAddress, walletsKit, GAME_CONTRACT_ID, "create_game", [
      new Address(game.white).toScVal(),
      new Address(connectedAddress).toScVal(),
      nativeToScVal(id, {type:"u64"}),
      nativeToScVal(0n, {type:"u64"}),
    ], ()=>{});

    setLoading(false);
    router.push(`/play/${game.id}`);
  };

  // ── Fetch sidebar games ───────────────────────────────────────────────────
  const normalizeIds = (raw: any): bigint[] => {
    if (!Array.isArray(raw)) return [];
    return raw.map((x:any) => {
      if (typeof x === "bigint") return x;
      if (typeof x === "number") return BigInt(x);
      if (typeof x === "object" && x !== null) return BigInt(Object.values(x)[0] as any);
      return BigInt(String(x));
    });
  };

  const fetchActiveGames = useCallback(async () => {
    setActiveGamesLoading(true);
    try {
      const raw = await simRead(ESCROW_CONTRACT_ID, "get_active_games", [], connectedAddress||undefined);
      const ids = normalizeIds(raw);
      const games = await Promise.all(ids.map(async id => {
        try {
          const d = await simRead(ESCROW_CONTRACT_ID, "get_game", [nativeToScVal(id, {type:"u64"})], connectedAddress||undefined);
          return { id:id.toString(), status:parseStatus(d.status), stake:(Number(d.stake)/10_000_000).toFixed(2), white:d.white, black:d.black, created_at:Number(d.created_at) } as GameInfo;
        } catch { return null; }
      }));
      setActiveGames(games.filter(Boolean) as GameInfo[]);
    } catch(e) { console.error("[fetchActiveGames]", e); }
    finally { setActiveGamesLoading(false); }
  }, [connectedAddress]);

  const fetchAllGames = useCallback(async () => {
    setAllGamesLoading(true);
    try {
      const raw = await simRead(GAME_CONTRACT_ID, "get_all_games", [], connectedAddress||undefined);
      const ids = normalizeIds(raw);
      const games = await Promise.all(ids.map(async id => {
        try {
          const d = await simRead(ESCROW_CONTRACT_ID, "get_game", [nativeToScVal(id, {type:"u64"})], connectedAddress||undefined);
          return { id:id.toString(), status:parseStatus(d.status), stake:(Number(d.stake)/10_000_000).toFixed(2), white:d.white, black:d.black, created_at:Number(d.created_at) } as GameInfo;
        } catch { return null; }
      }));
      setAllGames(games.filter(Boolean) as GameInfo[]);
    } catch(e) { console.error("[fetchAllGames]", e); }
    finally { setAllGamesLoading(false); }
  }, [connectedAddress]);

  if (!mounted) return null;

  const StatusBadge = ({status}:{status:string}) => (
    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
      status==="Waiting"  ? "bg-emerald-500/20 text-emerald-400" :
      status==="Active"   ? "bg-amber-500/20 text-amber-400" :
      status==="Finished" ? "bg-blue-500/20 text-blue-400" :
      "bg-zinc-700/50 text-zinc-500"}`}>
      {status==="Waiting"?"Open":status}
    </span>
  );

  const GameRow = ({g}:{g:GameInfo}) => (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-800/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-amber-400 font-black font-mono shrink-0">#{g.id}</span>
        <div className="min-w-0">
          <p className="text-[10px] text-zinc-300 font-mono truncate">{formatAddress(g.white)}</p>
          <p className="text-[9px] text-zinc-600">{g.stake} XLM each</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        <StatusBadge status={g.status}/>
        {g.status==="Waiting" && g.white!==connectedAddress && (
          <button onClick={()=>handleJoinGame(g)} disabled={loading}
            className="text-[9px] px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-bold uppercase tracking-wider disabled:opacity-40">
            Join
          </button>
        )}
        <button onClick={()=>router.push(`/play/${g.id}`)}
          className="text-[9px] px-2 py-0.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white transition-colors font-bold">
          Open
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{background:"radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)", fontFamily:"'Courier New',Courier,monospace"}}>
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{background:"radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)"}}/>
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none" style={{backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`, backgroundSize:"200px"}}/>

      <div className="relative max-w-6xl mx-auto px-4 py-8 pb-32">

        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          {connectedAddress ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-900/40 backdrop-blur">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
              <span className="text-[10px] text-zinc-400">{formatAddress(connectedAddress)}</span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] text-amber-400 font-bold">{xlmBalance} XLM</span>
            </div>
          ) : <div/>}
          {txStatus && (
            <div className={`text-[10px] px-3 py-1.5 rounded-xl border ${txStatus.type==="pending"?"border-zinc-700 text-zinc-400":txStatus.type==="success"?"border-emerald-500/30 text-emerald-400":"border-rose-500/30 text-rose-400"}`}>
              {txStatus.type==="pending"&&<RotateCcw size={10} className="inline animate-spin mr-1"/>}{txStatus.msg}
            </div>
          )}
        </header>

        <div className="flex gap-6">

          {/* ── Main ── */}
          <div className="flex-1 min-w-0">
            <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="max-w-lg mx-auto space-y-5">

              {/* Hero */}
              <div className="text-center py-6 space-y-3">
                <div className="text-7xl mb-4" style={{filter:"drop-shadow(0 0 30px rgba(217,119,6,0.4))"}}>♚</div>
                <h2 className="text-3xl font-bold text-white tracking-wider">Play. Stake. <span className="text-amber-400">Conquer.</span></h2>
                <p className="text-zinc-500 text-sm leading-relaxed max-w-sm mx-auto">P2P chess with real XLM on the line. Stakes locked in Soroban escrow. Winner claims all.</p>
              </div>

              {connectedAddress ? (<>

                {/* Create Game */}
                <div className="border border-zinc-800 rounded-2xl p-6 space-y-5 bg-zinc-900/30 backdrop-blur">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Coins size={12} className="text-amber-400"/> Create Game
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    {["1","5","10","25"].map(v => (
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
                  <button onClick={handleCreateGame} disabled={loading||!stakeAmount||parseFloat(stakeAmount)<=0}
                    className="w-full py-4 rounded-xl font-black tracking-[0.15em] uppercase text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-3"
                    style={{background:"linear-gradient(135deg,#d97706,#b45309)",boxShadow:"0 0 30px -8px rgba(217,119,6,0.5)",color:"#000"}}>
                    {loading?<><RotateCcw size={16} className="animate-spin"/> Processing...</>:<><Swords size={16}/> Create & Stake {stakeAmount} XLM</>}
                  </button>
                </div>

                {/* Join by ID */}
                <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/20">
                  <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <Users size={12} className="text-amber-400"/> Join Game by ID
                  </h3>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Enter Game ID" value={lookupId}
                      onChange={e=>{setLookupId(e.target.value);setLookupResult(null);setLookupError(null);}}
                      onKeyDown={e=>e.key==="Enter"&&handleLookup()}
                      className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-zinc-600 transition-colors placeholder:text-zinc-700"/>
                    <button onClick={()=>handleLookup()} disabled={lookupLoading||!lookupId}
                      className="px-5 py-3 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white active:scale-95">
                      {lookupLoading?<RotateCcw size={14} className="animate-spin"/>:"Search"}
                    </button>
                  </div>
                  {lookupError&&<p className="text-[10px] text-rose-400 flex items-center gap-1"><AlertCircle size={10}/> {lookupError}</p>}
                  {lookupResult&&(
                    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
                      className={`rounded-xl border overflow-hidden ${lookupResult.status==="Waiting"?"border-emerald-500/25":lookupResult.status==="Active"?"border-amber-500/25":"border-zinc-700/40"}`}>
                      <div className={`px-4 py-2.5 flex items-center justify-between ${lookupResult.status==="Waiting"?"bg-emerald-500/[0.06]":lookupResult.status==="Active"?"bg-amber-500/[0.06]":"bg-zinc-900/60"}`}>
                        <span className="text-[10px] text-zinc-400 font-mono">Game #{lookupResult.id}</span>
                        <StatusBadge status={lookupResult.status}/>
                      </div>
                      <div className="px-4 py-3 grid grid-cols-2 gap-4 text-[10px] border-t border-zinc-800/50">
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Creator</p><p className="text-zinc-300 font-mono">{formatAddress(lookupResult.white)}</p></div>
                        <div><p className="text-zinc-600 uppercase tracking-widest mb-1">Stake each</p><p className="text-amber-400 font-black text-base">{lookupResult.stake} XLM</p></div>
                      </div>
                      <div className="px-4 pb-4 flex gap-2">
                        <button onClick={()=>router.push(`/play/${lookupResult!.id}`)}
                          className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase transition-all bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center gap-2">
                          View Game
                        </button>
                        {lookupResult.status==="Waiting" && lookupResult.white!==connectedAddress && (
                          <button onClick={()=>handleJoinGame(lookupResult!)} disabled={loading}
                            className="flex-1 py-2.5 rounded-xl font-black text-xs tracking-wider uppercase transition-all disabled:opacity-40 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 flex items-center justify-center gap-2">
                            {loading?<RotateCcw size={12} className="animate-spin"/>:<>Stake & Join {lookupResult.stake} XLM</>}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>

              </>) : (
                <div className="border border-dashed border-zinc-800 rounded-2xl p-14 text-center space-y-4">
                  <Crown size={40} className="mx-auto text-zinc-700"/>
                  <p className="text-zinc-500">Connect your wallet to create or join a game</p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {label:"Open Games", value:activeGames.length||"—", icon:Swords},
                  {label:"Total Staked", value:"— XLM", icon:Coins},
                  {label:"Games Played", value:allGames.length||"—", icon:Trophy},
                ].map(({label,value,icon:Icon})=>(
                  <div key={label} className="border border-zinc-800/50 rounded-xl p-3 text-center bg-zinc-900/20">
                    <Icon size={14} className="mx-auto mb-1 text-amber-500/60"/>
                    <p className="text-sm font-bold text-white">{String(value)}</p>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* ── Sidebar ── */}
          <div className="hidden xl:flex flex-col gap-3 w-72 shrink-0">
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/20 sticky top-8">

              {/* Open Games */}
              <button onClick={()=>{setShowActiveGames(s=>!s); if(!showActiveGames) fetchActiveGames();}}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Swords size={11} className="text-amber-400"/> Open Games
                </span>
                <div className="flex items-center gap-2">
                  {activeGames.length>0&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black">{activeGames.length}</span>}
                  <ChevronRight size={13} className={`text-zinc-600 transition-transform ${showActiveGames?"rotate-90":""}`}/>
                </div>
              </button>
              {showActiveGames&&(
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1">
                  {activeGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center"><RotateCcw size={12} className="animate-spin text-zinc-600"/><span className="text-[10px] text-zinc-600">Loading...</span></div>
                  ) : activeGames.length===0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">No open games</p>
                  ) : activeGames.map(g=><GameRow key={g.id} g={g}/>)}
                  <button onClick={fetchActiveGames} className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1">
                    <RotateCcw size={9}/> Refresh
                  </button>
                </div>
              )}

              <div className="border-t border-zinc-800/50"/>

              {/* All Games */}
              <button onClick={()=>{setShowAllGames(s=>!s); if(!showAllGames) fetchAllGames();}}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <List size={11} className="text-amber-400"/> All Games
                </span>
                <div className="flex items-center gap-2">
                  {allGames.length>0&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 font-black">{allGames.length}</span>}
                  <ChevronRight size={13} className={`text-zinc-600 transition-transform ${showAllGames?"rotate-90":""}`}/>
                </div>
              </button>
              {showAllGames&&(
                <div className="border-t border-zinc-800/50 px-4 pb-3 pt-1 max-h-96 overflow-y-auto">
                  {allGamesLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center"><RotateCcw size={12} className="animate-spin text-zinc-600"/><span className="text-[10px] text-zinc-600">Loading...</span></div>
                  ) : allGames.length===0 ? (
                    <p className="text-[10px] text-zinc-600 text-center py-4">No games yet</p>
                  ) : allGames.map(g=><GameRow key={g.id} g={g}/>)}
                  <button onClick={fetchAllGames} className="w-full mt-2 py-1.5 text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-1">
                    <RotateCcw size={9}/> Refresh
                  </button>
                </div>
              )}

              {/* Contract links */}
              <div className="border-t border-zinc-800/50 px-4 py-3 space-y-1.5">
                <a href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`} target="_blank" rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1">
                  Escrow · {formatAddress(ESCROW_CONTRACT_ID)} <ExternalLink size={8}/>
                </a>
                <a href={`https://stellar.expert/explorer/testnet/contract/${GAME_CONTRACT_ID}`} target="_blank" rel="noopener noreferrer"
                  className="text-[9px] font-mono text-zinc-700 hover:text-amber-400 transition-colors flex items-center gap-1">
                  Game · {formatAddress(GAME_CONTRACT_ID)} <ExternalLink size={8}/>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}