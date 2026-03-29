# ♚ KingFall — P2P Onchain Chess on Stellar

> Stake XLM. Play Chess. Winner claims all. Every move recorded on Soroban.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?style=flat-square)](https://kingfall-self.vercel.app)
[![Demo Video](https://img.shields.io/badge/Demo%20Video-Watch-red?style=flat-square)](https://youtu.be/hs7aOUaPQqw?si=CwC-NiZL54xVmsc8)

---

## Live Demo

> **[https://kingfall-self.vercel.app](https://kingfall-self.vercel.app)**

## Demo Video

> **[Watch full MVP walkthrough →](https://youtu.be/hs7aOUaPQqw?si=CwC-NiZL54xVmsc8)**

The video covers: creating a game, staking XLM, joining as black, making moves (committed onchain), check detection, checkmate, and winner payout via escrow.

---

## What is KingFall?

KingFall is a P2P chess platform built on Stellar/Soroban. Two players stake equal amounts of XLM into a Soroban escrow contract. Every move is committed to the game contract as an immutable record. The winner's `finish_game` transaction triggers payout — the pot minus a 1.5% protocol fee goes directly to their wallet. Draws split the pot.

---

## Screenshots
 
| Home | Lobby | Game |
|---|---|---|
| ![Home](screenshots/Home.png) | ![Lobby](screenshots/Lobby.png) | ![Game](screenshots/Game.png) |
 
---
 
## Architecture
 
> 📐 **[Full Architecture Document → ARCHITECTURE.md](./Architecture.md)**
> Covers contract state machines, data flow diagrams, Rust structs, chess engine design, and key implementation patterns.
 
```
.
├── contracts/
│   ├── kingfall-escrow/    # Stake management, game lifecycle, payouts
│   ├── kingfall-game/      # Move history, FEN state, game records
│   └── kingfall-payout/    # Fee treasury, leaderboard, season prizes
└── app/                    # Next.js 14 frontend
    └── play/
        ├── page.tsx        # Lobby — create/join/browse games
        └── [id]/
            └── page.tsx    # Game board — live play, move history
```
 
### Contract Flow
 
```
1. White calls escrow.create_game(stake, token)
   → GameData created, XLM locked, status = Waiting
 
2. Black calls escrow.join_game(id)
   → Black's stake locked, status = Active
 
3. Black calls game.create_game(white, black, escrow_id)
   → Game record created, moves array initialized
 
4. Players alternate: game.commit_move(id, player, san, fen_after)
   → MoveRecord appended onchain with SAN notation + FEN
 
5. On checkmate/stalemate/resign:
   → escrow.finish_game(id, caller, outcome, moves)
   → Escrow pays winner (98.5%) or splits pot (draw)
   → game.complete_game() marks record as settled
```
 
### Key Design Patterns
 
**Escrow-first architecture** — XLM never leaves the escrow contract until the game concludes. The contract enforces that only valid participants can trigger payouts.
 
**FEN-based state sync** — each `commit_move` stores both the SAN move and the resulting FEN string. This allows any client to reconstruct the full board position for any move.
 
**Fallback account reads** — all contract reads use a funded fallback account as the simulation source, so board state, open games, and stake amounts load immediately without a connected wallet.
 
**Game contract ID decoupling** — the game contract assigns its own auto-increment IDs. The frontend scans `get_all_games()` to match `escrow_id` to the correct game contract record, handling the case where they differ.
 
---
 
## Contract Addresses (Testnet)
 
| Contract | Address |
|---|---|
| Escrow | `CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN` |
| Game | `CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54` |
| Payout | `CB233DDZB35CHH5ERR7FWPVRFDKKKFZQI54E3I7VAVFOEBIEPBRJX3I6` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
 
---
 
## Contract Functions
 
### Escrow (`kingfall-escrow`)
 
| Function | Description |
|---|---|
| `create_game(white, token, stake, deadline)` | Lock white's stake, create game record, return game ID |
| `join_game(id, black)` | Lock black's matching stake, flip status to Active |
| `finish_game(id, caller, outcome, moves)` | Pay out winner or split on draw, set status Finished/Drawn |
| `offer_draw(id, caller)` | Record draw offer |
| `accept_draw(id, caller)` | Accept draw, trigger split payout |
| `cancel_game(id, caller)` | Cancel waiting game, return stake |
| `get_game(id)` | Fetch full GameData struct |
| `get_active_games()` | Vec of waiting game IDs |
| `get_player_games(player)` | Vec of game IDs for a player |
 
### Game (`kingfall-game`)
 
| Function | Description |
|---|---|
| `create_game(white, black, escrow_id, timeout)` | Initialize game record, store starting FEN |
| `commit_move(id, player, san, fen_after)` | Append MoveRecord with SAN + FEN |
| `complete_game(id, caller, outcome, pgn)` | Mark game settled, store PGN hash |
| `get_game(id)` | Full game state including moves array |
| `get_all_games()` | Vec of all game IDs |
| `get_current_fen(id)` | Current board FEN string |
 
---
 
## Chess Rules Implemented
 
- Full legal move generation with check filtering (no move that leaves own king in check)
- Check detection and red king highlight
- Checkmate detection → automatic `finish_game`
- Stalemate detection → automatic draw
- Pawn promotion (auto-queens)
- Board flips for black player
- Last move highlighted (origin + destination squares) for both players
 
---
 
## User Wallet Addresses (Testnet)
 
The following wallets have interacted with the KingFall contracts on Stellar Testnet, verifiable on [Stellar Expert](https://stellar.expert/explorer/testnet):
 
| # | Address | Role |
|---|---|---|
| 1 | `GCLMTJHQ4MRYCQVCYTXQGTRYVURPCV2MXLFA7GCDLFRJSD6BGGY57X2U` | Tester |
| 2 | `GDHHHFWLPFROQXLRWAJSB2ENEJRBAMX64CAJAJCVKQVIWC2SVRNZ3DIB` | Tester |
| 3 | `GCJ3BEALSI2QYJNWSZ2OGAEZ77FMYFXHJ6QJWHT6SLXJ5AHCSGQZ5SLV` | Tester |
| 4 | `GADHOONGFGODLILJJYGMAB3BPD24TGYK7SUTWY4DPIW4VGBOBXJG6UBL` | Tester |
| 5 | `GASEAJFVTFWO2UULVQQJT543WB65PVI7MQGTV446R7A36GUTLLJM53LE` | Tester |
 
> View contract interactions: [Escrow on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCSDLJLDIJSAOKFLX2QWCOVLENA4FFN2EMSGJRFKTIBYY4UUA2HKDGBN) · [Game on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBBIQM6V5XEF5PBB7DARQ2Q26WHBHKLPYKD4ELHOQ7YBZ4CMJXC2DO54)
 
---
 
## User Feedback
 
> [View user feedback document + exported Excel sheet →](./USER_FEEDBACK.md)
 
---
 
## Getting Started
 
### Prerequisites
 
- Rust + `wasm32-unknown-unknown` target
- Stellar CLI
- Node.js 18+
- [Freighter wallet](https://freighter.app) browser extension
 
```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```
 
### Build Contracts
 
```bash
cd contracts
cargo clean && cargo build --target wasm32-unknown-unknown --release
```
 
### Deploy to Testnet
 
```bash
stellar keys generate my-account --network testnet
stellar keys fund my-account --network testnet
export ADMIN=$(stellar keys address my-account)
 
# Deploy escrow
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/kingfall_escrow.wasm \
  --source my-account --network testnet
export ESCROW_ID=<printed_id>
 
# Deploy game
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/kingfall_game.wasm \
  --source my-account --network testnet
export GAME_ID=<printed_id>
 
# Deploy payout
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/kingfall_payout.wasm \
  --source my-account --network testnet
export PAYOUT_ID=<printed_id>
 
# Initialize
stellar contract invoke --id $PAYOUT_ID --source my-account --network testnet \
  -- initialize --admin $ADMIN --escrow_contract $ESCROW_ID --nft_contract $ESCROW_ID
 
stellar contract invoke --id $GAME_ID --source my-account --network testnet \
  -- initialize --escrow_contract $ESCROW_ID
 
stellar contract invoke --id $ESCROW_ID --source my-account --network testnet \
  -- set_payout_contract --caller $ADMIN --payout $PAYOUT_ID
```
 
### Run Frontend
 
```bash
cd app
npm install
npm run dev
```
 
Open [http://localhost:3000/play](http://localhost:3000/play)
 
---
 
## Testing the Full Flow
 
```bash
# 1. Create a game — stakes 5 XLM
stellar contract invoke --id $ESCROW_ID --source my-account --network testnet --send yes \
  -- create_game \
  --white $ADMIN \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --stake 50000000 \
  --join_deadline 0
 
# 2. Join as black (second account)
stellar contract invoke --id $ESCROW_ID --source black-account --network testnet --send yes \
  -- join_game --id 1 --black $(stellar keys address black-account)
 
# 3. Create game contract record
stellar contract invoke --id $GAME_ID --source black-account --network testnet --send yes \
  -- create_game \
  --white $ADMIN \
  --black $(stellar keys address black-account) \
  --escrow_id 1 \
  --move_timeout 0
 
# 4. Commit a move
stellar contract invoke --id $GAME_ID --source my-account --network testnet --send yes \
  -- commit_move \
  --id 1 \
  --player $ADMIN \
  --san "e4" \
  --fen_after "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1"
 
# 5. Check game state
stellar contract invoke --id $GAME_ID --source my-account --network testnet \
  -- get_game --id 1
```
 
---
 
## Tech Stack
 
| Layer | Technology |
|---|---|
| Smart Contracts | Rust, Soroban SDK 21 |
| Blockchain | Stellar Testnet / Mainnet |
| Frontend | Next.js 14, TypeScript |
| Styling | Tailwind CSS |
| Wallet | Freighter / StellarWalletsKit |
| Deployment | Vercel |
 
---
 
## Improvements Based on User Feedback
 
Feedback collected via Google Form from 5 real testnet users (average rating 4.4/5). Full responses in [USER_FEEDBACK.md](./USER_FEEDBACK.md) and [user-feedback.xlsx](./user-feedback.xlsx).
 
### Shipped — Iteration 1
- **Castling support** — Afolabi Nelson reported being unable to castle. Implemented kingside and queenside castling per standard chess rules. [View commit →](https://github.com/youthisguy/kingfall/commit/fa3b278608eab3c97964a773b773c4194ce58874)
- **En passant capture** — en passant was rejected during testing. Implemented per standard rules. [View commit →](https://github.com/youthisguy/kingfall/commit/fa3b278608eab3c97964a773b773c4194ce58874)
- **Active games visible without game ID** — Darhmie Lola couldn't find her created games without a game ID. The lobby now auto-loads all open and active games on mount. [View commit →]()

### Planned — Iteration 2
Directly from form responses:

- **In-game chat** — live messaging with opponent during a game (Eno Johnny)
- **Anti-cheat / dispute system** — ability to flag or report suspected cheating (Moses Oladejo)

 
---
 
## Roadmap
 
- [ ] NFT mint on game completion (SEP-50)
- [ ] Season leaderboard and prize pool (payout contract)
- [ ] Mainnet deployment
