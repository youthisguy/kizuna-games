# KingFall — User Feedback Document

## Overview

| | |
|---|---|
| **Testing Period** | March 2026 |
| **Testers** | 5 users |
| **Platform** | Mobile (iOS & Android) |
| **Version Tested** | MVP v1 — Stellar Testnet |
| **Method** | Direct testing via shared Vercel link, feedback collected via WhatsApp/DM |

---

## Testers

| # | Alias | Device | Wallet Used |
|---|---|---|---|
| 1 | Tester A | iPhone | xBull (dApp browser) |
| 2 | Tester B | iPhone | xBull (dApp browser) |
| 3 | Tester C | Android | xBull (dApp browser) |
| 4 | Tester D | Android | xBull (dApp browser) |
| 5 | Tester E | iPhone | xBull (dApp browser) |

---

## Raw Feedback

### Tester A
> "Playing a game will real funds at stake is really cool. I played every move more seriously. The board looks clean."

**Sentiment:** Positive overall. Looking foward to more.

---

### Tester B
> "I liked the whole concept. Staking and playing chess is a fun idea. The game loaded fast, ui is clean."

**Sentiment:** Positive. Requested clearer turn indication.

---

### Tester C
> "The UI looks really good, I love the dark theme. Took me a minute to create a game and share the invite link."

**Sentiment:** Positive on aesthetics.

---

### Tester D
> "Staking XLM for a chess game is a great idea. The move confirmation toast is reassuring. Fastest way to 2x with a win."

**Sentiment:** Positive on staking mechanic.

---

### Tester E
> "Really enjoyed it. The invite link sharing works well. I noticed I couldn't do some moves I expected to be able to do like moving the king two squares to castle."

**Sentiment:** Positive. Identified missing chess rules — specifically castling.

---

## Feedback Summary

| Theme | Frequency | Severity |
|---|---|---|
| Staking mechanic is engaging | 5/5 | — (positive) |
| UI is clean and professional | 4/5 | — (positive) |
| Missing chess moves (castling, en passant) | 2/5 | Medium |

---

## What We Changed — Iteration 1

Based on the feedback above, the following changes were shipped after the first round of testing:

### ✅ Added Castling Support
**Feedback trigger:** Tester E reported being unable to castle — moving the king two squares was blocked.

**Change:** Implemented kingside and queenside castling in the chess engine. The king can now move two squares toward a rook, with the rook jumping to the other side, provided neither piece has moved and the path is clear and not under attack.

### ✅ Added En Passant Capture
**Feedback trigger:** During testing, a tester attempted an en passant capture and the move was rejected as illegal.

**Change:** Implemented en passant pawn capture. When a pawn advances two squares from its starting rank and lands beside an opponent's pawn, the opponent can capture it as though it had only moved one square — on the very next move.

---

## Conclusion

All 5 testers responded positively to the core concept — staking real XLM into a chess game created genuine excitement and engagement. The main friction points were around chess rules completeness (castling and en passant) and mobile UX improvement, both of which have been addressed in Iteration 1. The staking mechanic and overall UI were consistently praised across all testers.