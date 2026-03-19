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
  Coins, RotateCcw, AlertCircle, ExternalLink,
  X, Users, Flag, Handshake, Copy, CheckCheck,
  ArrowLeft, Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

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
function parseStatus(r: any): string {
  if (typeof r === "number") return STATUS_MAP[r] ?? String(r);
  if (typeof r === "object" && r !== null) return Object.keys(r)[0];
  return String(r);
}
function stroopsToXlm(s: bigint | number) { return (Number(s) / 10_000_000).toFixed(2); }
function formatAddress(a: string) { return `${a.slice(0,6)}...${a.slice(-4)}`; }
function formatTime(s: number) { return `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`; }

// ─── Chess Types ──────────────────────────────────────────────────────────────
type PieceType = "K"|"Q"|"R"|"B"|"N"|"P";
type Color     = "w"|"b";
type Piece     = { type: PieceType; color: Color } | null;
type Board     = Piece[][];
type Square    = { row: number; col: number };

const PIECE_UNICODE: Record<PieceType, {w:string;b:string}> = {
  K:{w:"♔",b:"♚"}, Q:{w:"♕",b:"♛"}, R:{w:"♖",b:"♜"},
  B:{w:"♗",b:"♝"}, N:{w:"♘",b:"♞"}, P:{w:"♙",b:"♟"},
};

function createInitialBoard(): Board {
  const b: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  (["R","N","B","Q","K","B","N","R"] as PieceType[]).forEach((t,c)=>{ b[0][c]={type:t,color:"b"}; b[7][c]={type:t,color:"w"}; });
  for (let c=0;c<8;c++) { b[1][c]={type:"P",color:"b"}; b[6][c]={type:"P",color:"w"}; }
  return b;
}

function fenToBoard(fen: string): Board {
  const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const pm: Record<string,PieceType> = {p:"P",n:"N",b:"B",r:"R",q:"Q",k:"K"};
  fen.split(" ")[0].split("/").forEach((row,r) => {
    let c=0;
    for (const ch of row) {
      if (/\d/.test(ch)) c+=parseInt(ch);
      else { board[r][c]={type:pm[ch.toLowerCase()] as PieceType, color:ch===ch.toUpperCase()?"w":"b"}; c++; }
    }
  });
  return board;
}

function boardToFen(board: Board, turn: Color, moveCount: number): string {
  const rows = board.map(row => {
    let s="", e=0;
    for (const p of row) {
      if (!p) e++;
      else { if(e){s+=e;e=0;} s+=p.color==="w"?p.type:p.type.toLowerCase(); }
    }
    return e ? s+e : s;
  });
  return `${rows.join("/")} ${turn} - - 0 ${Math.floor(moveCount/2)+1}`;
}

function getValidMoves(board: Board, sq: Square, turn: Color): Square[] {
  const piece = board[sq.row][sq.col];
  if (!piece || piece.color !== turn) return [];
  const moves: Square[] = [];
  const inB=(r:number,c:number)=>r>=0&&r<8&&c>=0&&c<8;
  const canL=(r:number,c:number)=>inB(r,c)&&board[r][c]?.color!==piece.color;
  const isEn=(r:number,c:number)=>inB(r,c)&&board[r][c]!==null&&board[r][c]?.color!==piece.color;
  const slide=(drs:number[],dcs:number[])=>{
    for(let i=0;i<drs.length;i++){let r=sq.row+drs[i],c=sq.col+dcs[i];while(inB(r,c)){if(!board[r][c])moves.push({row:r,col:c});else{if(board[r][c]?.color!==piece.color)moves.push({row:r,col:c});break;}r+=drs[i];c+=dcs[i];}}
  };
  switch(piece.type){
    case"P":{const d=piece.color==="w"?-1:1,sr=piece.color==="w"?6:1;if(inB(sq.row+d,sq.col)&&!board[sq.row+d][sq.col])moves.push({row:sq.row+d,col:sq.col});if(sq.row===sr&&!board[sq.row+d][sq.col]&&!board[sq.row+2*d][sq.col])moves.push({row:sq.row+2*d,col:sq.col});[-1,1].forEach(dc=>{if(isEn(sq.row+d,sq.col+dc))moves.push({row:sq.row+d,col:sq.col+dc});});break;}
    case"N":[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc])=>{if(canL(sq.row+dr!,sq.col+dc!))moves.push({row:sq.row+dr!,col:sq.col+dc!});});break;
    case"B":slide([-1,-1,-1,1],[-1,1,1,-1]);break;
    case"R":slide([-1,1,0,0],[0,0,-1,1]);break;
    case"Q":slide([-1,1,0,0,-1,-1,1,1],[0,0,-1,1,-1,1,-1,1]);break;
    case"K":[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc])=>{if(canL(sq.row+dr!,sq.col+dc!))moves.push({row:sq.row+dr!,col:sq.col+dc!});});break;
  }
  return moves;
}

