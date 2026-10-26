import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { AdminClientSync, DEFAULT_ROOM_ID, GameMessage } from "@/lib/realtime";
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

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Sorat — Operator Counter Panel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

const CARDS = [
  { name: "पतंग", img: kite },
  { name: "छत्री", img: umbrella },
  { name: "बॉल", img: ball },
  { name: "सूर्य", img: sun },
  { name: "गुलाब", img: rose },
  { name: "दिवा", img: diya },
  { name: "फुलपाखरू", img: butterfly },
  { name: "चिमणी", img: sparrow },
  { name: "ससा", img: rabbit },
  { name: "भोवरा", img: top },
  { name: "बादली", img: bucket },
  { name: "गाय", img: cow },
];

const STAKE_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000];
const MASTER_PIN = "1234";
const PAYOUT_MULTIPLIER = 10;

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [selectedStake, setSelectedStake] = useState(50);

  // Synced state from TV
  const [phase, setPhase] = useState<"bet" | "select" | "result">("bet");
  const [timer, setTimer] = useState(60);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [lastWinner, setLastWinner] = useState<number | null>(null);

  // Strategy control
  const [strategy, setStrategy] = useState<"house_profit" | "player_win" | "manual">("house_profit");
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);

  const clientSyncRef = useRef<AdminClientSync | null>(null);

  // Check stored auth
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("sorat_admin_auth");
      if (stored === "true") setIsAuthenticated(true);
    }
  }, []);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === MASTER_PIN) {
      setIsAuthenticated(true);
      sessionStorage.setItem("sorat_admin_auth", "true");
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  // Connect to TV
  useEffect(() => {
    if (!isAuthenticated) return;

    const client = new AdminClientSync(roomId);
    clientSyncRef.current = client;

    client.onStatusChange = (status) => {
      setConnectionStatus(status);
    };

    client.onMessage = (msg: GameMessage) => {
      if (msg.type === "SYNC_FROM_TV") {
        setPhase(msg.phase);
        setTimer(msg.t);
        setBets(msg.bets || {});
        if (msg.winner !== null) setLastWinner(msg.winner);
        setStrategy(msg.strategy || "house_profit");
        setForcedWinner(msg.forcedWinner);
      }
    };

    client.connect();

    return () => {
      client.destroy();
    };
  }, [isAuthenticated, roomId]);

  // Actions
  const handleAddBet = (cardIdx: number) => {
    clientSyncRef.current?.send({
      type: "ADD_BET",
      card: cardIdx,
      amount: selectedStake,
    });
    // Optimistic update
    setBets((prev) => ({
      ...prev,
      [cardIdx]: (prev[cardIdx] ?? 0) + selectedStake,
    }));
  };

  const handleSubBet = (e: React.MouseEvent, cardIdx: number) => {
    e.stopPropagation();
    clientSyncRef.current?.send({
      type: "SUB_BET",
      card: cardIdx,
      amount: selectedStake,
    });
    setBets((prev) => ({
      ...prev,
      [cardIdx]: Math.max(0, (prev[cardIdx] ?? 0) - selectedStake),
    }));
  };

  const handleClearCard = (e: React.MouseEvent, cardIdx: number) => {
    e.stopPropagation();
    clientSyncRef.current?.send({
      type: "CLEAR_CARD",
      card: cardIdx,
    });
    setBets((prev) => {
      const next = { ...prev };
      delete next[cardIdx];
      return next;
    });
  };

  const handleClearAll = () => {
    if (confirm("Round ke saare bets clear karne hain?")) {
      clientSyncRef.current?.send({ type: "CLEAR_ALL_BETS" });
      setBets({});
    }
  };

  const handleSetStrategy = (mode: "house_profit" | "player_win" | "manual") => {
    setStrategy(mode);
    clientSyncRef.current?.send({ type: "SET_STRATEGY", mode });
  };

  const handleForceWinner = (cardIdx: number) => {
    const next = forcedWinner === cardIdx ? null : cardIdx;
    setForcedWinner(next);
    if (next !== null) setStrategy("manual");
    clientSyncRef.current?.send({ type: "FORCE_WINNER", card: next });
  };

  const handleTriggerSpin = () => {
    clientSyncRef.current?.send({ type: "TRIGGER_SPIN" });
  };

  const totalCollection = Object.values(bets).reduce((a, b) => a + b, 0);

  // Authentication Lock Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-gold grid place-items-center text-primary-foreground font-display text-xl mb-4">
            🔒
          </div>
          <h1 className="font-display text-2xl">Operator Counter Login</h1>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            Booking Clerk / Admin Master PIN enter karein
          </p>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="Enter PIN (Default: 1234)"
              autoFocus
              className="w-full text-center text-2xl tracking-[0.5em] font-mono py-3 rounded-xl border border-input bg-background focus:border-primary focus:outline-none"
            />
            {pinError && <p className="text-xs text-destructive font-bold">Galat PIN! Dubara koshish karein.</p>}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-display text-base font-bold transition hover:opacity-90 shadow-gold"
            >
              UNLOCK COUNTER
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 select-none">
      {/* ============================================================== */}
      {/* TOP STATUS HEADER                                              */}
      {/* ============================================================== */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md px-3 py-2.5 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg tracking-wide text-primary">SORAT COUNTER</span>
            <span
              className={`flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                connectionStatus === "connected"
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                  : "bg-amber-500/10 border-amber-500/40 text-amber-400 animate-pulse"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connectionStatus === "connected" ? "TV CONNECTED" : "CONNECTING TO TV..."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold px-2 py-1 rounded bg-muted">
              {phase === "bet" ? `⏳ ${timer}s` : phase === "select" ? "⚡ SPINNING" : "🏆 RESULT"}
            </span>
            <button
              onClick={() => {
                sessionStorage.removeItem("sorat_admin_auth");
                setIsAuthenticated(false);
              }}
              title="Logout"
              className="p-1 text-muted-foreground hover:text-foreground text-xs"
            >
              🔒
            </button>
          </div>
        </div>

        {/* Financial Metrics Summary Banner */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border border-border bg-background p-2">
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">Round Collection</span>
            <span className="text-xl font-display text-primary font-black">₹{totalCollection.toLocaleString("en-IN")}</span>
          </div>
          <div className="rounded-xl border border-border bg-background p-2 flex flex-col justify-center items-center">
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">House Target</span>
            <span className="text-xs font-extrabold text-emerald-400 flex items-center gap-1">
              {strategy === "house_profit" ? "🛡️ 100% PROFIT LOCK" : strategy === "player_win" ? "🎁 RETENTION PAYOUT" : `👑 FORCED: ${forcedWinner !== null ? CARDS[forcedWinner]?.name : "NONE"}`}
            </span>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* STRATEGY SELECTION TABS                                        */}
      {/* ============================================================== */}
      <section className="p-3 bg-muted/40 border-b border-border">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground block mb-1.5">
          House Winning Strategy:
        </span>
        <div className="grid grid-cols-3 gap-1.5 text-xs font-bold">
          <button
            onClick={() => handleSetStrategy("house_profit")}
            className={`py-2 px-1 rounded-lg border text-center transition ${
              strategy === "house_profit"
                ? "bg-emerald-600 text-white border-emerald-400 shadow-md"
                : "bg-card border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            🛡️ Max Profit
          </button>
          <button
            onClick={() => handleSetStrategy("player_win")}
            className={`py-2 px-1 rounded-lg border text-center transition ${
              strategy === "player_win"
                ? "bg-amber-600 text-white border-amber-400 shadow-md"
                : "bg-card border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            🎁 Player Win
          </button>
          <button
            onClick={() => handleSetStrategy("manual")}
            className={`py-2 px-1 rounded-lg border text-center transition ${
              strategy === "manual"
                ? "bg-purple-600 text-white border-purple-400 shadow-md"
                : "bg-card border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            👑 Manual Pick
          </button>
        </div>
      </section>

      {/* ============================================================== */}
      {/* QUICK STAKE SELECTOR KEYPAD                                    */}
      {/* ============================================================== */}
      <section className="p-3 bg-card border-b border-border">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
            Tap Stake to Book:
          </span>
          <span className="text-xs font-bold text-primary">Selected: ₹{selectedStake}</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STAKE_AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={() => setSelectedStake(amt)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-extrabold transition border ${
                selectedStake === amt
                  ? "bg-primary text-primary-foreground border-primary shadow-gold scale-105"
                  : "bg-muted border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              ₹{amt}
            </button>
          ))}
        </div>
      </section>

      {/* ============================================================== */}
      {/* 12-CARD FAST BOOKING GRID                                      */}
      {/* ============================================================== */}
      <main className="p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {CARDS.map((c, i) => {
            const betAmount = bets[i] ?? 0;
            const payout = betAmount * PAYOUT_MULTIPLIER;
            const netProfit = totalCollection - payout;
            const isForced = forcedWinner === i;

            return (
              <div
                key={i}
                onClick={() => handleAddBet(i)}
                className={`relative rounded-xl border p-2.5 transition active:scale-95 cursor-pointer flex flex-col justify-between ${
                  isForced
                    ? "border-purple-500 bg-purple-500/15 ring-2 ring-purple-400"
                    : betAmount > 0
                    ? "border-primary/80 bg-primary/10 shadow-sm"
                    : "border-border bg-card hover:border-border/80"
                }`}
              >
                {/* Header row of card tile */}
                <div className="flex items-center justify-between mb-1">
                  <span className="font-display text-sm font-extrabold text-foreground">{c.name}</span>
                  {strategy === "manual" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleForceWinner(i);
                      }}
                      title="Force this card as Winner"
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isForced ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isForced ? "FORCED 👑" : "PICK"}
                    </button>
                  )}
                </div>

                {/* Card Image Thumbnail + Details */}
                <div className="flex items-center gap-2 my-1">
                  <img src={c.img} alt={c.name} className="h-11 w-11 rounded-lg object-cover border border-border shrink-0" />
                  <div className="flex-1 min-w-0 leading-tight">
                    <span className="text-[10px] text-muted-foreground uppercase block">Booked:</span>
                    <span className={`text-base font-display font-extrabold ${betAmount > 0 ? "text-primary" : "text-muted-foreground/60"}`}>
                      ₹{betAmount}
                    </span>
                  </div>
                </div>

                {/* Financial P&L for this card */}
                <div className="mt-1 pt-1 border-t border-border/50 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">P&L:</span>
                  <span
                    className={`font-bold font-mono ${
                      netProfit > 0 ? "text-emerald-400" : netProfit < 0 ? "text-destructive font-black" : "text-muted-foreground"
                    }`}
                  >
                    {netProfit >= 0 ? `+₹${netProfit}` : `-₹${Math.abs(netProfit)}`}
                  </span>
                </div>

                {/* Quick Minus and Clear controls on card */}
                {betAmount > 0 && (
                  <div className="mt-1.5 flex gap-1 pt-1 border-t border-border/40">
                    <button
                      onClick={(e) => handleSubBet(e, i)}
                      className="flex-1 py-0.5 rounded bg-muted hover:bg-destructive/20 text-destructive text-[11px] font-black"
                    >
                      -₹{selectedStake}
                    </button>
                    <button
                      onClick={(e) => handleClearCard(e, i)}
                      className="px-2 py-0.5 rounded bg-muted hover:bg-destructive text-muted-foreground hover:text-white text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* ============================================================== */}
      {/* BOTTOM FIXED ACTION DOCK                                       */}
      {/* ============================================================== */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur-md p-2.5 flex items-center justify-between gap-2 shadow-2xl">
        <button
          onClick={handleClearAll}
          className="py-2.5 px-3 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs font-extrabold transition active:scale-95"
        >
          🗑️ Clear Round
        </button>

        <button
          onClick={handleTriggerSpin}
          className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-gold text-primary-foreground text-sm font-display font-extrabold shadow-gold transition active:scale-95 text-center flex items-center justify-center gap-1.5"
        >
          <span>⚡</span>
          <span>SPIN & LOCK RESULT NOW</span>
        </button>
      </footer>
    </div>
  );
}
