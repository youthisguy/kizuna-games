"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState } from "react";
import {
  Star,
  TrendingUp,
  Heart,
  Search,
  Bell,
  Wallet,
  ArrowUpAZIcon,
  ArrowUpCircle,
} from "lucide-react";

const GAMES = [
  {
    id: "chess",
    name: "Chess Arena",
    category: "Strategize. Stake. Checkmate.",
    tagline: "Stake. Play. Conquer.",
    description:
      "P2P chess with XLM stakes locked in Soroban escrow. Winner claims all.",
    href: "/chess",
    status: "live" as const,
    accentColor: "#d97706",
    glowColor: "rgba(217,119,6,0.5)",
    votes: 32,
    featured: true,
  },
  {
    id: "battleship",
    name: "Battleship Wars",
    category: "Coordinate. Strike. Sink.",
    tagline: "Sink or be sunk.",
    description:
      "Classic naval warfare on-chain. Hide your fleet, call your shots.",
    href: "/battleship",
    status: "live" as const,
    accentColor: "#d97706",
    glowColor: "rgba(217,119,6,0.5)",
    votes: 12,
    featured: true,
  },
  {
    id: "pool",
    name: "8-Ball Pool",
    category: "Rack. Call. Clear.",
    tagline: "Rack 'em. Break 'em.",
    description:
      "Call your pockets and run the table. XLM pot for the one who clears it.",
    href: "/pool",
    status: "live" as const,
    accentColor: "#d97706",
    glowColor: "rgba(217,119,6,0.5)",
    votes: 13,
    featured: true,
  },
  {
    id: "liars-dice",
    name: "Liar's Dice",
    category: "Bluff. Bid. Outlast.",
    tagline: "Trust no one. Call the bluff.",
    description:
      "Deception meets probability. Keep your dice hidden and the stakes high in this on-chain bluffing game.",
    href: "/liars-dice",
    status: "live" as const,
    accentColor: "#d97706",
    glowColor: "rgba(217,119,6,0.5)",
    votes: 24,
    featured: true,
  },
] as const;