function toSAN(piece: Piece, from: Square, to: Square, cap: Piece): string {
  if (!piece) return "";
  const f="abcdefgh", toSq=`${f[to.col]}${8-to.row}`;
  if (piece.type==="P") return cap?`${f[from.col]}x${toSq}`:toSq;
  return `${piece.type}${cap?"x":""}${toSq}`;
}

// ─── RPC ─────────────────────────────────────────────────────────────────────
async function simRead(contractId: string, method: string, args: xdr.ScVal[] = [], src?: string): Promise<any> {
  const acct = await server.getAccount(src || FALLBACK_ACCOUNT);
  const tx = new TransactionBuilder(acct, {fee:"1000",networkPassphrase})
    .addOperation(new Contract(contractId).call(method,...args)).setTimeout(30).build();
  const r = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationSuccess(r)) return scValToNative(r.result!.retval);
  throw new Error("Simulation failed");
}

async function sendTx(addr: string, kit: any, contractId: string, method: string, args: xdr.ScVal[],
  onStatus: (s:{type:"success"|"error"|"pending";msg:string;hash?:string})=>void): Promise<xdr.ScVal|null> {
  onStatus({type:"pending",msg:`${method}...`});
  try {
    const account = await server.getAccount(addr);
    const tx = new TransactionBuilder(account,{fee:"10000",networkPassphrase})
      .addOperation(new Contract(contractId).call(method,...args)).setTimeout(30).build();
    const prepared = await server.prepareTransaction(tx);
    const {signedTxXdr} = await kit.signTransaction(prepared.toXDR());
    const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr,networkPassphrase));
    if (response.status==="ERROR") throw new Error("Rejected");
    let r = await server.getTransaction(response.hash);
    while (r.status==="NOT_FOUND") { await new Promise(x=>setTimeout(x,1000)); r=await server.getTransaction(response.hash); }
    if (r.status==="SUCCESS") { onStatus({type:"success",msg:"Confirmed",hash:response.hash}); return (r as any).returnValue??null; }
    throw new Error("Failed");
  } catch(err:any) { onStatus({type:"error",msg:err.message||`${method} failed`}); return null; }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GamePage() {
  const {address: connectedAddress, walletsKit} = useWallet();
  const params  = useParams();
  const router  = useRouter();
  const rawId    = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const escrowId = useMemo(() => rawId ? BigInt(rawId) : null, [rawId]);

  // Game state loaded from chain
  const [escrowStatus, setEscrowStatus] = useState<string>("loading");
  const [escrowData, setEscrowData]     = useState<any>(null);
  const [playerColor, setPlayerColor]   = useState<Color>("w");
  const [gameContractId, setGameContractId] = useState<bigint|null>(null);

  // Board
  const [board, setBoard]             = useState<Board>(createInitialBoard());
  const [currentTurn, setCurrentTurn] = useState<Color>("w");
  const [selected, setSelected]       = useState<Square|null>(null);
  const [validMoves, setValidMoves]   = useState<Square[]>([]);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [capturedW, setCapturedW]     = useState<Piece[]>([]);
  const [capturedB, setCapturedB]     = useState<Piece[]>([]);
  const [lastMove, setLastMove]       = useState<{from:Square;to:Square}|null>(null);
  const [winner, setWinner]           = useState<"w"|"b"|"draw"|null>(null);

  // UI
  const [loading, setLoading]         = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [drawOffered, setDrawOffered] = useState(false);
  const [txStatus, setTxStatus]       = useState<{type:"success"|"error"|"pending";msg:string;hash?:string}|null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [xlmBalance, setXlmBalance]   = useState("0");
  const [mounted, setMounted]         = useState(false);
  const [potSize, setPotSize]         = useState<bigint>(0n);

  // Timers
  const [wTime, setWTime] = useState(600);
  const [bTime, setBTime] = useState(600);
  const timerRef = useRef<NodeJS.Timeout|null>(null);

  // Refs for stale-closure-free polling
  const escrowStatusRef  = useRef(escrowStatus);
  const connectedRef     = useRef(connectedAddress);
  const escrowIdRef      = useRef(escrowId);
  useEffect(()=>{ escrowIdRef.current = escrowId; },[escrowId]);
  useEffect(()=>{ escrowStatusRef.current=escrowStatus; },[escrowStatus]);
  useEffect(()=>{ connectedRef.current=connectedAddress; },[connectedAddress]);

  useEffect(()=>{
    console.log("[GamePage] mounting, params:", params, "rawId:", rawId, "escrowId:", escrowId?.toString());
    setMounted(true);
  },[]);

  // Load balance
  const loadBalance = useCallback(async()=>{
    if (!connectedAddress) return;
    try {
      const res=await fetch(`https://horizon-testnet.stellar.org/accounts/${connectedAddress}`);
      const d=await res.json();
      const n=d.balances?.find((b:any)=>b.asset_type==="native");
      setXlmBalance(n?parseFloat(n.balance).toFixed(2):"0");
    } catch {}
  },[connectedAddress]);

  useEffect(()=>{ if(mounted) loadBalance(); },[loadBalance,mounted]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(()=>{
    if (!mounted || !escrowId) return;
    loadGameState();
  },[mounted, escrowId]);

  const loadGameState = async () => {
    if (!escrowId) return;
    setEscrowStatus("loading");
    try {
      // 1. Fetch escrow
      const ed = await simRead(ESCROW_CONTRACT_ID,"get_game",[nativeToScVal(escrowId,{type:"u64"})],connectedAddress||undefined);
      setEscrowData(ed);
      const status = parseStatus(ed.status);
      setEscrowStatus(status);
      setPotSize(status==="Active"?BigInt(ed.stake)*2n:BigInt(ed.stake));

      // 2. Determine player color
      if (connectedAddress) {
        if (ed.white===connectedAddress) setPlayerColor("w");
        else if (ed.black && ed.black!==ed.white && ed.black===connectedAddress) setPlayerColor("b");
      }

      // 3. Fetch game contract state
      try {
        const gd = await simRead(GAME_CONTRACT_ID,"get_game",[nativeToScVal(escrowId,{type:"u64"})],connectedAddress||undefined);
        setGameContractId(escrowId); // game contract uses same ID as escrow_id
        const moves: string[] = (gd.moves as any[]).map((m:any)=>typeof m.san==="string"?m.san:String(Object.values(m.san||{})[0]||"")).filter(Boolean);
        setMoveHistory(moves);
        const fenStr = typeof gd.current_fen==="string"?gd.current_fen:String(Object.values(gd.current_fen||{})[0]||"");
        if (fenStr && fenStr!=="" && fenStr!=="loading") {
          setBoard(fenToBoard(fenStr));
          setCurrentTurn(moves.length%2===0?"w":"b");
        }
        // Detect outcome
        const phase = typeof gd.phase==="object"?Object.keys(gd.phase)[0]:String(gd.phase);
        if (phase==="Completed"||phase==="Settled") {
          const outcome = typeof gd.outcome==="object"?Object.keys(gd.outcome)[0]:String(gd.outcome);
          if (outcome==="WhiteWins") setWinner("w");
          else if (outcome==="BlackWins") setWinner("b");
          else if (outcome==="Draw") setWinner("draw");
          setEscrowStatus("Finished");
        }
      } catch {
        // Game contract record doesn't exist yet — show starting position
      }
    } catch(e) {
      console.error("[loadGameState] failed:", e);
      setEscrowStatus("error");
    }
  };

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if (escrowStatus!=="Active") return;
    timerRef.current=setInterval(()=>{
      if(currentTurn==="w") setWTime(t=>Math.max(0,t-1));
      else setBTime(t=>Math.max(0,t-1));
    },1000);
    return ()=>{ if(timerRef.current) clearInterval(timerRef.current); };
  },[escrowStatus,currentTurn]);

  // ── Poll – both waiting and active ───────────────────────────────────────
  useEffect(()=>{
    if (!mounted || !escrowId) return;
    const poll = setInterval(async()=>{
      const status = escrowStatusRef.current;
      if (status==="error"||status==="loading"||status==="Finished"||status==="Drawn"||status==="Cancelled") return;
      try {
        // Poll escrow for status changes
        const pollId = escrowIdRef.current;
        if (!pollId) return;
        const ed = await simRead(ESCROW_CONTRACT_ID,"get_game",[nativeToScVal(pollId,{type:"u64"})],connectedRef.current||undefined);
        const newStatus = parseStatus(ed.status);
        if (newStatus!==escrowStatusRef.current) {
          setEscrowStatus(newStatus);
          setEscrowData(ed);
          if (newStatus==="Active") setPotSize(BigInt(ed.stake)*2n);
        }

        // Poll game contract for moves when active
        if (newStatus==="Active"||status==="Active") {
          try {
            const gd = await simRead(GAME_CONTRACT_ID,"get_game",[nativeToScVal(pollId,{type:"u64"})],connectedRef.current||undefined);
            const moves: string[] = (gd.moves as any[]).map((m:any)=>typeof m.san==="string"?m.san:String(Object.values(m.san||{})[0]||"")).filter(Boolean);
            setMoveHistory(prev=>{
              if (moves.length>prev.length) {
                const fenStr = typeof gd.current_fen==="string"?gd.current_fen:String(Object.values(gd.current_fen||{})[0]||"");
                if (fenStr&&fenStr!=="") { setBoard(fenToBoard(fenStr)); setCurrentTurn(moves.length%2===0?"w":"b"); }
                return moves;
              }
              return prev;
            });
          } catch {}
        }
      } catch {}
    }, 3000);
    return ()=>clearInterval(poll);
  },[mounted,escrowId]);

  // ── Toast dismiss ─────────────────────────────────────────────────────────
  useEffect(()=>{
    if (txStatus&&txStatus.type!=="pending") { const t=setTimeout(()=>setTxStatus(null),8000); return ()=>clearTimeout(t); }
  },[txStatus]);

  // ── Chess logic ───────────────────────────────────────────────────────────
  const handleSquareClick = (row: number, col: number) => {
    if (escrowStatus!=="Active") return;
    if (currentTurn!==playerColor) return;
    if (selected) {
      const isValid=validMoves.some(m=>m.row===row&&m.col===col);
      if (isValid) {
        const nb=board.map(r=>[...r]);
        const cap=nb[row][col];
        let mp=nb[selected.row][selected.col]!;
        if(cap){if(cap.color==="b")setCapturedW(p=>[...p,cap]);else setCapturedB(p=>[...p,cap]);}
        if(mp.type==="P"&&(row===0||row===7)) mp={...mp,type:"Q"};
        const san=toSAN(mp,selected,{row,col},cap);
        nb[row][col]=mp; nb[selected.row][selected.col]=null;
        const newMoves=[...moveHistory,san];
        const newTurn: Color=currentTurn==="w"?"b":"w";
        const fen=boardToFen(nb,newTurn,newMoves.length);
        setMoveHistory(newMoves); setLastMove({from:selected,to:{row,col}});
        setBoard(nb); setCurrentTurn(newTurn); setSelected(null); setValidMoves([]);

        // Commit move onchain
        if (connectedAddress&&walletsKit) {
          const gcId=gameContractId??escrowId;
          setMovePending(true);
          sendTx(connectedAddress,walletsKit,GAME_CONTRACT_ID,"commit_move",[
            nativeToScVal(gcId,{type:"u64"}),
            new Address(connectedAddress).toScVal(),
            nativeToScVal(san,{type:"string"}),
            nativeToScVal(fen,{type:"string"}),
          ],(s)=>{ if(s.type!=="pending") setMovePending(false); }).catch(()=>setMovePending(false));
        }
        if(cap?.type==="K") handleGameOver(currentTurn==="w"?"WhiteWins":"BlackWins",newMoves);
        return;
      }
    }
    const piece=board[row][col];
    if(piece&&piece.color===currentTurn){setSelected({row,col});setValidMoves(getValidMoves(board,{row,col},currentTurn));}
    else{setSelected(null);setValidMoves([]);}
  };

  // ── Onchain actions ───────────────────────────────────────────────────────
  const escrowTx = async(method:string,args:xdr.ScVal[])=>{
    if(!connectedAddress||!walletsKit||!escrowId) return null;
    setLoading(true);
    const r=await sendTx(connectedAddress,walletsKit,ESCROW_CONTRACT_ID,method,args,setTxStatus);
    setLoading(false); loadBalance(); return r;
  };

  const handleGameOver = async(outcome:"WhiteWins"|"BlackWins"|"Draw",moves:string[])=>{
    setWinner(outcome==="WhiteWins"?"w":outcome==="BlackWins"?"b":"draw");
    setEscrowStatus("Finished");
    if(!connectedAddress||!escrowId) return;
    await escrowTx("finish_game",[
      nativeToScVal(escrowId,{type:"u64"}),
      new Address(connectedAddress).toScVal(),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
      nativeToScVal(moves.join(" "),{type:"string"}),
    ]);
    if(gameContractId&&walletsKit) {
      sendTx(connectedAddress,walletsKit,GAME_CONTRACT_ID,"complete_game",[
        nativeToScVal(gameContractId,{type:"u64"}),
        new Address(connectedAddress).toScVal(),
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcome)]),
        nativeToScVal(moves.join(" "),{type:"string"}),
      ],()=>{}).catch(()=>{});
    }
  };

  const handleResign=()=>handleGameOver(currentTurn==="w"?"BlackWins":"WhiteWins",moveHistory);
  const handleOfferDraw=async()=>{ setDrawOffered(true); await escrowTx("offer_draw",[nativeToScVal(escrowId,{type:"u64"}),new Address(connectedAddress!).toScVal()]); };
  const handleAcceptDraw=async()=>{ await escrowTx("accept_draw",[nativeToScVal(escrowId,{type:"u64"}),new Address(connectedAddress!).toScVal()]); handleGameOver("Draw",moveHistory); };

  if (!mounted || !escrowId) return null;

  const isMyTurn    = currentTurn===playerColor;
  const isPlayer    = connectedAddress && escrowData && (escrowData.white===connectedAddress||(escrowData.black&&escrowData.black!==escrowData.white&&escrowData.black===connectedAddress));
  const flipped     = playerColor==="b";
  const opColor: Color = playerColor==="w"?"b":"w";
  const stakeXlm    = escrowData ? (Number(escrowData.stake)/10_000_000).toFixed(2) : "0";

  // ── Board renderer ────────────────────────────────────────────────────────
  const renderBoard = (interactive: boolean) => (
    <div className="relative" style={{borderRadius:"12px",overflow:"hidden",boxShadow:"0 0 60px -15px rgba(0,0,0,0.9),0 0 30px -8px rgba(217,119,6,0.12)"}}>
      <div className="absolute left-0 top-0 bottom-0 w-5 flex flex-col pointer-events-none z-10">
        {Array.from({length:8},(_,i)=><div key={i} className="flex-1 flex items-center justify-center"><span className="text-[9px] text-zinc-600">{flipped?i+1:8-i}</span></div>)}
      </div>
      <div className="ml-5 mb-4">
        {(flipped?[...board].reverse():board).map((row,rIdx)=>{
          const displayR=flipped?7-rIdx:rIdx;
          return (
            <div key={displayR} className="flex">
              {(flipped?[...row].reverse():row).map((piece,cIdx)=>{
                const displayC=flipped?7-cIdx:cIdx;
                const isLight=(displayR+displayC)%2===0;
                const isSel=selected?.row===displayR&&selected?.col===displayC;
                const isVal=validMoves.some(m=>m.row===displayR&&m.col===displayC);
                const isFrom=lastMove?.from.row===displayR&&lastMove?.from.col===displayC;
                const isTo=lastMove?.to.row===displayR&&lastMove?.to.col===displayC;
                let bg=isLight?"#c8a97e":"#8b6340";
                if(isSel) bg="#f0c040";
                else if(isFrom||isTo) bg=isLight?"#d4c060":"#a09040";
                return (
                  <button key={displayC} onClick={()=>interactive&&handleSquareClick(displayR,displayC)}
                    className="relative w-14 h-14 flex items-center justify-center group" style={{background:bg}}>
                    {isVal&&(piece?<div className="absolute inset-0.5 rounded-sm border-[3px] border-black/30 pointer-events-none"/>:<div className="absolute w-4 h-4 rounded-full bg-black/25 pointer-events-none"/>)}
                    {piece&&<span className="text-3xl select-none transition-transform group-hover:scale-110"
                      style={{color:piece.color==="w"?"#fff":"#1a1a1a",textShadow:piece.color==="w"?"0 1px 3px rgba(0,0,0,0.7)":"0 1px 2px rgba(255,255,255,0.2)",lineHeight:1}}>
                      {PIECE_UNICODE[piece.type][piece.color]}
                    </span>}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="flex">
          {(flipped?"hgfedcba":"abcdefgh").split("").map(f=><div key={f} className="w-14 h-4 flex items-center justify-center"><span className="text-[9px] text-zinc-600">{f}</span></div>)}
        </div>
      </div>
    </div>
  );

  // ── WAITING VIEW ─────────────────────────────────────────────────────────
  if (escrowStatus==="Waiting"||escrowStatus==="loading") {
    const isCreator = connectedAddress && escrowData?.white===connectedAddress;
    return (
      <div className="min-h-screen text-zinc-200 overflow-x-hidden"
        style={{background:"radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)",fontFamily:"'Courier New',Courier,monospace"}}>
        <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{background:"radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)"}}/>

        <div className="relative max-w-6xl mx-auto px-4 py-8 pb-32">
          <header className="flex items-center gap-4 mb-8">
            <button onClick={()=>router.push("/play")} className="flex items-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={14}/> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-600 font-mono">Game #{params.id}</span>
            {escrowStatus==="loading"&&<RotateCcw size={12} className="animate-spin text-zinc-600"/>}
          </header>

          {escrowStatus==="loading" ? (
            <div className="flex items-center justify-center py-32"><RotateCcw size={24} className="animate-spin text-zinc-600"/></div>
          ) : (
            <div className="flex flex-col xl:flex-row gap-6 items-start">
              {/* Board */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl opacity-30">♛</div>
                    <div><p className="text-xs font-bold text-zinc-600">Black</p><p className="text-[9px] text-zinc-700">Waiting to join...</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500/30 animate-pulse"/>
                    <span className="text-[9px] text-zinc-700 font-mono">10:00</span>
                  </div>
                </div>
                {renderBoard(false)}
                <div className="w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">♕</div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">{isCreator?"You — White":"White"}</p>
                      <p className="text-[9px] text-zinc-600">{escrowData?.white?formatAddress(escrowData.white):""}</p>
                    </div>
                  </div>
                  <span className="text-[9px] text-amber-500 uppercase tracking-widest font-mono">10:00</span>
                </div>
              </div>

              {/* Panel */}
              <div className="flex flex-col gap-4 w-full xl:w-72 shrink-0">
                <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
                    <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">Waiting for Opponent</p>
                  </div>
                  <p className="text-zinc-500 text-sm">Game #{params.id} · {stakeXlm} XLM locked</p>
                </div>

                {isCreator && (
                  <div className="border border-zinc-800 rounded-2xl p-5 space-y-4 bg-zinc-900/30">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2"><Users size={12} className="text-amber-400"/> Invite</h3>
                    <div className="space-y-2">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Share link</p>
                      <div className="flex items-center gap-2 px-3 py-3 bg-black border border-zinc-800 rounded-xl">
                        <span className="text-zinc-400 text-[10px] font-mono flex-1 truncate">
                          {typeof window!=="undefined"?`${window.location.origin}/play/${params.id}`:""}
                        </span>
                        <button onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/play/${params.id}`);setInviteCopied(true);setTimeout(()=>setInviteCopied(false),2000);}}>
                          {inviteCopied?<CheckCheck size={13} className="text-emerald-400"/>:<Copy size={13} className="text-zinc-600 hover:text-amber-400"/>}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div className="bg-black border border-zinc-800 rounded-xl px-3 py-2.5">
                        <p className="text-zinc-600 uppercase tracking-widest mb-1">Game ID</p>
                        <p className="text-amber-400 font-black">#{params.id}</p>
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
                  <div className="flex justify-between"><span className="text-zinc-600 uppercase tracking-widest">Pot if joined</span><span className="text-white font-bold">{(parseFloat(stakeXlm)*2).toFixed(2)} XLM</span></div>
                  <div className="flex justify-between"><span className="text-zinc-600 uppercase tracking-widest">Winner gets</span><span className="text-emerald-400 font-bold">{(parseFloat(stakeXlm)*2*0.985).toFixed(2)} XLM</span></div>
                  <div className="flex items-center gap-2 pt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/>
                    <span className="text-zinc-600">Auto-refreshing every 3s</span>
                  </div>
                </div>

                <button onClick={loadGameState} className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                  <RotateCcw size={11}/> Check Status Now
                </button>

                {isCreator && (
                  <button onClick={()=>router.push("/play")} className="w-full py-3 rounded-xl border border-zinc-800 text-zinc-600 hover:text-rose-400 hover:border-rose-500/30 transition-all text-[9px] font-bold uppercase tracking-widest">
                    Cancel & Return to Lobby
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (escrowStatus==="error") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background:"#050508",fontFamily:"'Courier New',Courier,monospace"}}>
        <div className="text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-rose-500"/>
          <p className="text-zinc-400">Game #{params.id} not found or failed to load</p>
          <p className="text-zinc-600 text-xs">Check browser console for details</p>
          <div className="flex gap-3 justify-center">
            <button onClick={loadGameState} className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors flex items-center gap-2">
              <RotateCcw size={14}/> Retry
            </button>
            <button onClick={()=>router.push("/play")} className="px-6 py-3 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors">
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PLAYING / FINISHED VIEW ───────────────────────────────────────────────
  return (
    <div className="min-h-screen text-zinc-200 overflow-x-hidden"
      style={{background:"radial-gradient(ellipse 120% 80% at 50% -10%, #1a0a00 0%, #0a0a0f 55%, #050508 100%)",fontFamily:"'Courier New',Courier,monospace"}}>
      <div className="fixed inset-x-0 top-0 h-72 opacity-20 pointer-events-none" style={{background:"radial-gradient(ellipse 60% 100% at 50% 0%, #d97706, transparent)"}}/>

      <div className="relative max-w-6xl mx-auto px-4 py-6 pb-32">

        {/* Header bar */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={()=>router.push("/play")} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors text-[10px] uppercase tracking-widest">
              <ArrowLeft size={13}/> Lobby
            </button>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] text-zinc-500 font-mono">Game #{params.id}</span>
            {movePending&&<div className="flex items-center gap-1.5 px-2 py-1 border border-amber-500/20 rounded-lg bg-amber-500/5"><RotateCcw size={10} className="animate-spin text-amber-500"/><span className="text-[9px] text-amber-500">Saving move...</span></div>}
          </div>
          <div className="flex items-center gap-3">
            {connectedAddress&&<div className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 rounded-xl bg-zinc-900/40"><div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/><span className="text-[10px] text-zinc-400">{formatAddress(connectedAddress)}</span><span className="text-[10px] text-zinc-600">·</span><span className="text-[10px] text-amber-400 font-bold">{xlmBalance} XLM</span></div>}
            {!isPlayer&&<div className="px-3 py-1.5 border border-zinc-700 rounded-xl text-[9px] text-zinc-500 uppercase tracking-widest">Spectating</div>}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">

          {/* Board column */}
          <div className="flex flex-col items-center gap-3 w-full lg:w-auto">

            {/* Opponent panel */}
            {(()=>{
              const opActive=currentTurn===opColor&&escrowStatus==="Active";
              const opTime=opColor==="w"?wTime:bTime;
              const opCap=opColor==="w"?capturedW:capturedB;
              const opAddr=opColor==="w"?escrowData?.white:escrowData?.black;
              return (
                <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${opActive?"border-amber-500/40 bg-amber-500/5 shadow-[0_0_20px_-5px_rgba(217,119,6,0.15)]":"border-zinc-800/40 bg-zinc-900/20"}`}>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">{opColor==="w"?"♕":"♛"}</div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">{isPlayer?"Opponent":"Player"}</p>
                      <p className="text-[9px] text-zinc-600">{opColor==="w"?"White":"Black"}{opAddr?" · "+formatAddress(opAddr):""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">{opCap.slice(-8).map((p,i)=><span key={i} className="text-xs text-zinc-500">{p?PIECE_UNICODE[p.type][p.color]:""}</span>)}</div>
                    <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${opActive?"bg-amber-500 text-black border-amber-400":"bg-zinc-900 text-zinc-500 border-zinc-800"}`}>{formatTime(opTime)}</div>
                  </div>
                </div>
              );
            })()}

            {renderBoard(!!isPlayer&&escrowStatus==="Active")}

            {/* Your panel */}
            {(()=>{
              const myActive=currentTurn===playerColor&&escrowStatus==="Active";
              const myTime=playerColor==="w"?wTime:bTime;
              const myCap=playerColor==="w"?capturedW:capturedB;
              return (
                <div className={`w-full max-w-[480px] flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${myActive?"border-amber-500/40 bg-amber-500/5 shadow-[0_0_20px_-5px_rgba(217,119,6,0.15)]":"border-zinc-800/40 bg-zinc-900/20"}`}>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">{playerColor==="w"?"♕":"♛"}</div>
                    <div>
                      <p className="text-xs font-bold text-zinc-300">{isPlayer?"You":"Spectating"}</p>
                      <p className="text-[9px] text-zinc-600">{playerColor==="w"?"White":"Black"}{connectedAddress?" · "+formatAddress(connectedAddress):""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">{myCap.slice(-8).map((p,i)=><span key={i} className="text-xs text-zinc-300">{p?PIECE_UNICODE[p.type][p.color]:""}</span>)}</div>
                    <div className={`px-3 py-1.5 rounded-lg font-black text-sm tabular-nums border ${myActive?"bg-amber-500 text-black border-amber-400":"bg-zinc-900 text-zinc-500 border-zinc-800"}`}>{formatTime(myTime)}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4 w-full lg:w-64">

            {/* Pot */}
            <div className="border border-amber-500/20 rounded-2xl p-5 bg-amber-500/5">
              <p className="text-[9px] text-amber-600/80 uppercase tracking-widest mb-2 flex items-center gap-1"><Coins size={10}/> Prize Pot</p>
              <p className="text-3xl font-black text-amber-400 tabular-nums">{stroopsToXlm(potSize)}<span className="text-sm text-amber-600 ml-2 font-bold">XLM</span></p>
              <p className="text-[9px] text-zinc-600 mt-1">Winner takes 98.5% · 1.5% fee</p>
            </div>

            {/* Status */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20">
              {escrowStatus==="Active" ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${isMyTurn&&isPlayer?"bg-amber-400 animate-pulse":"bg-zinc-600"}`}/>
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {isPlayer?(isMyTurn?"Your move":"Opponent's move"):"Spectating"}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600">Move <span className="text-white font-bold">{moveHistory.length+1}</span> · <span className={currentTurn==="w"?"text-zinc-200":"text-zinc-500"}>{currentTurn==="w"?"White":"Black"} to play</span></p>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-zinc-600"/>
                  <span className="text-[10px] uppercase tracking-widest text-zinc-500">{escrowStatus}</span>
                </div>
              )}
              <div className="mt-2 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700 animate-pulse"/>
                <span className="text-[9px] text-zinc-700">Polling every 3s</span>
              </div>
            </div>

            {/* Move history */}
            <div className="border border-zinc-800 rounded-2xl p-4 bg-zinc-900/20 flex-1">
              <h3 className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center justify-between">
                <span>Moves ({moveHistory.length})</span>
                {moveHistory.length>0&&<span className="text-zinc-700">onchain ✓</span>}
              </h3>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {moveHistory.length===0 ? (
                  <p className="text-[10px] text-zinc-700 italic">No moves yet</p>
                ) : moveHistory.reduce<string[][]>((p,m,i)=>{if(i%2===0)p.push([m]);else p[p.length-1].push(m);return p;},[])
                  .map((pair,i)=>(
                    <div key={i} className="flex gap-2 text-[10px] font-mono">
                      <span className="text-zinc-700 w-5 shrink-0">{i+1}.</span>
                      <span className="text-zinc-300 w-14">{pair[0]}</span>
                      {pair[1]&&<span className="text-zinc-500">{pair[1]}</span>}
                    </div>
                  ))}
              </div>
            </div>

            {/* Actions */}
            {isPlayer&&escrowStatus==="Active"&&(
              <div className="grid grid-cols-2 gap-2">
                <button onClick={drawOffered?handleAcceptDraw:handleOfferDraw} disabled={loading}
                  className={`flex items-center justify-center gap-1.5 py-3 rounded-xl border transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40 ${drawOffered?"border-emerald-500/40 text-emerald-400 bg-emerald-500/5":"border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"}`}>
                  <Handshake size={12}/> {drawOffered?"Accept":"Draw"}
                </button>
                <button onClick={handleResign} disabled={loading}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-rose-500/20 text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 transition-all text-[10px] font-bold tracking-wider uppercase disabled:opacity-40">
                  <Flag size={12}/> Resign
                </button>
              </div>
            )}

            {/* Contract links */}
            <div className="border border-zinc-800/50 rounded-xl p-3 space-y-1">
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

      {/* Result overlay */}
      <AnimatePresence>
        {winner&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <motion.div initial={{scale:0.85,y:20}} animate={{scale:1,y:0}}
              className="border border-amber-500/30 rounded-3xl p-10 text-center space-y-5 max-w-sm mx-4"
              style={{background:"linear-gradient(135deg,#0f0800,#0a0a0f)",boxShadow:"0 0 80px -20px rgba(217,119,6,0.4)"}}>
              <div className="text-6xl" style={{filter:"drop-shadow(0 0 30px rgba(217,119,6,0.6))"}}>{winner==="w"?"♔":winner==="b"?"♚":"🤝"}</div>
              <div>
                <p className="text-[10px] text-amber-600 uppercase tracking-[0.3em] mb-2">Game Over</p>
                <h2 className="text-3xl font-black text-white">
                  {winner==="draw"?"Draw!":winner===playerColor?<><span className="text-amber-400">Victory</span> is yours</>:isPlayer?"You lost":"Game ended"}
                </h2>
                <p className="text-zinc-500 text-sm mt-2">
                  {winner==="draw"?"Stakes returned"
                   :winner===playerColor?`${stroopsToXlm(potSize*985n/1000n)} XLM sent to your wallet`
                   :"Better luck next time"}
                </p>
                {txStatus?.hash&&<a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-amber-600/70 hover:text-amber-400 mt-2 transition-colors">View tx <ExternalLink size={8}/></a>}
              </div>
              <div className="flex gap-3">
                <button onClick={()=>router.push("/play")}
                  className="flex-1 py-4 rounded-2xl font-black tracking-wider uppercase text-sm active:scale-95"
                  style={{background:"linear-gradient(135deg,#d97706,#b45309)",color:"#000"}}>
                  New Game
                </button>
                <button onClick={()=>setWinner(null)} className="px-5 py-4 rounded-2xl border border-zinc-800 text-zinc-500 hover:text-zinc-300">
                  <X size={16}/>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {txStatus&&(
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.95}}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-sm mx-4 p-4 rounded-2xl flex items-center justify-between gap-4 border z-50 backdrop-blur ${txStatus.type==="success"?"bg-amber-500/10 border-amber-500/20 text-amber-400":txStatus.type==="error"?"bg-rose-500/10 border-rose-500/20 text-rose-400":"bg-zinc-800/50 border-zinc-700/30 text-zinc-300"}`}>
            <div className="flex items-center gap-3 text-sm">{txStatus.type==="pending"?<RotateCcw size={14} className="animate-spin"/>:<Zap size={14}/>}<span className="text-xs">{txStatus.msg}</span></div>
            <div className="flex items-center gap-2 shrink-0">
              {txStatus.hash&&<a href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-white/10 rounded-lg"><ExternalLink size={12}/></a>}
              <button onClick={()=>setTxStatus(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-500"><X size={12}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}