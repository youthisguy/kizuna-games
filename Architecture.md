# Kizuna — Architecture Document

## Overview

Kizuna is a decentralized, skill-stakes arcade hub built on Stellar. It facilitates peer-to-peer competition by using Soroban smart contracts to create trustless "financial bonds" between players.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                        │
│                                                                 │
│   /chess               /play/[id] (Game Board)            │
│   ─────────────              ─────────────────────              │
│   • Browse open games        • Render board from FEN            │
│   • Create & stake           • Commit moves onchain             │
│   • Join & stake             • Poll for opponent moves          │
│   • Total staked (live)      • Check/checkmate detection        │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
               │   Soroban RPC (HTTPS)    │
               ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Stellar Testnet                             │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │
│  │  Escrow Contract│  │  Game Contract  │  │ Payout Contract│   │
│  │  CCSDLJ...DGBN  │  │  CBBIQM...DO54  │  │ CB233D...X3I6  │   │
│  └────────┬────────┘  └────────┬────────┘  └───────┬────────┘   │
│           │                   │                    │            │
│           └───────────────────┴────────────────────┘            │
│                     Native XLM (SAC)                            │
│                  CDLZFC3...HHGCYSC                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts

### 1. Escrow Contract (`kizuna-escrow`)

The financial heart of the system. Holds XLM stakes, enforces game lifecycle transitions, and executes payouts.

**Storage:**
```
Game(u64)          → GameData struct
NextId             → u64 auto-increment
PayoutContract     → Address
ActiveGames        → Vec<u64>
PlayerGames(addr)  → Vec<u64>
```

**GameData struct:**
```rust
pub struct GameData {
    pub id:             u64,
    pub white:          Address,
    pub black:          Address,
    pub stake:          i128,       
    pub token:          Address,    // native XLM SAC
    pub status:         GameStatus,
    pub created_at:     u64,
    pub join_deadline:  u64,
    pub move_hash:      String,
    pub draw_offered_by: Option<Address>,
}
```

**State machine:**
```
Waiting(0) ──join_game()──► Active(1) ──finish_game()──► Finished(2)
                                      ──accept_draw()──► Drawn(3)
Waiting(0) ──cancel_game()──► Cancelled(4)
Active(1)  ──timeout──────► Timeout(5)
```

**Payout logic:**
```
Winner payout  = stake × 2 × 0.985   (98.5% of pot)
Protocol fee   = stake × 2 × 0.015   (1.5% to payout contract)
Draw payout    = stake × 0.985 each  (each gets back 98.5% of own stake)
```

---

### 2. Game Contract (`kizuna-game`)

Records the full move history and board state for every game. Decoupled from the escrow so financial and game logic are separated.

**Storage:**
```
Game(u64)   → GameState struct
NextId      → u64 auto-increment
EscrowContract → Address
AllGames    → Vec<u64>
```

**GameState struct:**
```rust
pub struct GameState {
    pub game_id:      u64,
    pub escrow_id:    u64,          
    pub white:        Address,
    pub black:        Address,
    pub phase:        GamePhase,    // Active | Completed | Settled
    pub outcome:      GameOutcome,  // Pending | WhiteWins | BlackWins | Draw
    pub moves:        Vec<MoveRecord>,
    pub current_fen:  String,
    pub move_timeout: u64,
    pub created_at:   u64,
    pub last_move_at: u64,
    pub pgn_hash:     String,
}
```

**MoveRecord struct:**
```rust
pub struct MoveRecord {
    pub player:       Address,
    pub san:          String,   // e.g. "Nf3", "exd5", "O-O"
    pub move_number:  u32,
    pub fen_after:    String,   // full FEN after this move
    pub committed_at: u64,
}
```

**Key design decision — FEN per move:** Every `commit_move` stores the resulting FEN string alongside the SAN. This means any client can reconstruct the board at any point in history without replaying moves, and the frontend can diff consecutive FENs to determine which squares changed (used for last-move highlighting).

**ID decoupling:** The game contract maintains its own auto-increment ID sequence independent of the escrow. The `escrow_id` field on `GameState` is the link. The frontend scans `get_all_games()` and matches by `escrow_id` to find the correct game record.

---

### 3. Payout Contract (`kizuna-payout`)

Receives the 1.5% protocol fee from every settled game. Manages the fee treasury, a season prize pool, and emits an NFT mint event (`kfp/nftmint`) on game completion. Currently the NFT contract is a placeholder pending SEP-50 implementation.

---

## Frontend Architecture

### Route Structure

```
app/
├── layout.tsx              ← Root layout, WalletProvider, Suspense
├── page.tsx                ← Redirect → /play
├── contexts/
│   └── WalletContext.tsx   ← StellarWalletsKit integration
├── play/
│   ├── layout.tsx          ← Suspense boundary for useSearchParams
│   ├── page.tsx            ← Lobby
│   └── [id]/
│       └── page.tsx        ← Game board
```

### Data Flow — Lobby (`/play`)