// ─── Chess canvas ─────────────────────────────────────────────────────────────
function ChessCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const SZ = fill ? 30 : 20,
      COLS = 8,
      ROWS = 8;
    canvas.width = SZ * COLS;
    canvas.height = SZ * ROWS;
    const LIGHT = "#3d2e1a",
      DARK = "#1a1108";
    const GLYPHS: Record<string, string> = {
      K: "♔",
      Q: "♕",
      R: "♖",
      B: "♗",
      N: "♘",
      P: "♙",
      k: "♚",
      q: "♛",
      r: "♜",
      b: "♝",
      n: "♞",
      p: "♟︎",
    };
    type Board = (string | null)[][];
    const makeBoard = (): Board => [
      ["r", "n", "b", "q", "k", "b", "n", "r"],
      ["p", "p", "p", "p", "p", "p", "p", "p"],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ["P", "P", "P", "P", "P", "P", "P", "P"],
      ["R", "N", "B", "Q", "K", "B", "N", "R"],
    ];
    const MOVES = [
      { from: [6, 4], to: [4, 4] },
      { from: [1, 4], to: [3, 4] },
      { from: [7, 6], to: [5, 5] },
      { from: [0, 6], to: [2, 5] },
      { from: [7, 5], to: [4, 2] },
      { from: [0, 1], to: [2, 2] },
      { from: [6, 3], to: [4, 3] },
      { from: [1, 3], to: [3, 3] },
      { from: [5, 5], to: [3, 4] },
      { from: [0, 5], to: [3, 2] },
    ];
    let board = makeBoard(),
      moveIdx = 0,
      frac = 0,
      animating = false;
    let aFrom: number[] | null = null,
      aTo: number[] | null = null,
      aPiece: string | null = null,
      pause = 0;
    const reset = () => {
      board = makeBoard();
      pause = 60;
      moveIdx = 0;
    };
    const drawPiece = (p: string, x: number, y: number) => {
      ctx.save();
      ctx.font = `bold ${SZ * 0.78}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = p === p.toUpperCase() ? "#e8c97a" : "#a0785a";
      ctx.fillText(GLYPHS[p] || "?", x, y + 1);
      ctx.restore();
    };
    const draw = () => {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
          ctx.fillRect(c * SZ, r * SZ, SZ, SZ);
        }
      if (aFrom) {
        ctx.fillStyle = "rgba(217,119,6,0.25)";
        ctx.fillRect(aFrom[1] * SZ, aFrom[0] * SZ, SZ, SZ);
      }
      if (aTo) {
        ctx.fillStyle = "rgba(217,119,6,0.18)";
        ctx.fillRect(aTo[1] * SZ, aTo[0] * SZ, SZ, SZ);
      }
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const p = board[r][c];
          if (p && !(animating && aFrom && aFrom[0] === r && aFrom[1] === c))
            drawPiece(p, c * SZ + SZ / 2, r * SZ + SZ / 2);
        }
      if (animating && aFrom && aTo && aPiece) {
        drawPiece(
          aPiece,
          (aFrom[1] + (aTo[1] - aFrom[1]) * frac) * SZ + SZ / 2,
          (aFrom[0] + (aTo[0] - aFrom[0]) * frac) * SZ + SZ / 2
        );
      }
    };
    const step = () => {
      if (pause > 0) {
        pause--;
        draw();
        return;
      }
      if (!animating) {
        if (moveIdx >= MOVES.length) {
          reset();
          return;
        }
        const mv = MOVES[moveIdx];
        aFrom = mv.from;
        aTo = mv.to;
        aPiece = board[mv.from[0]][mv.from[1]];
        board[mv.from[0]][mv.from[1]] = null;
        animating = true;
        frac = 0;
      }
      frac = Math.min(1, frac + 0.06);
      draw();
      if (frac >= 1) {
        board[aTo![0]][aTo![1]] = aPiece;
        animating = false;
        frac = 0;
        moveIdx++;
        pause = 35;
      }
    };
    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: "cover",
      }}
    />
  );
}

// ─── Battleship canvas ────────────────────────────────────────────────────────
function BattleshipCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = fill ? 320 : 160,
      H = fill ? 240 : 160,
      COLS = 8,
      ROWS = 8;
    canvas.width = W;
    canvas.height = H;
    const SZ = Math.min(W, H) / COLS;
    const offsetX = (W - SZ * COLS) / 2,
      offsetY = (H - SZ * ROWS) / 2;
    const grid: (string | null)[][] = Array.from({ length: ROWS }, () =>
      Array(COLS).fill(null)
    );
    [
      [1, 1],
      [1, 2],
      [1, 3],
      [4, 5],
      [4, 6],
      [6, 2],
      [6, 3],
      [6, 4],
      [6, 5],
      [2, 6],
      [3, 6],
    ].forEach(([r, c]) => {
      grid[r][c] = "S";
    });
    const SHOTS: [number, number, boolean][] = [
      [1, 1, true],
      [1, 2, true],
      [1, 3, true],
      [3, 3, false],
      [2, 4, false],
      [4, 5, true],
      [4, 6, true],
      [5, 1, false],
      [6, 2, true],
      [6, 3, true],
      [6, 4, true],
      [6, 5, true],
      [0, 7, false],
      [3, 7, false],
      [7, 0, false],
    ];
    let shotIdx = 0;
    const revealed = new Map<string, [boolean, number]>();
    let pause = 30;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#060f18";
      ctx.fillRect(0, 0, W, H);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? "#0f1f2e" : "#0a1820";
          ctx.fillRect(offsetX + c * SZ, offsetY + r * SZ, SZ, SZ);
          ctx.strokeStyle = "rgba(59,130,246,0.12)";
          ctx.strokeRect(offsetX + c * SZ, offsetY + r * SZ, SZ, SZ);
        }
      revealed.forEach(([isHit, age], key) => {
        const [r, c] = key.split(",").map(Number);
        const x = offsetX + c * SZ + SZ / 2,
          y = offsetY + r * SZ + SZ / 2,
          scale = Math.min(1, age / 8);
        if (isHit) {
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(scale, scale);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, SZ * 0.45);
          g.addColorStop(0, "rgba(255,200,50,0.9)");
          g.addColorStop(0.4, "rgba(255,80,0,0.7)");
          g.addColorStop(1, "rgba(255,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, SZ * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = "rgba(255,100,50,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 4 * scale, y - 4 * scale);
          ctx.lineTo(x + 4 * scale, y + 4 * scale);
          ctx.moveTo(x + 4 * scale, y - 4 * scale);
          ctx.lineTo(x - 4 * scale, y + 4 * scale);
          ctx.stroke();
        } else {
          ctx.save();
          ctx.globalAlpha = scale;
          ctx.fillStyle = "rgba(100,180,255,0.35)";
          ctx.beginPath();
          ctx.arc(x, y, SZ * 0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(150,200,255,0.6)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, SZ * 0.35, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        revealed.set(key, [isHit, Math.min(age + 1, 12)]);
      });
      if (shotIdx < SHOTS.length) {
        const [r, c] = SHOTS[shotIdx];
        const x = offsetX + c * SZ + SZ / 2,
          y = offsetY + r * SZ + SZ / 2,
          t = Date.now() / 400;
        ctx.strokeStyle = `rgba(239,68,68,${0.5 + 0.4 * Math.sin(t)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    const step = () => {
      if (pause > 0) {
        pause--;
        draw();
        return;
      }
      if (shotIdx < SHOTS.length) {
        const [r, c, isHit] = SHOTS[shotIdx];
        revealed.set(`${r},${c}`, [isHit, 0]);
        shotIdx++;
        pause = 28;
        if (shotIdx >= SHOTS.length) pause = 90;
      } else {
        revealed.clear();
        shotIdx = 0;
        pause = 40;
      }
      draw();
    };
    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

// ─── Darts canvas ─────────────────────────────────────────────────────────────
function DartsCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = fill ? 320 : 160,
      H = fill ? 240 : 160;
    canvas.width = W;
    canvas.height = H;
    const CX = W / 2,
      CY = H / 2,
      R = Math.min(W, H) * 0.42;
    const RINGS = [
      { r: R * 0.08, color: "#1a0a1a" },
      { r: R * 0.19, color: "#22c55e" },
      { r: R * 0.38, color: "#e11d48" },
      { r: R * 0.52, color: "#1e293b" },
      { r: R * 0.68, color: "#e11d48" },
      { r: R * 0.82, color: "#1e293b" },
      { r: R, color: "#2d1b0e" },
    ];
    const TARGETS: [number, number, number][] = [
      [0, 0, 50],
      [0.55, 0.45, 20],
      [-0.4, 0.25, 20],
      [0.1, -0.6, 15],
      [-0.25, -0.5, 10],
      [0.65, -0.35, 5],
    ];
    type Dart = {
      x: number;
      y: number;
      score: number;
      age: number;
      flying: boolean;
      flyFrac: number;
    };
    let darts: Dart[] = [],
      nextDart = 0,
      pause = 20;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0605";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#0f0a06";
      ctx.beginPath();
      ctx.arc(CX, CY, R + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CX, CY, R + 6, 0, Math.PI * 2);
      ctx.stroke();
      [...RINGS].reverse().forEach((ring) => {
        ctx.fillStyle = ring.color;
        ctx.beginPath();
        ctx.arc(CX, CY, ring.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(CX, CY, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      });
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 - Math.PI / 20;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
        ctx.stroke();
      }
      darts.forEach((d) => {
        if (d.flying) return;
        const alpha = Math.min(1, d.age / 5);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#c0a060";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x - 10, d.y - 10);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        if (d.age > 3) {
          ctx.font = "bold 9px monospace";
          ctx.fillStyle = d.score >= 25 ? "#fbbf24" : "#a0a0a0";
          ctx.textAlign = "center";
          ctx.fillText(`+${d.score}`, d.x + 4, d.y - 14);
        }
        ctx.restore();
        d.age++;
      });
      const flying = darts.find((d) => d.flying);
      if (flying) {
        const t = flying.flyFrac,
          sX = W * 0.9,
          sY = H * 0.15;
        const px = sX + (flying.x - sX) * t,
          py = sY + (flying.y - sY) * t - 18 * Math.sin(t * Math.PI);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(flying.y - sY, flying.x - sX));
        ctx.strokeStyle = "#c0a060";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        ctx.fillStyle = "#e0c080";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-3, -2);
        ctx.lineTo(-3, 2);
        ctx.fill();
        ctx.restore();
        flying.flyFrac = Math.min(1, flying.flyFrac + 0.07);
        if (flying.flyFrac >= 1) flying.flying = false;
      }
    };
    const step = () => {
      if (pause > 0) {
        pause--;
        draw();
        return;
      }
      if (nextDart < TARGETS.length && !darts.find((d) => d.flying)) {
        const [ox, oy, score] = TARGETS[nextDart];
        const j = () => (Math.random() - 0.5) * 4;
        darts.push({
          x: CX + ox * R * 0.9 + j(),
          y: CY + oy * R * 0.9 + j(),
          score,
          age: 0,
          flying: true,
          flyFrac: 0,
        });
        nextDart++;
        pause = 40;
      } else if (!darts.find((d) => d.flying) && nextDart >= TARGETS.length) {
        pause = 80;
        if (darts.every((d) => d.age > 30)) {
          darts = [];
          nextDart = 0;
        }
      }
      draw();
    };
    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

