"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";
import type { Coord, SymbolId } from "@/lib/game/superAce";
import { BET_STEPS, MULTIPLIERS, type BetStep } from "@/lib/game/superAce";

type SpinStep = {
  multiplier: (typeof MULTIPLIERS)[number];
  payoutCents: number;
  winningCoords: Coord[];
  gridAfter: SymbolId[][];
};

type SpinResponse = {
  balanceCents: number;
  totalWinCents: number;
  initialGrid: SymbolId[][];
  steps: SpinStep[];
  finalGrid: SymbolId[][];
  freeSpinsLeft: number;
  scatterCount: number;
  freeSpinsAwarded: number;
  specialCardTriggered: boolean;
  specialCardDoubled: boolean;
};

const symbolUi: Record<
  SymbolId,
  {
    bgClass: string;
    colorClass: string;
    char: string;
    label: string;
    sub: string;
  }
> = {
  A: {
    bgClass: "card-A",
    colorClass: "text-black",
    char: "♠️",
    label: "A",
    sub: "ACE",
  },
  K: {
    bgClass: "card-K",
    colorClass: "text-blue-900",
    char: "🤴",
    label: "K",
    sub: "",
  },
  Q: {
    bgClass: "card-Q",
    colorClass: "text-red-900",
    char: "👸",
    label: "Q",
    sub: "",
  },
  J: {
    bgClass: "card-J",
    colorClass: "text-blue-800",
    char: "👱",
    label: "",
    sub: "",
  },
  S: {
    bgClass: "card-S",
    colorClass: "text-gray-800",
    char: "♠️",
    label: "",
    sub: "",
  },
  H: {
    bgClass: "card-S",
    colorClass: "text-red-600",
    char: "♥️",
    label: "",
    sub: "",
  },
  D: {
    bgClass: "card-S",
    colorClass: "text-red-600",
    char: "♦️",
    label: "",
    sub: "",
  },
  C: {
    bgClass: "card-S",
    colorClass: "text-gray-800",
    char: "♣️",
    label: "",
    sub: "",
  },
  X: {
    bgClass: "card-K",
    colorClass: "text-yellow-300",
    char: "💠",
    label: "",
    sub: "SCATTER",
  },
};

function formatUnitsFromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatWinFromCents(cents: number) {
  return (cents / 100).toFixed(3);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DUMMY_WEIGHTS: SymbolId[] = [
  "C",
  "C",
  "C",
  "D",
  "D",
  "D",
  "H",
  "H",
  "S",
  "S",
  "J",
  "J",
  "Q",
  "Q",
  "K",
  "A",
  "X",
  "X",
  "X",
];

function createDummyGrid(): SymbolId[][] {
  const ROWS = 4;
  const COLS = 5;

  const rand = () => DUMMY_WEIGHTS[Math.floor(Math.random() * DUMMY_WEIGHTS.length)]!;

  const dummy: SymbolId[][] = [];
  for (let c = 0; c < COLS; c++) {
    const col: SymbolId[] = [];
    for (let r = 0; r < ROWS; r++) {
      col.push(rand());
    }
    dummy.push(col);
  }
  return dummy;
}

export default function SuperAceGame() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [balanceCents, setBalanceCents] = useState(0);
  const [currentBetIndex, setCurrentBetIndex] = useState(1); // Starts at bet 2
  const currentBet: BetStep = BET_STEPS[currentBetIndex]!;

  const [currentWinCents, setCurrentWinCents] = useState(0);
  const [currentMultiplierIndex, setCurrentMultiplierIndex] = useState(0);

  const [grid, setGrid] = useState<SymbolId[][]>(() => createDummyGrid());
  const [isSpinning, setIsSpinning] = useState(false);

  const [winningCoords, setWinningCoords] = useState<Coord[]>([]);
  const [destroyingCoords, setDestroyingCoords] = useState<Coord[]>([]);
  const [isFalling, setIsFalling] = useState(false);
  const winnerSet = useMemo(() => {
    return new Set(winningCoords.map((c) => `${c.c},${c.r}`));
  }, [winningCoords]);

  const destroyingSet = useMemo(() => {
    return new Set(destroyingCoords.map((c) => `${c.c},${c.r}`));
  }, [destroyingCoords]);

  const [showBigWin, setShowBigWin] = useState(false);
  const [bigWinUnits, setBigWinUnits] = useState("0.00");

  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0);
  const [freeGameOpen, setFreeGameOpen] = useState(false);
  const [freeGamePhase, setFreeGamePhase] = useState<"intro" | "done">("intro");
  const [freeGameRemaining, setFreeGameRemaining] = useState(0);
  const [freeGameTotalSpins, setFreeGameTotalSpins] = useState(0);
  const [freeGameTotalWinUnits, setFreeGameTotalWinUnits] = useState("0.00");
  const [showSpaceCardBonus, setShowSpaceCardBonus] = useState(false);
  const [spaceCardBonusText, setSpaceCardBonusText] = useState("");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  function initAudio() {
    if (!audioCtxRef.current) {
      const win = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const AudioContextCtor = window.AudioContext || win.webkitAudioContext;
      if (!AudioContextCtor) return;
      audioCtxRef.current = new AudioContextCtor();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
  }

  function playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1) {
    if (!soundEnabled) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function playSpinSound() {
    if (!soundEnabled) return;
    let i = 0;
    const interval = window.setInterval(() => {
      playTone(300 + Math.random() * 400, "sine", 0.1, 0.05);
      i++;
      if (i > 8) window.clearInterval(interval);
    }, 60);
  }

  function playWinSound() {
    playTone(440, "triangle", 0.2, 0.1);
    window.setTimeout(() => playTone(554, "triangle", 0.2, 0.1), 100);
    window.setTimeout(() => playTone(659, "triangle", 0.4, 0.1), 200);
  }

  function playCascadeSound() {
    playTone(800, "square", 0.1, 0.02);
    window.setTimeout(() => playTone(600, "square", 0.1, 0.02), 50);
  }

  useEffect(() => {
    const a = getFirebaseAuth();
    const unsub = onAuthStateChanged(a, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const currentUser = user;
    let cancelled = false;

    async function loadBalance() {
      const idToken = await currentUser.getIdToken();
      const res = await fetch("/api/balance", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok && typeof data?.balanceCents === "number") {
        setBalanceCents(data.balanceCents);
        if (typeof data?.freeSpins === "number") {
          setFreeSpinsLeft(data.freeSpins);
        }
      }
    }

    loadBalance();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Note: initial grid is created synchronously in state initializer (lint-friendly).

  async function spinOnce(mode: "paid" | "free") {
    if (!user) throw new Error("Not authenticated.");

    const idToken = await user.getIdToken();
    const bet = currentBet;
    const idempotencyKey = crypto.randomUUID();

    // Reset visuals for each spin.
    setWinningCoords([]);
    setDestroyingCoords([]);
    setIsFalling(false);
    setShowBigWin(false);
    setShowSpaceCardBonus(false);
    setSpaceCardBonusText("");
    setCurrentWinCents(0);
    setCurrentMultiplierIndex(0);

    if (mode === "paid") {
      // Optimistic UI: show the bet deduction immediately.
      setBalanceCents((prev) => prev - bet * 100);
    }

    initAudio();
    playSpinSound();

    const res = await fetch("/api/spin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ bet, idempotencyKey, mode }),
    });

    const data: SpinResponse & { error?: string } = await res
      .json()
      .catch(() => null);
    if (!res.ok || !data || data.error) {
      if (mode === "paid") setBalanceCents((prev) => prev + bet * 100);
      throw new Error(data?.error ?? "Spin failed");
    }

    // Bonus overlay (auto-open)
    if (data.specialCardDoubled) {
      setShowSpaceCardBonus(true);
      setSpaceCardBonusText("SPACE CARD x2");
      await sleep(900);
      setShowSpaceCardBonus(false);
    }

    setGrid(data.initialGrid);
    setIsFalling(true);
    await sleep(420);
    setIsFalling(false);

    let winAccum = 0;
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i]!;
      setCurrentMultiplierIndex(i);

      winAccum += step.payoutCents;
      setCurrentWinCents(winAccum);

      setWinningCoords(step.winningCoords);
      setDestroyingCoords([]);
      playWinSound();
      await sleep(800);

      setDestroyingCoords(step.winningCoords);
      setWinningCoords([]);
      playCascadeSound();
      await sleep(400);

      setGrid(step.gridAfter);
      setDestroyingCoords([]);
      await sleep(600);
    }

    if (winAccum > 0) {
      setBigWinUnits((winAccum / 100).toFixed(2));
      setShowBigWin(true);
      playWinSound();
      await sleep(1500);
      setShowBigWin(false);
    }

    // Server authoritative balance & free spins
    setBalanceCents(data.balanceCents);
    setFreeSpinsLeft(data.freeSpinsLeft);

    return data;
  }

  async function handleSpin() {
    if (!user) return;
    if (isSpinning) return;

    setIsSpinning(true);

    try {
      const paid = await spinOnce("paid");

      // Auto-play free spins if we awarded any on this paid spin.
      if (paid.freeSpinsAwarded > 0) {
        const sessionSpins = paid.freeSpinsAwarded;
        setFreeGameTotalSpins(sessionSpins);
        setFreeGameRemaining(sessionSpins);
        setFreeGameTotalWinUnits("0.00");
        setFreeGamePhase("intro");
        setFreeGameOpen(true);

        // small "intro" delay before starting free spins
        await sleep(1200);

        let sessionWinCents = 0;
        for (let i = 0; i < sessionSpins; i++) {
          const freeRes = await spinOnce("free");
          sessionWinCents += freeRes.totalWinCents;
          setFreeGameRemaining(sessionSpins - i - 1);
        }

        setFreeGameTotalWinUnits((sessionWinCents / 100).toFixed(2));
        setFreeGamePhase("done");
        await sleep(2200);
        setFreeGameOpen(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Spin failed";
      alert(msg);
    } finally {
      setIsSpinning(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
        <div className="text-center max-w-sm">
          <div className="title-font text-3xl tracking-widest uppercase mb-4">
            Super<span className="text-yellow-500">Ace</span>
          </div>
          <p className="text-sm text-gray-300 mb-6">
            Please log in to play and manage your wallet.
          </p>
          <a
            href="/login"
            className="inline-block rounded-md bg-yellow-500 text-black px-4 py-2 font-bold"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-dvh min-h-screen flex flex-col items-center justify-center bg-black overflow-hidden">
      {/* Simple top bar */}
      <div className="w-full max-w-md px-2 pt-2 pb-1 flex items-center justify-between gap-2 text-[11px] text-gray-300">
        <div className="flex items-center gap-2">
          <span className="title-font text-white tracking-widest uppercase">
            SuperAce
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div>
            Balance: <span className="text-yellow-400 font-mono">{formatUnitsFromCents(balanceCents)}</span>
          </div>
          <div>
            Free Spins:{" "}
            <span className="text-green-400 font-mono">{freeSpinsLeft}</span>
          </div>
          <button
            onClick={() => signOut(getFirebaseAuth())}
            className="rounded px-2 py-1 bg-gray-900 border border-gray-700 hover:bg-gray-800 text-[11px]"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile container */}
      <div className="relative w-full max-w-md h-[calc(100dvh-44px)] min-h-[620px] max-h-[900px] flex flex-col bg-gray-900 shadow-2xl overflow-hidden border-x border-gray-800">
        {/* HEADER */}
        <div className="header-bg flex flex-col items-center pt-4 pb-2 relative z-10">
          <h1 className="title-font text-4xl text-white tracking-widest uppercase mb-1 drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">
            Super<span className="text-yellow-500">Ace</span>
          </h1>

          {/* Multipliers */}
          <div className="bg-black/60 rounded-full px-8 py-2 border-b-2 border-white/20 flex space-x-6 items-center">
            {MULTIPLIERS.map((_, i) => {
              const active = i === currentMultiplierIndex;
              return (
                <span
                  key={i}
                  id={`mult-${i}`}
                  className={`title-font ${
                    active ? "text-3xl multiplier-active" : "text-2xl multiplier-inactive"
                  }`}
                >
                  x{MULTIPLIERS[i] ?? 1}
                </span>
              );
            })}
          </div>

          <div className="text-xs text-gray-300 mt-1 bg-black/40 px-3 py-1 rounded-md">
            Match from leftmost reel to win
          </div>
        </div>

        {/* GRID AREA */}
        <div className="flex-grow casino-bg flex items-center justify-center p-2 relative z-0">
          {/* Win overlay */}
          <div
            className={`absolute inset-0 z-20 pointer-events-none flex items-center justify-center transition-opacity duration-300 ${
              showBigWin ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="bg-black/70 text-yellow-400 font-bold text-5xl title-font px-8 py-4 rounded-xl border-4 border-yellow-500 shadow-[0_0_30px_#eab308]">
              WIN <span>{bigWinUnits}</span>
            </div>
          </div>

          {/* Space card bonus overlay */}
          <div
            className={`absolute inset-0 z-30 pointer-events-none flex items-center justify-center transition-opacity duration-300 ${
              showSpaceCardBonus ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="bg-black/70 text-yellow-300 font-bold text-4xl title-font px-8 py-4 rounded-xl border-4 border-yellow-300 shadow-[0_0_30px_#eab308]">
              {spaceCardBonusText}
            </div>
          </div>

          {/* Free game overlay (SCATTER bonus) */}
          <div
            className={`absolute inset-0 z-40 pointer-events-none flex items-center justify-center transition-opacity duration-300 ${
              freeGameOpen ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="bg-black/80 border border-yellow-500/50 rounded-xl px-6 py-5 text-center shadow-[0_0_30px_rgba(250,204,21,0.25)] w-[90%] max-w-sm">
              <div className="title-font text-yellow-300 tracking-widest uppercase text-3xl mb-2">
                {freeGamePhase === "intro" ? "FREE GAME" : "CONGRATS!"}
              </div>
              <div className="text-white font-bold text-sm mb-3">
                {freeGamePhase === "intro" ? (
                  <>
                    SCATTER BONUS
                    <div className="text-yellow-300 text-4xl mt-2">{freeGameTotalSpins}</div>
                    <div className="text-gray-300 text-xs mt-1">SPINS</div>
                  </>
                ) : (
                  <>
                    YOU HAVE WON
                    <div className="text-yellow-300 text-4xl mt-2">
                      {freeGameTotalWinUnits}
                    </div>
                    <div className="text-gray-300 text-xs mt-1">TOTAL</div>
                  </>
                )}
              </div>

              {freeGamePhase === "intro" ? (
                <div className="text-xs text-gray-200">
                  Remaining: <span className="font-bold text-yellow-300">{freeGameRemaining}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div
            id="slot-grid"
            className="grid grid-cols-5 gap-1 w-full h-[62%] min-h-[280px] max-h-[500px] p-1 bg-gradient-to-b from-gray-700 to-gray-900 rounded-sm border-2 border-gray-500 shadow-xl"
          >
            {grid.map((col, c) =>
              col.map((symbol, r) => {
                const ui = symbolUi[symbol];
                const coordKey = `${c},${r}`;
                const isWinning = winnerSet.has(coordKey);
                const isDestroying = destroyingSet.has(coordKey);
                return (
                  <div
                    key={`${c}-${r}`}
                    id={`card-${c}-${r}`}
                    style={isFalling ? { animationDelay: `${c * 0.05}s` } : undefined}
                    className={`slot-card relative w-full h-full rounded-md border-2 border-white/80 shadow-inner flex flex-col items-center justify-center overflow-hidden ${ui.bgClass} ${
                      isFalling ? "falling" : ""
                    } ${isDestroying ? "destroying" : ""} ${
                      isWinning && !isDestroying ? "winning" : ""
                    }`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent"></div>
                    {symbol === "A" ? (
                      <>
                        <span className={`absolute top-1 left-1 font-bold text-lg leading-none ${ui.colorClass}`}>
                          {ui.label}
                        </span>
                        <div className={`text-4xl ${ui.colorClass} drop-shadow-[0_0_2px_#eab308]`}>
                          {ui.char}
                        </div>
                        <span className="absolute bg-black text-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 -mt-1 shadow-md">
                          {ui.sub}
                        </span>
                      </>
                    ) : symbol === "X" ? (
                      <>
                        <Image
                          src="/SCATTER.png"
                          alt="SCATTER"
                          width={48}
                          height={48}
                          className="drop-shadow-[0_0_3px_rgba(250,204,21,0.4)]"
                        />
                        <span className="absolute bg-black/70 text-yellow-300 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 -mt-1 shadow-md">
                          {ui.sub}
                        </span>
                      </>
                    ) : (
                      <>
                        {ui.label ? (
                          <span className={`absolute top-1 left-1 font-bold text-lg leading-none ${ui.colorClass}`}>
                            {ui.label}
                          </span>
                        ) : null}
                        <div className={`text-4xl ${ui.colorClass}`}>{ui.char}</div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* FOOTER / CONTROLS */}
        <div className="footer-bg flex flex-col pt-2 pb-4 px-3 relative z-10">
          {/* Win Display Bar */}
          <div className="flex justify-center items-center mb-3">
            <div className="text-yellow-400 font-bold text-xl mr-2">WIN</div>
            <div className="bg-black/50 text-white font-mono text-xl px-4 py-1 rounded w-32 text-center border border-white/10">
              {currentWinCents > 0 ? formatWinFromCents(currentWinCents) : "0.000"}
            </div>
          </div>

          <div className="flex justify-between items-center px-1">
            {/* Sound toggle */}
            <button
              id="btn-sound"
              className="w-10 h-10 rounded-full bg-blue-900 border border-blue-700 flex justify-center items-center text-white shadow-inner active:scale-95 transition-colors"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) {
                  initAudio();
                  playTone(500, "sine", 0.08, 0.05);
                }
              }}
              type="button"
            >
              {soundEnabled ? "🔊" : "🔇"}
            </button>

            {/* Bet Control */}
            <div className="flex flex-col items-center">
              <div className="flex items-center space-x-1 bg-black/60 rounded-full p-1 border border-white/10">
                <button
                  id="btn-bet-down"
                  className="w-8 h-8 rounded-full bg-gradient-to-b from-red-600 to-red-800 text-white font-bold text-lg active:scale-90 shadow-md disabled:opacity-50"
                  onClick={() => setCurrentBetIndex((i) => Math.max(0, i - 1))}
                  disabled={isSpinning}
                  type="button"
                >
                  -
                </button>
                <div className="text-white font-mono text-lg w-10 text-center" id="bet-display">
                  {currentBet}
                </div>
                <button
                  id="btn-bet-up"
                  className="w-8 h-8 rounded-full bg-gradient-to-b from-green-600 to-green-800 text-white font-bold text-lg active:scale-90 shadow-md disabled:opacity-50"
                  onClick={() => setCurrentBetIndex((i) => Math.min(BET_STEPS.length - 1, i + 1))}
                  disabled={isSpinning}
                  type="button"
                >
                  +
                </button>
              </div>
              <div className="text-xs text-gray-400 mt-1">Bet</div>
            </div>

            {/* BIG SPIN BUTTON */}
            <button
              id="btn-spin"
              disabled={isSpinning}
              onClick={handleSpin}
              className="relative w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700 border-4 border-yellow-200 shadow-[0_5px_15px_rgba(0,0,0,0.5),_inset_0_2px_10px_rgba(255,255,255,0.8)] transform active:scale-95 transition flex items-center justify-center z-20 group disabled:opacity-50 disabled:active:scale-100"
              type="button"
            >
              <div
                id="spin-icon"
                className={`absolute inset-2 rounded-full border-4 border-dashed border-white/60 group-hover:border-white transition-colors flex items-center justify-center ${
                  isSpinning ? "spin-btn-active" : ""
                }`}
              >
                <svg className="w-8 h-8 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <span className="absolute text-yellow-900 font-bold title-font text-xl tracking-wider pointer-events-none drop-shadow-sm">
                JILI
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

