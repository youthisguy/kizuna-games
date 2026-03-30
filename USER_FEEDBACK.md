# KingFall — User Feedback Document

## Data Collection Method

User feedback was collected via a structured Google Form shared with all testers alongside the Vercel link.

**Google Form:** [KingFall MVP Feedback Form →](https://docs.google.com/forms/d/1LNcoKAhoo5aT2hC0wLs3Qs5Cf32ZVGxVWkFpxehRAPk)

**Exported responses:** [user-feedback.xlsx](./user-feedback.xlsx)

---

## Overview

| | |
|---|---|
| **Testing Period** | March 2026 |
| **Testers** | 5 users |
| **Platform** | Mobile (iOS & Android) |
| **Version Tested** | MVP v1 — Stellar Testnet |
| **Collection Method** | Google Form → exported to Excel |
| **Average Rating** | 4.4 / 5 |

---

## Tester Responses

| # | Full Name | Email | Stellar Wallet Address | Rating |
|---|---|---|---|---|
| 1 | Shiemana Umoh | shemmaumoh@gmail.com | `GCLMTJHQ4MRYCQVCYTXQGTRYVURPCV2MXLFA7GCDLFRJSD6BGGY57X2U` | 4/5 |
| 2 | Eno Johnny | enoiniobong081@gmail.com | `GDHHHFWLPFROQXLRWAJSB2ENEJRBAMX64CAJAJCVKQVIWC2SVRNZ3DIB` | 5/5 |
| 3 | Moses Oladejo | sageofsurpassion@gmail.com | `GCJ3BEALSI2QYJNWSZ2OGAEZ77FMYFXHJ6QJWHT6SLXJ5AHCSGQZ5SLV` | 5/5 |
| 4 | Afolabi Nelson | afolabinelson1998@gmail.com | `GADHOONGFGODLILJJYGMAB3BPD24TGYK7SUTWY4DPIW4VGBOBXJG6UBL` | 4/5 |
| 5 | Darhmie Lola | missdarhmie@gmail.com | `GASEAJFVTFWO2UULVQQJT543WB65PVI7MQGTV446R7A36GUTLLJM53LE` | 4/5 |

> Full exported responses: [user-feedback.xlsx](./user-feedback.xlsx)

---

## Rating Distribution

| Rating | Count |
|---|---|
| ⭐⭐⭐⭐⭐ (5) | 3 users |
| ⭐⭐⭐⭐ (4) | 1 users |
| ⭐⭐⭐ (3) | 0 users |
| ⭐⭐ (2) | 1 users |
| ⭐ (1) | 0 users |
**Average: 4.5 / 5**

---

## Raw Feedback

### Shiemana Umoh — ⭐⭐⭐⭐⭐
**What they liked:**
> "Playing a game with real funds at stake is really cool. I played every move more seriously. I like the board and game UI."

**What was missing:**
> "It was overall a good experience and fun concept."

---

### Eno Johnny — ⭐⭐⭐⭐
**What they liked:**
> "The dark theme UI looks great. Staking XLM for chess is a great idea."

**What was missing:**
> "Really enjoyed it. Only thing missing is a direct chat feature with the opponent. I would love to see it added in future."

---

### Moses Oladejo — ⭐⭐⭐⭐⭐
**What they liked:**
> "I liked the whole concept. Staking and playing chess is a fun idea. The game loaded fast, UI is good."

**What was missing:**
> "The game is straightforward, classic chess rules. Looking forward to playing more games and would love to see the option to report or flag any suspected cheating."

---

### Afolabi Nelson — ⭐⭐
**What they liked:**
> "Staking XLM for a chess game is a great idea. The move confirmation toast is reassuring. Fastest way to 2x with a win."

**What was missing:**
> "Really enjoyed it. The invite link sharing works well. I noticed I couldn't do some moves I expected to be able to do like moving the king two squares to castle."

---

### Darhmie Lola — ⭐⭐⭐⭐⭐
**What they liked:**
> "I really enjoyed it. The invite link sharing works well. I noticed I couldn't see my created games — it would be nice to see my active games and history too."

**What was missing:**
> "Not being able to see the games I just created directly. The search works but it's hard to identify my games without the game ID."

---

## Feedback Summary

| Theme | Frequency | Impact |
|---|---|---|
| Staking mechanic is engaging and exciting | 5/5 | ✅ positive |
| UI / dark theme is clean and professional | 4/5 | ✅ positive |
| Missing castling move | 1/5 | 🔧 medium — fixed |
| No way to see own created/active games | 2/5 | 🔧 medium — planned |
| In-game chat with opponent requested | 1/5 | 💡 feature request |
| Anti-cheat / report system requested | 1/5 | 💡 feature request |
 
---

## Iteration 1 — Changes Shipped

### ✅ Added Castling Support
**Feedback trigger:** Afolabi Nelson — "couldn't do some moves I expected, like moving the king two squares to castle"

**Change:** Implemented kingside and queenside castling in the chess engine. The king can now move two squares toward a rook, with the rook jumping to the other side, provided neither piece has moved and the path is clear and not under attack.

**Commit:** [Add castling support →](https://github.com/youthisguy/kingfall/commit/fa3b278608eab3c97964a773b773c4194ce58874)

---

### ✅ Added En Passant Capture
**Feedback trigger:** General play testing — en passant capture was rejected as illegal

**Change:** Implemented en passant pawn capture per standard chess rules.

**Commit:** [Add en passant →](https://github.com/youthisguy/kingfall/commit/fa3b278608eab3c97964a773b773c4194ce58874)

---

### ✅ Active Games Visible Without Game ID
**Feedback trigger:** Darhmie Lola — "not being able to see the games I just created directly, hard to identify my games without the game ID"

**Change:** The lobby sidebar now auto-loads and displays all open and active games on page load without needing to search by ID. Open Games and All Games sections expand automatically so players can see and join their games directly.

**Commit:** [Auto-load game lists on lobby mount →](https://github.com/youthisguy/kingfall/commit/ede1b32af326a716aaabd8be2d5493591e1be67a)

---

## Planned — Iteration 2

| Feature | Feedback Source | Priority |
|---|---|---|
| My Games tab — filter games by connected wallet | Darhmie Lola | High |
| In-game chat with opponent | Eno Johnny | Medium |
| Anti-cheat / move dispute system | Moses Oladejo | Medium |
| Mainnet deployment | All testers | High |

---

## Conclusion

All 5 testers rated KingFall avg 4.4 out of 5. The staking mechanic was unanimously praised — the concept of putting real XLM on the line elevated the chess experience for every tester. The primary gaps identified were around game discoverability (seeing your own games without a game ID) and missing chess rules (castling), both addressed in Iteration 1. Feature requests for in-game chat and anti-cheat reporting reflect genuine engagement with the product and will be prioritised in Iteration 2.