import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    const id = setInterval(() => setT((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (t > 0) {
      if (phase === "bet" && t % 3 === 0) setPlayers((p) => Math.max(5, p + Math.floor(Math.random() * 7) - 2));
      return;
    }
    if (phase === "bet") { setPhase("select"); setT(SELECT_TIME); }
    else if (phase === "select") {
      const w = Math.floor(Math.random() * 12);
      const prize = (bets[w] ?? 0) * PAYOUT;
      setWinner(w); setWon(prize); setBalance((b) => b + prize);
      setPhase("result"); setT(RESULT_TIME);
    } else {
      setPhase("bet"); setT(BET_TIME); setBets({}); setWinner(null); setSpot(null);
      setPool(Math.floor(50000 + Math.random() * 150000) / 100 * 100);
    }
  }, [t, phase, bets]);

  useEffect(() => {
    if (phase !== "select") return;
    const id = setInterval(() => setSpot(Math.floor(Math.random() * 12)), 120);
    return () => clearInterval(id);
  }, [phase]);

  const place = (i: number) => {
    if (phase !== "bet" || balance < stake) return;
    setBalance((b) => b - stake);
    setBets((b) => ({ ...b, [i]: (b[i] ?? 0) + stake }));
  };
  const hurry = phase === "bet" && t <= 5;
  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
  const total = phase === "bet" ? BET_TIME : phase === "select" ? SELECT_TIME : RESULT_TIME;

  return (
    <main className="min-h-screen bg-background text-foreground md:flex">
      <aside className="w-full space-y-4 border-b border-border bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-80 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-gold font-display text-sm text-primary-foreground">S</div>
            <span className="font-display text-2xl italic tracking-wide">SORAT</span>
            <span className="flex items-center gap-1 text-[10px] font-bold text-destructive"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />LIVE</span>
          </div>
          <span className="rounded-md bg-muted px-3 py-1 text-sm font-bold">🪙 {balance}</span>
        </div>
        <span className="inline-block rounded bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">DEMO TOKENS</span>

        <div className={`rounded-xl border bg-card p-5 text-center ${hurry ? "border-primary shadow-gold" : "border-border"}`}>
          <div className="relative mx-auto h-14 w-14">
            <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" strokeLinecap="round"
                className={phase === "bet" && !hurry ? "stroke-success" : "stroke-primary"}
                strokeDasharray={`${(t / total) * 94} 94`} />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-sm font-bold">{t}s</span>
          </div>
          <p className="mt-3 text-sm font-extrabold tracking-wider">
            {phase === "bet" ? (hurry ? "⏳ HURRY UP" : "🟢 BETS OPEN") : phase === "select" ? "⚡ SELECTING SLOT" : "🏆 RESULT"}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {phase === "bet" ? (hurry ? "Time is running out" : "Place your tokens on any slot") : phase === "select" ? "Calculating result..." : "Next round soon"}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-card p-3 text-xs font-bold">
          <span>{players} PLAYERS</span>
          <span>POOL: ₹{pool.toLocaleString("en-IN")}</span>
        </div>

        <div>
          <div className="mb-2 flex justify-between text-sm font-bold"><span>STAKES:</span><span className="text-primary">🪙 {stake}</span></div>
          <div className="grid grid-cols-5 gap-2">
            {STAKES.map((s) => (
              <button key={s} onClick={() => setStake(s)}
                className={`rounded-lg py-2 text-sm font-bold transition ${s === stake ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
                {s}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Your bets this round: 🪙 {totalBet} · Win pays {PAYOUT}x</p>
        </div>
      </aside>

      <section className="grid flex-1 grid-cols-3 gap-3 p-3 sm:grid-cols-4">
        {CARDS.map((c, i) => {
          const lit = spot === i || winner === i;
          return (
            <button key={i} onClick={() => place(i)}
              className={`card-tile relative overflow-hidden rounded-xl text-left ${lit ? "ring-4 ring-primary scale-[1.02]" : ""} ${phase === "result" && winner !== i ? "opacity-50" : ""}`}>
              <img src={c.img} alt={c.name} width={816} height={816} loading="lazy" className="aspect-square w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent pb-1.5 pt-6 text-center text-sm font-bold">{c.name}</span>
              {bets[i] && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">🪙 {bets[i]}</span>}
            </button>
          );
        })}
      </section>

      {phase === "result" && winner !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border-2 border-primary bg-card p-8 text-center shadow-gold">
            <img src={CARDS[winner]!.img} alt="" className="mx-auto h-24 w-24 rounded-xl" />
            <p className="mt-4 text-xs font-extrabold tracking-[0.3em] text-primary">WINNING CARD</p>
            <p className="font-display text-4xl">{CARDS[winner]!.name}</p>
            <p className="mt-3 text-sm font-semibold text-muted-foreground">
              {totalBet === 0 ? "NO BETS PLACED THIS ROUND" : won > 0 ? `YOU WON 🪙 ${won}!` : "BETTER LUCK NEXT ROUND"}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