// ─── Word Hunt canvas ─────────────────────────────────────────────────────────
function WordsCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = fill ? 320 : 160,
      H = fill ? 240 : 160;
    canvas.width = W;
    canvas.height = H;
    const GRID = [
      ["S", "T", "A", "K", "E", "X"],
      ["W", "O", "R", "D", "P", "L"],
      ["C", "H", "A", "I", "N", "A"],
      ["Q", "Z", "R", "A", "C", "Y"],
      ["B", "L", "O", "C", "K", "S"],
      ["F", "I", "N", "D", "E", "R"],
    ];
    const WORDS = [
      {
        word: "STAKE",
        cells: [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
        ],
        color: "#d97706",
      },
      {
        word: "WORD",
        cells: [
          [1, 0],
          [1, 1],
          [1, 2],
          [1, 3],
        ],
        color: "#8b5cf6",
      },
      {
        word: "CHAIN",
        cells: [
          [2, 0],
          [2, 1],
          [2, 2],
          [2, 3],
          [2, 4],
        ],
        color: "#3b82f6",
      },
      {
        word: "BLOCK",
        cells: [
          [4, 0],
          [4, 1],
          [4, 2],
          [4, 3],
          [4, 4],
        ],
        color: "#10b981",
      },
      {
        word: "PLAY",
        cells: [
          [1, 5],
          [0, 5],
          [2, 5],
          [3, 5],
        ],
        color: "#ec4899",
      },
    ];
    const COLS = GRID[0].length,
      ROWS = GRID.length,
      SZ = Math.min(W / COLS, H / ROWS);
    const oX = (W - SZ * COLS) / 2,
      oY = (H - SZ * ROWS) / 2;
    let foundIdx = 0,
      foundAnim = 0,
      pause = 20,
      scanR = 0,
      scanC = 0,
      scanPause = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0d0d14";
      ctx.fillRect(0, 0, W, H);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const x = oX + c * SZ,
            y = oY + r * SZ;
          ctx.fillStyle = "rgba(139,92,246,0.04)";
          ctx.fillRect(x + 1, y + 1, SZ - 2, SZ - 2);
          ctx.strokeStyle = "rgba(139,92,246,0.12)";
          ctx.strokeRect(x + 1, y + 1, SZ - 2, SZ - 2);
        }
      WORDS.slice(0, foundIdx).forEach((w) => {
        w.cells.forEach(([r, c]) => {
          ctx.fillStyle = w.color + "28";
          ctx.fillRect(oX + c * SZ + 1, oY + r * SZ + 1, SZ - 2, SZ - 2);
          ctx.strokeStyle = w.color + "88";
          ctx.strokeRect(oX + c * SZ + 1, oY + r * SZ + 1, SZ - 2, SZ - 2);
        });
      });
      if (foundIdx < WORDS.length) {
        const w = WORDS[foundIdx];
        w.cells.slice(0, Math.ceil(foundAnim / 4)).forEach(([r, c]) => {
          const a = Math.min(1, (foundAnim % 4) / 4 + 0.5);
          ctx.fillStyle =
            w.color +
            Math.round(a * 64)
              .toString(16)
              .padStart(2, "0");
          ctx.fillRect(oX + c * SZ + 1, oY + r * SZ + 1, SZ - 2, SZ - 2);
          ctx.strokeStyle = w.color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(oX + c * SZ + 1.5, oY + r * SZ + 1.5, SZ - 3, SZ - 3);
        });
      }
      const t = Date.now() / 200;
      ctx.strokeStyle = `rgba(139,92,246,${0.4 + 0.3 * Math.sin(t)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(oX + scanC * SZ + 2, oY + scanR * SZ + 2, SZ - 4, SZ - 4);
      ctx.font = `bold ${SZ * 0.55}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const inFound = WORDS.slice(0, foundIdx).find((w) =>
            w.cells.some(([wr, wc]) => wr === r && wc === c)
          );
          const inCurrent =
            foundIdx < WORDS.length &&
            WORDS[foundIdx].cells.some(([wr, wc]) => wr === r && wc === c);
          ctx.fillStyle = inFound
            ? inFound.color
            : inCurrent
            ? "#fff"
            : "rgba(139,92,246,0.5)";
          ctx.fillText(
            GRID[r][c],
            oX + c * SZ + SZ / 2,
            oY + r * SZ + SZ / 2 + 1
          );
        }
    };
    const step = () => {
      if (scanPause > 0) {
        scanPause--;
      } else {
        scanC = (scanC + 1) % COLS;
        if (scanC === 0) scanR = (scanR + 1) % ROWS;
        scanPause = 2;
      }
      if (pause > 0) {
        pause--;
        draw();
        return;
      }
      if (foundIdx < WORDS.length) {
        const maxF = WORDS[foundIdx].cells.length * 4 + 8;
        foundAnim++;
        if (foundAnim >= maxF) {
          foundIdx++;
          foundAnim = 0;
          pause = 30;
        }
      } else {
        pause = 100;
        if (pause === 0) {
          foundIdx = 0;
          foundAnim = 0;
        }
      }
      draw();
    };
    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