```
mount
  │
  ├─► simRead(escrow, get_active_games)  → open game IDs
  ├─► simRead(game,   get_all_games)     → all game IDs
  ├─► simRead(native, balance, [escrow]) → total XLM staked
  │
  └─► render sidebar lists + stats (no wallet needed)

wallet connects
  └─► loadBalance() via Horizon API
```

### Data Flow — Game Board (`/play/[id]`)

```
mount + escrowId resolved
  │
  ├─► simRead(escrow, get_game, [id])       → escrow status, stakes, players
  ├─► scan get_all_games → match escrow_id  → game contract record
  ├─► load moves + current_fen              → board state, move history
  └─► setLastMove via diffBoards()          → highlight last move squares

wallet connects
  └─► setPlayerColor (w/b) from escrow.white / escrow.black

setInterval(3s) — poll loop
  ├─► simRead(escrow, get_game)     → detect status transitions
  │     Waiting → Active:  reload playerColor, set pot
  │     Active  → Finished: show result overlay
  │
  └─► simRead(game, get_game, [gcId])  → detect new opponent moves
        if moves.length > prev:
          ├─► fenToBoard(current_fen)  → update board
          ├─► diffBoards(prev, new)    → setLastMove highlight
          └─► isInCheck / getGameResult → check/checkmate
```

### Chess Engine (Client-Side)

All chess logic runs in the browser — no chess engine dependency.

```
getPseudoMoves(board, sq)
  └─► raw moves ignoring check (per piece type)

isInCheck(board, color)
  └─► find king square → check if any opponent pseudo-move attacks it

getLegalMoves(board, sq, turn)
  └─► getPseudoMoves filtered by: applyMove → !isInCheck(result, turn)

getGameResult(board, color)
  └─► if no legal moves: isInCheck? → "checkmate" : "stalemate"

diffBoards(before, after)
  └─► collect disappeared[] + appeared[] + captured[] squares
      → {from: disappeared[0], to: captured[0] ?? appeared[0]}
```

---

## Key Patterns

### Read Without Wallet

All contract reads use a funded fallback account as the simulation source. The RPC simulation requires a valid account with a sequence number, but the result is read-only and the account never signs anything.

```typescript
const FALLBACK_ACCOUNT = "GDXK7EY...RMU6"; // funded testnet account

async function simRead(contractId, method, args, src?) {
  const acct = await server.getAccount(src || FALLBACK_ACCOUNT);
  const tx = new TransactionBuilder(acct, { fee: "1000" })
    .addOperation(new Contract(contractId).call(method, ...args))
    .build();
  const result = await server.simulateTransaction(tx);
  return scValToNative(result.result.retval);
}
```

### Soroban Enum Deserialization

Soroban enum variants deserialize via `scValToNative` as single-element arrays, not plain strings:

```typescript
// Contract returns: GameStatus::Active
// scValToNative gives: ["Active"]  ← array, not "Active"

function parseStatus(r: any): string {
  if (Array.isArray(r)) return String(r[0]);  // ← handle this case first
  if (typeof r === "object") return Object.keys(r)[0];
  return String(r);
}
```

### Stale Closure Prevention in Poll

The 3-second poll `setInterval` would capture stale state values in closures. All values read inside the poll use refs that are kept in sync via `useEffect`:

```typescript
const escrowStatusRef   = useRef(escrowStatus);
const connectedRef      = useRef(connectedAddress);
const escrowIdRef       = useRef(escrowId);
const gameContractIdRef = useRef(gameContractId);

useEffect(() => { escrowStatusRef.current = escrowStatus; }, [escrowStatus]);
// ... etc

setInterval(async () => {
  const status = escrowStatusRef.current;  // always current value
  const gcId   = gameContractIdRef.current ?? escrowIdRef.current;
  // ...
}, 3000);
```

---

## Security Considerations

- **No move validation onchain** — the game contract stores whatever SAN/FEN the client sends. Move legality is enforced client-side only. A malicious client could submit invalid moves. A future version would validate moves onchain using a WASM chess engine in the Soroban contract.
- **Single-player finish** — either player can call `finish_game` with any outcome. The contract does not verify the outcome matches the move history. This is acceptable for the MVP but would require a dispute mechanism in production.
- **Front-running** — since moves are public on-chain before confirmed, an observer could theoretically read an opponent's move before the UI renders it. In practice the 3s poll makes this a non-issue for normal play.

---

## Contract Addresses (Testnet)

| Contract | Address | Explorer |
|---|---|---|
| Escrow | `CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN` | [View](https://stellar.expert/explorer/testnet/contract/CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN) |
| Game | `CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54` | [View](https://stellar.expert/explorer/testnet/contract/CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54) |
| Payout | `CB233DDZB35CHH5ERR7FWPVRFDKKKFZQI54E3I7VAVFOEBIEPBRJX3I6` | [View](https://stellar.expert/explorer/testnet/contract/CB233DDZB35CHH5ERR7FWPVRFDKKKFZQI54E3I7VAVFOEBIEPBRJX3I6) |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | [View](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |