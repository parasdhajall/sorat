import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
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
      { title: "Sorat — Colourful Picture Card Game" },
      { name: "description", content: "Pick your lucky picture card in this colourful 12-card game. Play with free demo tokens." },
      { property: "og:title", content: "Sorat — Colourful Picture Card Game" },
      { property: "og:description", content: "Pick your lucky picture card in this colourful 12-card game." },
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
const BET_TIME = 60, SELECT_TIME = 5, RESULT_TIME = 4, PAYOUT = 10;
type Phase = "bet" | "select" | "result";

function Index() {
  const [phase, setPhase] = useState<Phase>("bet");
  const [t, setT] = useState(BET_TIME);
  const [stake, setStake] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [winner, setWinner] = useState<number | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [won, setWon] = useState(0);
  const [players, setPlayers] = useState(15);
  const [pool, setPool] = useState(128700);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    } catch {
      // Audio not permitted or failed
    }
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

  useEffect(() => {
    const id = setInterval(() => setT((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (t > 0) {
      if (phase === "bet" && t % 3 === 0) setPlayers((p) => Math.max(5, p + Math.floor(Math.random() * 7) - 2));

      // Audio countdown cues in final seconds
      if (phase === "bet" && t <= 5 && t > 0) {
        playBeep(880, 0.12, "sawtooth");
      }
      return;
    }

    if (phase === "bet") {
      setPhase("select");
      setT(SELECT_TIME);
      playBeep(520, 0.15, "triangle");
    } else if (phase === "select") {
      // Find the highest bet placed across all cards
      const betValues = Object.values(bets);
      const maxBet = betValues.length > 0 ? Math.max(...betValues, 0) : 0;

      let eligibleCards: number[];
      if (maxBet > 0) {
        // Strictly exclude card(s) that have the highest bet amount
        eligibleCards = Array.from({ length: 12 }, (_, i) => i).filter(
          (i) => (bets[i] ?? 0) < maxBet
        );
        // Fallback in the rare case that all 12 cards have the exact same bet
        if (eligibleCards.length === 0) {
          eligibleCards = Array.from({ length: 12 }, (_, i) => i);
        }
      } else {
        // No bets placed, any card can win
        eligibleCards = Array.from({ length: 12 }, (_, i) => i);
      }

      const w = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
      const prize = (bets[w] ?? 0) * PAYOUT;
      setWinner(w);
      setWon(prize);
      setBalance((b) => b + prize);
      setPhase("result");
      setT(RESULT_TIME);
      playVictoryFanfare();
    } else {
      setPhase("bet");
      setT(BET_TIME);
      setBets({});
      setWinner(null);
      setSpot(null);
      setPool(Math.floor(50000 + Math.random() * 150000) / 100 * 100);
    }
  }, [t, phase, bets, soundEnabled]);

  useEffect(() => {
    if (phase !== "select") return;
    const id = setInterval(() => {
      setSpot(Math.floor(Math.random() * 12));
      playBeep(580 + Math.random() * 200, 0.04, "sine");
    }, 120);
    return () => clearInterval(id);
  }, [phase, soundEnabled]);

  const place = (i: number) => {
    if (phase !== "bet" || balance < stake) return;
    setBalance((b) => b - stake);
    setBets((b) => ({ ...b, [i]: (b[i] ?? 0) + stake }));
    playBeep(700, 0.06, "sine");
  };

  const hurry = phase === "bet" && t <= 5;
  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
  const total = phase === "bet" ? BET_TIME : phase === "select" ? SELECT_TIME : RESULT_TIME;

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

          {/* Stake Selector */}
          <div>
            <div className="mb-1.5 flex justify-between items-center text-xs font-bold">
              <span className="tracking-wider uppercase text-muted-foreground">Stake:</span>
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
              <span>Bets: 🪙 {totalBet}</span>
              <span className="font-bold text-primary">Win pays {PAYOUT}x</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-1 text-[9px] text-center text-muted-foreground/60 uppercase tracking-widest border-t border-border/40">
          Big Screen TV Edition · 12 Cards
        </div>
      </aside>

      {/* ============================================================== */}
      {/* 12-CARD GAME ARENA GRID (Strictly 100% Screen Fitted, No Scroll)*/}
      {/* ============================================================== */}
      <section className="relative z-10 flex-1 h-full max-h-screen overflow-hidden p-2 sm:p-2.5 md:p-3 flex flex-col justify-between min-h-0">
        {/* Top Casino LED Marquee Light Ticker */}
        <div className="casino-marquee h-2 w-full shrink-0 rounded-full border border-amber-500/40 opacity-80 shadow-[0_0_10px_rgba(245,158,11,0.5)] mb-1.5" />

        {/* Picture Card Grid - 4 columns x 3 rows, flex-1 min-h-0 to fit exact screen */}
        <div className="grid flex-1 min-h-0 grid-cols-4 grid-rows-3 gap-2 sm:gap-2.5">
          {CARDS.map((c, i) => {
            const isLit = spot === i || winner === i;
            const hasBet = Boolean(bets[i]);

            return (
              <button
                key={i}
                onClick={() => place(i)}
                disabled={phase !== "bet"}
                className={`card-tile group relative overflow-hidden rounded-xl sm:rounded-2xl border text-left transition-all duration-200 select-none h-full w-full min-h-0 flex flex-col items-center justify-center p-1 ${
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
                  <span className="absolute right-1.5 top-1.5 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] sm:text-xs font-black text-primary-foreground shadow-gold flex items-center gap-1">
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

