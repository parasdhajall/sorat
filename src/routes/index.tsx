import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  TVHostSync,
  DEFAULT_ROOM_ID,
  GameMessage,
  getSynchronizedRoundState,
  BET_DURATION,
  SELECT_DURATION,
  RESULT_DURATION,
  ROUND_DURATION,
} from "@/lib/realtime";
import kite from "@/assets/kite.jpg";
import umbrella from "@/assets/umbrella.jpg";
import ball from "@/assets/ball.jpg";
import sun from "@/assets/sun.jpg";
import rose from "@/assets/rose.jpg";
import diya from "@/assets/diya.jpg";
import butterfly from "@/assets/butterfly.jpg";
import sparrow from "@/assets/sparrow.jpg";
import rabbit from "@/assets/rabbit.jpg";
import top from "@/assets/top.jpg";
import bucket from "@/assets/bucket.jpg";
import cow from "@/assets/cow.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sorat — Live TV Arena Display" },
      { name: "description", content: "Colourful 12-picture Sorat live game board." },
      { property: "og:title", content: "Sorat — Live TV Arena Display" },
      { property: "og:description", content: "Colourful 12-picture Sorat live game board." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CARDS = [
  { name: "पतंग", img: kite }, { name: "छत्री", img: umbrella }, { name: "बॉल", img: ball },
  { name: "सूर्य", img: sun }, { name: "गुलाब", img: rose }, { name: "दिवा", img: diya },
  { name: "फुलपाखरू", img: butterfly }, { name: "चिमणी", img: sparrow }, { name: "ससा", img: rabbit },
  { name: "भोवरा", img: top }, { name: "बादली", img: bucket }, { name: "गाय", img: cow },
];
const STAKES = [10, 15, 25, 50, 70];
const PAYOUT = 10;
type Phase = "bet" | "select" | "result";

function Index() {
  const initialSync = getSynchronizedRoundState();
  const [roundNumber, setRoundNumber] = useState(initialSync.roundNumber);
  const [roundId, setRoundId] = useState(initialSync.roundId);
  const [phase, setPhase] = useState<Phase>(initialSync.phase);
  const [t, setT] = useState(initialSync.timeLeft);
  const [stake, setStake] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [winner, setWinner] = useState<number | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [won, setWon] = useState(0);
  const [players, setPlayers] = useState(15);
  const [pool, setPool] = useState(128700);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);

  // Round tracking references
  const lastProcessedRoundRef = useRef<number>(initialSync.roundNumber);
  const lastDecidedWinnerRoundRef = useRef<number | null>(null);
  const forcedWinnerRef = useRef<number | null>(null);

  // Realtime TV-Phone sync state
  const [counterConnected, setCounterConnected] = useState(false);
  const [strategy, setStrategy] = useState<"house_profit" | "player_win" | "manual">("house_profit");
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);
  const hostSyncRef = useRef<TVHostSync | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize Audio Context on user interaction
  const getAudioContext = () => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playBeep = (freq = 440, duration = 0.08, type: OscillatorType = "sine") => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {}
  };

  const playVictoryFanfare = () => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const now = ctx.currentTime + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      });
    } catch {}
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      getAudioContext();
      playBeep(660, 0.1, "sine");
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Initialize WebRTC Host sync for Mobile Operator Counter
  useEffect(() => {
    const host = new TVHostSync(DEFAULT_ROOM_ID);
    hostSyncRef.current = host;

    host.onStatusChange = (status) => {
      setCounterConnected(status === "connected");
    };

    host.onMessage = (msg: GameMessage) => {
      if (msg.type === "ADD_BET") {
        setBets((prev) => ({
          ...prev,
          [msg.card]: (prev[msg.card] ?? 0) + msg.amount,
        }));
        setPool((p) => p + msg.amount);
        playBeep(720, 0.07, "sine");
      } else if (msg.type === "SUB_BET") {
        setBets((prev) => ({
          ...prev,
          [msg.card]: Math.max(0, (prev[msg.card] ?? 0) - msg.amount),
        }));
      } else if (msg.type === "CLEAR_CARD") {
        setBets((prev) => {
          const next = { ...prev };
          delete next[msg.card];
          return next;
        });
      } else if (msg.type === "CLEAR_ALL_BETS") {
        setBets({});
      } else if (msg.type === "SET_STRATEGY") {
        setStrategy(msg.mode);
      } else if (msg.type === "FORCE_WINNER") {
        forcedWinnerRef.current = msg.card;
        setForcedWinner(msg.card);
        if (msg.card !== null && msg.card >= 0 && msg.card < 12) {
          setStrategy("manual");
          // Only update visible winner if already in result phase!
          // During betting phase, keep winner strictly hidden so users see ZERO highlight.
          if (phase === "result") {
            setWinner(msg.card);
            const prize = (bets[msg.card] ?? 0) * PAYOUT;
            setWon(prize);
          }
        }
      } else if (msg.type === "TRIGGER_SPIN") {
        setPhase("select");
        playBeep(520, 0.15, "triangle");
      } else if (msg.type === "REQUEST_SYNC") {
        hostSyncRef.current?.broadcast({
          type: "SYNC_FROM_TV",
          roundNumber: lastProcessedRoundRef.current,
          roundId: `#${String(lastProcessedRoundRef.current).padStart(4, "0")}`,
          phase,
          t,
          bets,
          pool,
          winner,
          strategy,
          forcedWinner,
        });
      }
    };

    host.start();

    return () => {
      host.destroy();
    };
  }, []);

  // Broadcast TV State to Admin Phone whenever key properties change
  useEffect(() => {
    hostSyncRef.current?.broadcast({
      type: "SYNC_FROM_TV",
      roundNumber,
      roundId,
      phase,
      t,
      bets,
      pool,
      winner,
      strategy,
      forcedWinner,
    });
  }, [roundNumber, roundId, t, phase, bets, pool, winner, strategy, forcedWinner]);

  // Global Synchronized Clock Ticker
  useEffect(() => {
    const updateTick = () => {
      const sync = getSynchronizedRoundState();
      setT(sync.timeLeft);
      setPhase(sync.phase);

      // Handle Round rollover (new round starts every 60 seconds)
      if (sync.roundNumber !== lastProcessedRoundRef.current) {
        lastProcessedRoundRef.current = sync.roundNumber;
        setRoundNumber(sync.roundNumber);
        setRoundId(sync.roundId);
        setBets({});
        setWinner(null);
        setSpot(null);
        // Clear forced winner for the new round
        forcedWinnerRef.current = null;
        setForcedWinner(null);
        setWon(0);
        lastDecidedWinnerRoundRef.current = null;
        setPool(Math.floor(50000 + Math.random() * 150000) / 100 * 100);
      }

      // Dynamic player count fluctuation
      if (sync.phase === "bet" && sync.timeLeft % 3 === 0) {
        setPlayers((p) => Math.max(8, p + Math.floor(Math.random() * 5) - 2));
      }

      // Audio countdown cues in final 5 seconds of bet phase
      if (sync.phase === "bet" && sync.timeLeft <= 5 && sync.timeLeft > 0) {
        playBeep(880, 0.12, "sawtooth");
      }
    };

    updateTick();
    const id = setInterval(updateTick, 250);
    return () => clearInterval(id);
  }, [soundEnabled]);

  // Determine winner ONCE when phase enters "select"
  useEffect(() => {
    if (phase === "select" && lastDecidedWinnerRoundRef.current !== roundNumber) {
      lastDecidedWinnerRoundRef.current = roundNumber;

      let w: number;
      const adminPick = forcedWinnerRef.current !== null ? forcedWinnerRef.current : forcedWinner;

      // 👑 ADMIN SELECTED WINNER - 100% UNCONDITIONAL GUARANTEE
      if (adminPick !== null && adminPick >= 0 && adminPick < 12) {
        w = adminPick;
      } else if (strategy === "player_win") {
        // Player retention: pick among cards with smaller bets
        const cardsWithBets = Object.entries(bets)
          .map(([card, amt]) => ({ card: Number(card), amt: Number(amt) }))
          .filter((c) => c.amt > 0);

        if (cardsWithBets.length > 0) {
          const minBet = Math.min(...cardsWithBets.map((c) => c.amt));
          const candidates = cardsWithBets.filter((c) => c.amt === minBet).map((c) => c.card);
          w = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
          w = Math.floor(Math.random() * 12);
        }
      } else {
        // Maximum House Profit Mode (Default):
        // 1. If any cards have 0 bet, ALWAYS pick from 0-bet cards (100% house profit!)
        const zeroBetCards = Array.from({ length: 12 }, (_, i) => i).filter((i) => (bets[i] ?? 0) === 0);
        if (zeroBetCards.length > 0) {
          w = zeroBetCards[Math.floor(Math.random() * zeroBetCards.length)];
        } else {
          // 2. Lowest bet card
          const minBet = Math.min(...Object.values(bets));
          const minCards = Array.from({ length: 12 }, (_, i) => i).filter((i) => (bets[i] ?? 0) === minBet);
          w = minCards[Math.floor(Math.random() * minCards.length)];
        }
      }

      const prize = (bets[w] ?? 0) * PAYOUT;
      setWinner(w);
      setWon(prize);
      if (prize > 0) setBalance((b) => b + prize);
      playVictoryFanfare();
    }
  }, [phase, roundNumber, strategy, forcedWinner, bets, soundEnabled]);

  // Spinning spotlight animation during "select" phase
  useEffect(() => {
    if (phase !== "select") return;
    const adminPick = forcedWinnerRef.current !== null ? forcedWinnerRef.current : forcedWinner;
    const id = setInterval(() => {
      setSpot(Math.floor(Math.random() * 12));
      playBeep(580 + Math.random() * 200, 0.04, "sine");
    }, 120);
    return () => {
      clearInterval(id);
      if (adminPick !== null) setSpot(adminPick);
    };
  }, [phase, soundEnabled, forcedWinner]);

  // User places bet by clicking cards
  const place = (i: number) => {
    if (phase !== "bet" || balance < stake) return;
    setBalance((b) => b - stake);
    const newBets = { ...bets, [i]: (bets[i] ?? 0) + stake };
    setBets(newBets);
    setPool((p) => p + stake);
    playBeep(720, 0.06, "sine");

    // Immediately push update to Admin
    hostSyncRef.current?.broadcast({
      type: "SYNC_FROM_TV",
      roundNumber,
      roundId,
      phase,
      t,
      bets: newBets,
      pool: pool + stake,
      winner,
      strategy,
      forcedWinner,
    });
  };

  const hurry = phase === "bet" && t <= 5;
  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
  const total = phase === "bet" ? BET_DURATION : phase === "select" ? SELECT_DURATION : RESULT_DURATION;

  return (
    <main
      className={`relative h-screen max-h-screen w-full overflow-hidden bg-background text-foreground flex flex-col md:flex-row ${
        hurry ? "shadow-[inset_0_0_90px_rgba(239,68,68,0.35)]" : ""
      }`}
    >
      {/* ============================================================== */}
      {/* BIG SCREEN AMBIENT LIGHTING & DYNAMIC EFFECTS LAYER            */}
      {/* ============================================================== */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        {/* Floating Ambient Glowing Light Orbs */}
        <div className="ambient-orb-1 absolute -top-24 -left-24 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-amber-500/20 via-yellow-600/10 to-transparent blur-[120px]" />
        <div className="ambient-orb-2 absolute top-1/3 -right-32 h-[580px] w-[580px] rounded-full bg-gradient-to-tl from-indigo-500/20 via-purple-600/10 to-transparent blur-[140px]" />
        <div className="ambient-orb-3 absolute -bottom-24 left-1/4 h-[480px] w-[480px] rounded-full bg-gradient-to-tr from-emerald-500/15 via-teal-600/10 to-transparent blur-[130px]" />

        {/* Urgent Alarm Lighting - Activates in Last 5 Seconds of Timer */}
        {hurry && (
          <div className="urgent-alarm-glow fixed inset-0 bg-gradient-to-b from-red-600/15 via-amber-600/10 to-red-950/20" />
        )}

        {/* Slot Selection Laser Beam Sweeper */}
        {phase === "select" && (
          <div className="laser-sweep-beam absolute -top-[50%] -left-[50%] h-[200%] w-[200%] bg-[conic-gradient(from_0deg_at_50%_50%,rgba(245,158,11,0.18)_0deg,transparent_60deg,transparent_360deg)]" />
        )}

        {/* Victory Burst Aura */}
        {phase === "result" && (
          <div className="victory-glow-burst fixed inset-0 bg-radial from-amber-400/25 via-primary/10 to-transparent" />
        )}
      </div>

      {/* ============================================================== */}
      {/* SIDEBAR CONTROL & LIVE STATS PANEL (Fits strictly in height)   */}
      {/* ============================================================== */}
      <aside className="relative z-10 w-full md:w-72 lg:w-80 h-auto md:h-screen md:max-h-screen overflow-hidden border-b border-border/70 bg-sidebar/95 backdrop-blur-md p-3 md:p-3.5 md:border-b-0 md:border-r shadow-2xl flex flex-col justify-between shrink-0">
        <div className="space-y-2.5">
          {/* Top Brand Header & Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-gold font-display text-sm text-primary-foreground shadow-gold">
                S
              </div>
              <div>
                <span className="font-display text-xl italic tracking-wider block leading-none">SORAT</span>
                <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-destructive">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive shadow-[0_0_8px_#ef4444]" />
                  LIVE ARENA
                </span>
              </div>
            </div>

            {/* Big Screen Quick Actions: Sound & Fullscreen */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleSound}
                title={soundEnabled ? "Mute Sound" : "Enable Sound FX"}
                className={`p-1.5 rounded-lg text-xs font-bold transition border ${
                  soundEnabled ? "bg-primary/20 border-primary text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {soundEnabled ? "🔊" : "🔇"}
              </button>
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (Big Screen TV Mode)"}
                className="p-1.5 rounded-lg text-xs font-bold transition border bg-muted border-border text-muted-foreground hover:text-foreground"
              >
                {isFullscreen ? "🗗" : "⛶"}
              </button>
            </div>
          </div>

          {/* Balance & Token Status */}
          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-card/80 px-3 py-2 shadow-sm">
            <div className="space-y-0.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Balance</span>
              <div className="text-base font-display text-primary flex items-center gap-1 leading-none">
                <span>🪙</span> {balance.toLocaleString("en-IN")}
              </div>
            </div>
            <span className="rounded-full bg-success/20 border border-success/40 px-2 py-0.5 text-[10px] font-extrabold text-success tracking-wide">
              DEMO TOKENS
            </span>
          </div>

          {/* Animated Big-Screen Countdown Gauge */}
          <div
            className={`relative overflow-hidden rounded-xl border p-2.5 text-center transition-all duration-300 ${
              hurry
                ? "border-destructive bg-destructive/10 shadow-[0_0_25px_rgba(239,68,68,0.35)]"
                : phase === "select"
                ? "border-primary bg-primary/10 shadow-gold"
                : "border-border bg-card/90 shadow-md"
            }`}
          >
            {/* Round Badge Indicator */}
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 border border-primary/50 px-2 py-0.5 text-[11px] font-mono font-black text-primary shadow-sm tracking-wider">
                🎰 ROUND {roundId}
              </span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {phase === "bet" ? (hurry ? "CLOSING" : "BETS OPEN") : phase === "select" ? "SPINNING" : "RESULT"}
              </span>
            </div>

            {/* Ambient Timer Glow Effect */}
            <div
              className={`relative mx-auto h-14 w-14 rounded-full flex items-center justify-center ${
                hurry ? "timer-glow-urgent" : "timer-glow-normal"
              }`}
            >
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted/40" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className={
                    hurry
                      ? "stroke-destructive transition-all duration-300"
                      : phase === "bet"
                      ? "stroke-primary transition-all duration-300"
                      : "stroke-yellow-400 animate-spin"
                  }
                  strokeDasharray={`${(t / total) * 94} 94`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-display text-lg font-extrabold tracking-tight ${hurry ? "text-destructive scale-110" : "text-foreground"}`}>
                  {t}s
                </span>
              </div>
            </div>

            {/* Dynamic Status Badges */}
            <p className={`mt-1.5 text-xs font-extrabold tracking-wider ${hurry ? "text-destructive animate-pulse" : "text-foreground"}`}>
              {phase === "bet"
                ? hurry
                  ? "⏳ HURRY UP! CLOSING"
                  : "🟢 BETS OPEN"
                : phase === "select"
                ? "⚡ SELECTING LUCKY CARD"
                : "🏆 WINNER ANNOUNCED"}
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {phase === "bet"
                ? hurry
                  ? "Time is running out!"
                  : "Pick cards & test your luck"
                : phase === "select"
                ? "Wheel is spinning..."
                : "Next round soon"}
            </p>
          </div>

          {/* Live Arena Metrics */}
          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-card/70 px-2.5 py-1.5 text-[11px] font-bold">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {players} PLAYERS
            </span>
            <span className="text-primary font-display tracking-wide">POOL: ₹{pool.toLocaleString("en-IN")}</span>
          </div>

          {/* User Stake Selector */}
          <div>
            <div className="mb-1.5 flex justify-between items-center text-xs font-bold">
              <span className="tracking-wider uppercase text-muted-foreground">Select Stake:</span>
              <span className="text-primary font-display text-sm">🪙 {stake}</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {STAKES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStake(s);
                    playBeep(480, 0.05, "sine");
                  }}
                  className={`rounded-lg py-1.5 text-xs font-extrabold transition shadow-sm ${
                    s === stake
                      ? "bg-primary text-primary-foreground shadow-gold ring-2 ring-primary/50"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
              <span>Your bets: 🪙 {totalBet}</span>
              <span className="font-bold text-primary">Win pays {PAYOUT}x</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-1 text-[9px] text-center text-muted-foreground/60 uppercase tracking-widest border-t border-border/40">
          Click any card to place bet · 12 Picture Cards
        </div>
      </aside>

      {/* ============================================================== */}
      {/* 12-CARD GAME ARENA GRID (User Clicks to Bet)                   */}
      {/* ============================================================== */}
      <section className="relative z-10 flex-1 h-full max-h-screen overflow-hidden p-2 sm:p-2.5 md:p-3 flex flex-col justify-between min-h-0">
        {/* Top Arena Live Status Bar */}
        <div className="flex items-center justify-between px-2.5 py-1 rounded-xl bg-card/85 border border-border/80 shadow-sm shrink-0 mb-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-primary text-primary-foreground font-mono font-black text-xs sm:text-sm shadow-gold tracking-wider">
              <span>🎰</span> ROUND {roundId}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-black tracking-wide ${
                hurry
                  ? "bg-destructive/20 text-destructive border border-destructive/40 animate-pulse"
                  : phase === "bet"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : phase === "select"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse"
                  : "bg-purple-500/20 text-purple-400 border border-purple-500/40"
              }`}
            >
              {phase === "bet" ? `⏳ ${t}s BETS OPEN` : phase === "select" ? `⚡ ${t}s WHEEL SPINNING` : `🏆 ${t}s WINNER`}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground text-[10px] sm:text-xs font-bold">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {players} LIVE
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="text-primary font-display font-extrabold tracking-wide">
              POOL: ₹{pool.toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        {/* Top Casino LED Marquee Light Ticker */}
        <div className="casino-marquee h-1.5 w-full shrink-0 rounded-full border border-amber-500/40 opacity-80 shadow-[0_0_10px_rgba(245,158,11,0.5)] mb-1" />

        {/* Picture Card Grid - 4 columns x 3 rows, flex-1 min-h-0 to fit exact screen */}
        <div className="grid flex-1 min-h-0 grid-cols-4 grid-rows-3 gap-2 sm:gap-2.5">
          {CARDS.map((c, i) => {
            const isLit = (phase === "select" && spot === i) || (phase === "result" && winner === i);
            const hasBet = Boolean(bets[i]);

            return (
              <button
                key={i}
                onClick={() => place(i)}
                disabled={phase !== "bet"}
                className={`card-tile group relative overflow-hidden rounded-xl sm:rounded-2xl border text-left transition-all duration-200 select-none h-full w-full min-h-0 flex flex-col items-center justify-center p-1 active:scale-95 ${
                  isLit
                    ? "ring-4 ring-primary shadow-[0_0_35px_rgba(245,158,11,0.85)] scale-[1.02] z-20 border-primary"
                    : hasBet
                    ? "border-primary/80 ring-2 ring-primary/40 shadow-[0_0_15px_rgba(245,158,11,0.25)] bg-card"
                    : "border-border/80 bg-card hover:border-primary/50"
                } ${phase === "result" && winner !== i ? "opacity-35 grayscale-[20%]" : ""}`}
              >
                {/* Card Picture - Perfectly contained to never exceed row height */}
                <img
                  src={c.img}
                  alt={c.name}
                  loading="lazy"
                  className="h-full w-full object-contain max-h-[calc(100%-1.35rem)] transition-transform duration-300 group-hover:scale-105 pointer-events-none"
                />

                {/* Marathi Label Overlay */}
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/85 to-transparent pb-0.5 pt-2 text-center pointer-events-none">
                  <span className="font-display text-xs sm:text-sm md:text-base tracking-wide font-extrabold text-foreground drop-shadow-md">
                    {c.name}
                  </span>
                </div>

                {/* Bet Badge */}
                {hasBet && (
                  <span className="absolute right-1.5 top-1.5 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] sm:text-xs font-black text-primary-foreground shadow-gold flex items-center gap-1 animate-bounce-short">
                    <span>🪙</span> {bets[i]}
                  </span>
                )}

                {/* Selection Spotlight Flash Indicator */}
                {spot === i && (
                  <div className="absolute inset-0 z-30 bg-primary/25 pointer-events-none animate-pulse" />
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom Casino LED Marquee Light Ticker */}
        <div className="casino-marquee h-2 w-full shrink-0 rounded-full border border-amber-500/40 opacity-80 shadow-[0_0_10px_rgba(245,158,11,0.5)] mt-1.5" />
      </section>

      {/* ============================================================== */}
      {/* WINNER CELEBRATION MODAL                                       */}
      {/* ============================================================== */}
      {phase === "result" && winner !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-sm rounded-3xl border-2 border-primary bg-card/95 p-6 text-center shadow-[0_0_80px_rgba(245,158,11,0.6)]">
            {/* Victory Ambient Glow Ring */}
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500 opacity-30 blur-xl animate-pulse" />

            <div className="relative z-10">
              <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-2xl border-2 border-primary shadow-gold">
                <img src={CARDS[winner]!.img} alt="" className="h-full w-full object-cover" />
              </div>

              <p className="mt-3 text-[11px] font-black tracking-[0.3em] text-primary uppercase">
                WINNING PICTURE
              </p>
              <p className="font-display text-3xl font-extrabold mt-1 text-foreground drop-shadow-lg">
                {CARDS[winner]!.name}
              </p>

              <div className="mt-3 rounded-xl bg-background/80 border border-border p-2.5">
                <p className="text-xs font-bold tracking-wide">
                  {totalBet === 0 ? (
                    <span className="text-muted-foreground">NO BETS PLACED THIS ROUND</span>
                  ) : won > 0 ? (
                    <span className="text-success text-sm font-extrabold flex items-center justify-center gap-1.5">
                      🎉 YOU WON 🪙 {won.toLocaleString("en-IN")}!
                    </span>
                  ) : (
                    <span className="text-destructive font-bold">BETTER LUCK NEXT ROUND</span>
                  )}
                </p>
              </div>

              <p className="mt-2.5 text-[10px] text-muted-foreground uppercase tracking-widest">
                Starting next round in {t}s...
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