// ─── Pool canvas ──────────────────────────────────────────────────────────────
function PoolCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = fill ? 320 : 160,
      H = fill ? 240 : 160;
    canvas.width = W;
    canvas.height = H;
    const PAD = 14,
      TW = W - PAD * 2,
      TH = H - PAD * 2,
      TX = PAD,
      TY = PAD,
      R = fill ? 9 : 7;
    const COLORS = [
      "#f5c542",
      "#3b82f6",
      "#ef4444",
      "#a855f7",
      "#f97316",
      "#22c55e",
      "#ec4899",
      "#111",
    ];
    type Ball = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      num: number;
      sunk: boolean;
    };
    const makeBalls = (): Ball[] => {
      const balls: Ball[] = [];
      const cx = TX + TW * 0.65,
        cy = TY + TH / 2;
      let idx = 0;
      for (let row = 0; row < 5; row++)
        for (let col = 0; col <= row; col++) {
          balls.push({
            x: cx + row * (R * 1.9),
            y: cy - row * R * 0.95 + col * R * 1.9,
            vx: 0,
            vy: 0,
            color: COLORS[idx % 8],
            num: idx + 1,
            sunk: false,
          });
          idx++;
        }
      balls.push({
        x: TX + TW * 0.25,
        y: TY + TH / 2,
        vx: 0,
        vy: 0,
        color: "#fff",
        num: 0,
        sunk: false,
      });
      return balls;
    };
    let balls = makeBalls(),
      phase: "aim" | "rolling" | "paused" = "paused",
      aimAngle = 0,
      aimAnim = 0,
      pause = 30,
      resetTimer = 0;
    const POCKETS = [
      [TX, TY],
      [TX + TW, TY],
      [TX, TY + TH],
      [TX + TW, TY + TH],
      [TX + TW / 2, TY],
      [TX + TW / 2, TY + TH],
    ];
    const physics = () => {
      const FR = 0.97,
        MV = 0.04;
      balls.forEach((b) => {
        if (b.sunk) return;
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= FR;
        b.vy *= FR;
        if (Math.abs(b.vx) < MV) b.vx = 0;
        if (Math.abs(b.vy) < MV) b.vy = 0;
        if (b.x - R < TX) {
          b.x = TX + R;
          b.vx = Math.abs(b.vx) * 0.7;
        }
        if (b.x + R > TX + TW) {
          b.x = TX + TW - R;
          b.vx = -Math.abs(b.vx) * 0.7;
        }
        if (b.y - R < TY) {
          b.y = TY + R;
          b.vy = Math.abs(b.vy) * 0.7;
        }
        if (b.y + R > TY + TH) {
          b.y = TY + TH - R;
          b.vy = -Math.abs(b.vy) * 0.7;
        }
        POCKETS.forEach(([px, py]) => {
          if (Math.hypot(b.x - px, b.y - py) < R + 2) b.sunk = true;
        });
      });
      for (let i = 0; i < balls.length; i++)
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i],
            b = balls[j];
          if (a.sunk || b.sunk) continue;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            dist = Math.hypot(dx, dy);
          if (dist < R * 2 && dist > 0) {
            const nx = dx / dist,
              ny = dy / dist,
              ov = R * 2 - dist;
            a.x -= (nx * ov) / 2;
            a.y -= (ny * ov) / 2;
            b.x += (nx * ov) / 2;
            b.y += (ny * ov) / 2;
            const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (rel > 0) {
              a.vx -= rel * nx;
              a.vy -= rel * ny;
              b.vx += rel * nx;
              b.vy += rel * ny;
            }
          }
        }
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#061a0e";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#0f2d1a";
      ctx.beginPath();
      (ctx as any).roundRect(TX, TY, TW, TH, 4);
      ctx.fill();
      ctx.strokeStyle = "#1a5c30";
      ctx.lineWidth = 3;
      ctx.beginPath();
      (ctx as any).roundRect(TX, TY, TW, TH, 4);
      ctx.stroke();
      POCKETS.forEach(([px, py]) => {
        ctx.fillStyle = "#050e09";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      if (phase === "aim") {
        const cue = balls.find((b) => b.num === 0);
        if (cue) {
          const t = Date.now() / 300;
          ctx.strokeStyle = `rgba(255,255,255,${0.15 + 0.1 * Math.sin(t)})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(cue.x, cue.y);
          ctx.lineTo(
            cue.x + Math.cos(aimAngle) * 65,
            cue.y + Math.sin(aimAngle) * 65
          );
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      balls.forEach((b) => {
        if (b.sunk) return;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.arc(b.x - 2, b.y - 2, R * 0.38, 0, Math.PI * 2);
        ctx.fill();
        if (b.num > 0 && b.num < 8) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = `bold ${R * 0.9}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(b.num), b.x, b.y + 0.5);
        }
        if (b.num === 8) {
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.beginPath();
          ctx.arc(b.x, b.y, R * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#111";
          ctx.font = `bold ${R * 0.8}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("8", b.x, b.y + 0.5);
        }
      });
    };
    const step = () => {
      if (pause > 0) {
        pause--;
        draw();
        return;
      }
      if (phase === "paused") {
        aimAnim++;
        aimAngle = -0.1 + Math.sin(aimAnim / 40) * 0.3;
        phase = "aim";
      }
      if (phase === "aim") {
        aimAnim++;
        aimAngle = -0.1 + Math.sin(aimAnim / 40) * 0.3;
        if (aimAnim > 80) {
          const cue = balls.find((b) => b.num === 0)!;
          cue.vx = Math.cos(aimAngle) * 5.5;
          cue.vy = Math.sin(aimAngle) * 5.5;
          phase = "rolling";
          aimAnim = 0;
        }
      }
      if (phase === "rolling") {
        physics();
        draw();
        if (balls.every((b) => b.sunk || (b.vx === 0 && b.vy === 0))) {
          resetTimer++;
          if (resetTimer > 60) {
            balls = makeBalls();
            aimAngle = 0;
            aimAnim = 0;
            phase = "paused";
            pause = 40;
            resetTimer = 0;
          }
        }
      } else draw();
    };
    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}

// ─── Liar's Dice canvas ───────────────────────────────────────────────────────
function LiarsDiceCanvas({ fill = false }: { fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = fill ? 320 : 160, H = fill ? 240 : 160;
    canvas.width = W;
    canvas.height = H;

    const DIE_SIZE = fill ? 28 : 18;
    const GAP = fill ? 10 : 6;

    // Dot positions for each face value (normalized -1 to 1 grid)
    const DOTS: [number, number][][] = [
      [[0, 0]],
      [[-1, -1], [1, 1]],
      [[-1, -1], [0, 0], [1, 1]],
      [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    ];

    type Die = { value: number; revealed: boolean; x: number; y: number; shakeT: number; shaking: boolean };

    // Two players: top (opponent, hidden) and bottom (player, revealed)
    const makeDice = (): { top: Die[]; bottom: Die[] } => {
      const row = (y: number, revealed: boolean): Die[] =>
        Array.from({ length: 5 }, (_, i) => ({
          value: Math.ceil(Math.random() * 6),
          revealed,
          x: W / 2 - 2 * (DIE_SIZE + GAP) + i * (DIE_SIZE + GAP),
          y,
          shakeT: 0,
          shaking: false,
        }));
      return {
        top: row(fill ? H * 0.2 : H * 0.18, false),
        bottom: row(fill ? H * 0.65 : H * 0.68, true),
      };
    };

    type Phase = "show" | "shaking" | "reveal" | "pause";
    let dice = makeDice();
    let phase: Phase = "show";
    let tick = 0;
    let pauseT = 0;

    // Bid state
    let bidQty = 3, bidFace = 4;

    const drawDie = (d: Die) => {
      const s = DIE_SIZE;
      const ox = d.shaking ? (Math.random() - 0.5) * 3 : 0;
      const oy = d.shaking ? (Math.random() - 0.5) * 3 : 0;
      const x = d.x + ox, y = d.y + oy;

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.roundRect(x - s / 2 + 2, y - s / 2 + 2, s, s, 4);
      ctx.fill();

      // Die face
      if (!d.revealed) {
        ctx.fillStyle = "#1e2636";
        ctx.strokeStyle = "#3a4a6a";
      } else {
        ctx.fillStyle = "#f0ece0";
        ctx.strokeStyle = "#c8b890";
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - s / 2, y - s / 2, s, s, 4);
      ctx.fill();
      ctx.stroke();

      if (!d.revealed) {
        // Question mark on hidden dice
        ctx.fillStyle = "#4a6080";
        ctx.font = `bold ${s * 0.5}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x, y + 1);
        return;
      }

      // Dots
      const DOT_R = s * 0.09;
      const SPREAD = s * 0.27;
      ctx.fillStyle = "#2a1a0a";
      (DOTS[d.value - 1] || []).forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(x + dx * SPREAD, y + dy * SPREAD, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const drawBid = () => {
      const cx = W / 2, by = H / 2;
      const label = `${bidQty} × `;
      const dieStr = String(bidFace);

      ctx.font = `bold ${fill ? 15 : 10}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Bid pill background
      const pillW = fill ? 110 : 70, pillH = fill ? 28 : 18;
      ctx.fillStyle = "#1a1c28";
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - pillW / 2, by - pillH / 2, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.stroke();

      // Pulsing glow
      const t = Date.now() / 500;
      ctx.strokeStyle = `rgba(217,119,6,${0.3 + 0.2 * Math.sin(t)})`;
      ctx.lineWidth = fill ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - pillW / 2 - 2, by - pillH / 2 - 2, pillW + 4, pillH + 4, pillH / 2 + 2);
      ctx.stroke();

      ctx.fillStyle = "#f0c060";
      ctx.font = `bold ${fill ? 13 : 9}px monospace`;
      ctx.fillText(`BID: ${bidQty} × [${bidFace}]`, cx, by);
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);

      // Felt texture lines
      ctx.strokeStyle = "rgba(217,119,6,0.04)";
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Divider line
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, H / 2);
      ctx.lineTo(W - 16, H / 2);
      ctx.stroke();

      // Player labels
      ctx.font = `${fill ? 10 : 7}px monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("OPP", 6, dice.top[0].y);
      ctx.fillText("YOU", 6, dice.bottom[0].y);

      [...dice.top, ...dice.bottom].forEach(drawDie);
      drawBid();
    };

    const step = () => {
      tick++;

      if (phase === "show") {
        if (tick > 90) { phase = "shaking"; tick = 0; bidQty = Math.ceil(Math.random() * 4) + 1; bidFace = Math.ceil(Math.random() * 5) + 1; }
      } else if (phase === "shaking") {
        dice.top.forEach(d => { d.shaking = true; });
        dice.bottom.forEach(d => { d.shaking = true; });
        if (tick > 35) {
          dice.top.forEach(d => { d.shaking = false; d.value = Math.ceil(Math.random() * 6); });
          dice.bottom.forEach(d => { d.shaking = false; d.value = Math.ceil(Math.random() * 6); d.revealed = false; });
          phase = "reveal"; tick = 0;
        }
      } else if (phase === "reveal") {
        // Reveal bottom dice one by one
        const idx = Math.floor(tick / 12);
        dice.bottom.forEach((d, i) => { if (i <= idx) d.revealed = true; });
        if (idx >= 5) { phase = "pause"; tick = 0; pauseT = 80; }
      } else if (phase === "pause") {
        pauseT--;
        if (pauseT <= 0) {
          dice = makeDice();
          phase = "show"; tick = 0;
        }
      }

      draw();
    };

    draw();
    const id = setInterval(step, 40);
    return () => clearInterval(id);
  }, [fill]);
  return (
    <canvas
      ref={ref}
      style={{ imageRendering: "pixelated", width: "100%", height: "100%", display: "block" }}
    />
  );
}

// ─── Canvas map ───────────────────────────────────────────────────────────────
const CANVAS_MAP: Record<string, React.ComponentType<{ fill?: boolean }>> = {
  chess: ChessCanvas,
  battleship: BattleshipCanvas,
  darts: DartsCanvas,
  words: WordsCanvas,
  pool: PoolCanvas,
  "liars-dice": LiarsDiceCanvas,
};

// ─── Game icon (small circle avatar) ─────────────────────────────────────────
function GameIcon({
  gameId,
  accentColor,
}: {
  gameId: string;
  accentColor: string;
}) {
  const Canvas = CANVAS_MAP[gameId] ?? ChessCanvas;
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: "50%",
        overflow: "hidden",
        border: `2px solid ${accentColor}66`,
        background: "#111",
        flexShrink: 0,
      }}
    >
      <Canvas />
    </div>
  );
}

// ─── Game banner (full canvas preview) ───────────────────────────────────────
function GameBanner({ gameId }: { gameId: string }) {
  const Canvas = CANVAS_MAP[gameId] ?? ChessCanvas;
  return (
    <div
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
    >
      <Canvas fill />
    </div>
  );
}

// ─── Format vote count ────────────────────────────────────────────────────────
function fmtVotes(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── Spotlight Game Card ──────────────────────────────────────────────────────
function SpotlightCard({
  game,
  onClick,
}: {
  game: (typeof GAMES)[number];
  onClick: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const isLive = game.status === "live";

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16,
        overflow: "hidden",
        background: "#111318",
        border: "1px solid rgba(255,255,255,0.07)",
        cursor: isLive ? "pointer" : "default",
        transition: "transform 0.18s, border-color 0.18s",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseEnter={(e) => {
        if (isLive)
          (e.currentTarget as HTMLDivElement).style.transform =
            "translateY(-2px)";
        (
          e.currentTarget as HTMLDivElement
        ).style.borderColor = `${game.accentColor}44`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "rgba(255,255,255,0.07)";
      }}
    >
      {/* Banner area */}
      <div
        style={{
          position: "relative",
          height: 200,
          background: "#0a0a0f",
          overflow: "hidden",
        }}
      >
        <GameBanner gameId={game.id} />

        {/* Gradient overlay at bottom */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.75) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Top row: New badge + vote count + heart */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          {isLive ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(250,200,50,0.92)",
                borderRadius: 20,
                padding: "4px 10px",
                pointerEvents: "auto",
              }}
            >
              <Star size={11} style={{ color: "#7a4f00", fill: "#7a4f00" }} />

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#5a3800",
                  letterSpacing: "0.02em",
                }}
              >
                New
              </span>
            </div>
          ) : (
            <span></span>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
            }}
          >
            {/* Vote count */}
            {isLive ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(6px)",
                  borderRadius: 20,
                  padding: "4px 10px",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <ArrowUpCircle size={11} style={{ color: game.accentColor }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>
                  {fmtVotes(game.votes)}
                </span>
              </div>
            ) : (
              <></>
            )}

            {isLive ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLiked((l) => !l);
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(6px)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <Heart
                  size={13}
                  style={{
                    color: liked ? "#ef4444" : "#888",
                    fill: liked ? "#ef4444" : "none",
                    transition: "all 0.15s",
                  }}
                />
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>

      {/* Bottom info row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "#111318",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GameIcon gameId={game.id} accentColor={game.accentColor} />
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                color: "#f0f0f0",
                lineHeight: 1.2,
              }}
            >
              {game.name}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "#666",
                lineHeight: 1.2,
                marginTop: 2,
              }}
            >
              {game.category}
            </p>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isLive) onClick();
          }}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: isLive ? "pointer" : "not-allowed",
            border: "none",
            background: isLive
              ? `linear-gradient(135deg, ${game.accentColor}, ${game.accentColor}cc)`
              : "rgba(255,255,255,0.07)",
            color: isLive ? "#000" : "#444",
            letterSpacing: "0.02em",
            transition: "opacity 0.15s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (isLive)
              (e.currentTarget as HTMLButtonElement).style.opacity = "0.85";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
          }}
        >
          {isLive ? "Play" : "Coming soon"}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [showNotifications, setShowNotifications] = useState(false);

  const go = useCallback(
    (href: string) => {
      if (href !== "#") router.push(href);
    },
    [router]
  );

  return (
    <div
      className="min-h-screen bg-[#0d0e12] text-[#e0e0e0]  rounded-lg overflow-hidden shadow-inner"
      style={{
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      }}
    >
      {/* Top nav bar */}
      <nav
        onClick={() => {
          setShowNotifications(!showNotifications);
        }}
        className="desktop-only-nav"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(13,14,18,0.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: 56,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}></div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
            }}
          >
            <Search size={17} />
          </button> */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowNotifications(!showNotifications)} // Toggle
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#888",
                position: "relative",
              }}
            >
              <Bell size={17} />
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#ef4444",
                  border: "2px solid #0d0e12", // Helps it stand out
                }}
              />
            </button>

            {/* Dropdown Notification Panel */}
            {showNotifications && (
              <div
                style={{
                  position: "absolute",
                  top: "52px", // Just below the nav bar
                  right: "10px",
                  width: 360,
                  background: "#111318",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 15px 35px rgba(0,0,0,0.6)",
                  zIndex: 100,
                  overflow: "hidden",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    fontWeight: 600,
                    fontSize: 15,
                  }}
                >
                  Notifications
                </div>

                {/* Notification Content */}
                <div style={{ padding: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      padding: "14px 16px",
                      background: "#1a1c24",
                      borderRadius: 12,
                      borderLeft: "4px solid #d97706",
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "2px solid #d9770666",
                      }}
                    >
                      <GameIcon gameId="chess" accentColor="#d97706" />
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>
                        Chess Arena is now live!
                      </div>
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 14,
                          color: "#ccc",
                          lineHeight: 1.4,
                        }}
                      >
                        Stake XLM and compete in chess matches.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: "12px 18px",
                    textAlign: "center",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    color: "#666",
                    fontSize: 13,
                  }}
                >
                  No more notifications
                </div>
              </div>
            )}
          </div>
          {/* <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
            }}
          >
            <Heart size={17} />
          </button> */}

          {/* Wallet chip */}
          {/* <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#1a1c24",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              padding: "6px 12px",
              marginLeft: 4,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 18,
                height: 12,
                borderRadius: 2,
                background: "linear-gradient(135deg, #d97706, #f59e0b)",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0" }}>
              $0.02
            </span>
          </div> */}

          {/* <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #8b5cf6, #3b82f6)",
              marginLeft: 4,
              cursor: "pointer",
            }}
          /> */}
        </div>
      </nav>

      <div
        style={{
          position: "relative",
          background: "#08080a",
          minHeight: "100vh",
          overflow: "hidden",
        }}
      >
        {/* The "Sheen" Layer  */}
        <div
          style={{
            position: "absolute",
            top: "-10%",
            right: "-10%",
            width: "60%",
            height: "60%",
            background: `radial-gradient(circle at 70% 30%, #d9770622 0%, #d9770605 50%, transparent 70%)`,
            filter: "blur(60px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {/* Main content */}
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "28px 20px 60px",
          }}
        >
          {/* Section header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "-0.02em",
                }}
              >
                Kizuna Games
              </h1>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#555" }}>
                Enjoy Peer-to-peer skill based games
              </p>
            </div>
            <button
              style={{
                background: "none",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                color: "#888",
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              Explore all
            </button>
          </div>

          {/* Card grid — 3 columns */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 14,
            }}
          >
            {GAMES.map((game) => (
              <SpotlightCard
                key={game.id}
                game={game}
                onClick={() => go(game.href)}
              />
            ))}
          </div>

          {/* Footer note */}
          <div
            style={{
              marginTop: 36,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              background: "#111318",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "1px solid #444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                color: "#555",
                flexShrink: 0,
              }}
            >
              i
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#444" }}>
              Provably verifiable protocol secured by trustless onchain bonds.
            </p>
            <a
              href="https://github.com/youthisguy/kizuna-games#readme"
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: "auto" }}
            >
              <button
                style={{
                  flexShrink: 0,
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  color: "#555",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Learn the Logic
              </button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
