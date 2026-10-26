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
      { title: "Sorat — Live Admin Controller" },
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

const MASTER_PIN = "1234";
const PAYOUT_MULTIPLIER = 10;

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const [roomId] = useState(DEFAULT_ROOM_ID);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");

  // Synced live state from User Screen
  const [phase, setPhase] = useState<"bet" | "select" | "result">("bet");
  const [timer, setTimer] = useState(60);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [lastWinner, setLastWinner] = useState<number | null>(null);

  // Admin Winner Control
  const [strategy, setStrategy] = useState<"house_profit" | "player_win" | "manual">("house_profit");
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);

  const clientSyncRef = useRef<AdminClientSync | null>(null);

  // Check stored auth session
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

  // Connect to User Screen via WebRTC
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

  // Admin sets the winner card
  const handleSelectWinner = (cardIdx: number) => {
    if (forcedWinner === cardIdx) {
      // Toggle off to auto
      setForcedWinner(null);
      setStrategy("house_profit");
      clientSyncRef.current?.send({ type: "FORCE_WINNER", card: null });
      clientSyncRef.current?.send({ type: "SET_STRATEGY", mode: "house_profit" });
    } else {
      // Lock this card as winner
      setForcedWinner(cardIdx);
      setStrategy("manual");
      clientSyncRef.current?.send({ type: "FORCE_WINNER", card: cardIdx });
      clientSyncRef.current?.send({ type: "SET_STRATEGY", mode: "manual" });
    }
  };

  const handleSetStrategy = (mode: "house_profit" | "player_win" | "manual") => {
    setStrategy(mode);
    if (mode !== "manual") setForcedWinner(null);
    clientSyncRef.current?.send({ type: "SET_STRATEGY", mode });
    if (mode !== "manual") clientSyncRef.current?.send({ type: "FORCE_WINNER", card: null });
  };

  const handleTriggerSpin = () => {
    clientSyncRef.current?.send({ type: "TRIGGER_SPIN" });
  };

  const handleClearBets = () => {
    if (confirm("User ke saare bets reset karne hain?")) {
      clientSyncRef.current?.send({ type: "CLEAR_ALL_BETS" });
      setBets({});
    }
  };

  // Financial calculations
  const totalUserBets = Object.values(bets).reduce((a, b) => a + b, 0);
  const betAmounts = Object.values(bets);
  const maxBetAmount = betAmounts.length > 0 ? Math.max(...betAmounts, 0) : 0;

  // PIN Lock Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-gold grid place-items-center text-primary-foreground font-display text-xl mb-4">
            🔒
          </div>
          <h1 className="font-display text-2xl">Admin Master Login</h1>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            Admin Master PIN enter karein
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
              UNLOCK ADMIN ACCESS
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 select-none">
      {/* ============================================================== */}
      {/* HEADER WITH REALTIME STATUS                                    */}
      {/* ============================================================== */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md px-3.5 py-2.5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl tracking-wide text-primary">ADMIN CONTROL</span>
            <span
              className={`flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                connectionStatus === "connected"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : "bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connectionStatus === "connected" ? "USER SCREEN LIVE" : "CONNECTING..."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-muted border border-border">
              {phase === "bet" ? `⏳ ${timer}s` : phase === "select" ? "⚡ SPINNING" : "🏆 RESULT"}
            </span>
            <button
              onClick={() => {
                sessionStorage.removeItem("sorat_admin_auth");
                setIsAuthenticated(false);
              }}
              title="Logout"
              className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs"
            >
              🔒
            </button>
          </div>
        </div>

        {/* Live Overview Banner */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-background p-2.5 text-center">
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">User Total Bets</span>
            <span className="text-2xl font-display text-primary font-black">₹{totalUserBets.toLocaleString("en-IN")}</span>
          </div>

          <div className="rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-center flex flex-col justify-center">
            <span className="text-[10px] font-extrabold uppercase text-primary block">Active Winner Setting</span>
            <span className="text-xs font-display font-extrabold text-foreground truncate">
              {forcedWinner !== null
                ? `👑 FORCED: ${CARDS[forcedWinner]?.name}`
                : strategy === "house_profit"
                ? "🛡️ AUTO SAFE (0-BET WINS)"
                : "🎁 RETENTION PAYOUT"}
            </span>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* QUICK STRATEGY SELECTOR PRESETS                                */}
      {/* ============================================================== */}
      <section className="p-3 bg-muted/30 border-b border-border">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
            Result Mode:
          </span>
          {forcedWinner !== null && (
            <button
              onClick={() => handleSelectWinner(forcedWinner)}
              className="text-[10px] text-destructive font-bold underline"
            >
              Clear Forced Winner
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          <button
            onClick={() => handleSetStrategy("house_profit")}
            className={`py-2 px-2 rounded-xl border text-center transition flex items-center justify-center gap-1.5 ${
              strategy === "house_profit" && forcedWinner === null
                ? "bg-emerald-600 text-white border-emerald-400 shadow-md font-extrabold"
                : "bg-card border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <span>🛡️</span>
            <span>Auto Safe (User Haro)</span>
          </button>

          <button
            onClick={() => handleSetStrategy("player_win")}
            className={`py-2 px-2 rounded-xl border text-center transition flex items-center justify-center gap-1.5 ${
              strategy === "player_win" && forcedWinner === null
                ? "bg-amber-600 text-white border-amber-400 shadow-md font-extrabold"
                : "bg-card border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <span>🎁</span>
            <span>Auto Small Win (Thoda Jitaao)</span>
          </button>
        </div>
      </section>

      {/* ============================================================== */}
      {/* 12-CARD LIVE BET MONITOR & WINNER SELECTOR                      */}
      {/* ============================================================== */}
      <main className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
            Cards & User Bets (Tap card to make it WINNER 👑):
          </span>
          <span className="text-[10px] text-primary font-bold">Payout: 10x</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {CARDS.map((c, i) => {
            const userBet = bets[i] ?? 0;
            const payout = userBet * PAYOUT_MULTIPLIER;
            const netHousePL = totalUserBets - payout;
            const isHighest = userBet > 0 && userBet === maxBetAmount;
            const isWinnerSelected = forcedWinner === i;

            return (
              <div
                key={i}
                onClick={() => handleSelectWinner(i)}
                className={`relative rounded-2xl border p-2.5 transition active:scale-95 cursor-pointer flex flex-col justify-between ${
                  isWinnerSelected
                    ? "border-amber-400 bg-amber-500/20 ring-4 ring-amber-400/80 shadow-[0_0_25px_rgba(251,191,36,0.5)] z-20"
                    : isHighest
                    ? "border-destructive bg-destructive/10 ring-2 ring-destructive/40 shadow-sm"
                    : userBet > 0
                    ? "border-primary/80 bg-primary/10 shadow-sm"
                    : "border-border/80 bg-card hover:border-border"
                }`}
              >
                {/* Header row: Card Name + Winner Selection Badge */}
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-extrabold text-foreground">{c.name}</span>
                  <span
                    className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      isWinnerSelected
                        ? "bg-amber-400 text-black font-extrabold shadow-sm animate-pulse"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isWinnerSelected ? "WINNER 👑" : "MAKE WIN"}
                  </span>
                </div>

                {/* Card Image Thumbnail + User Bet Info */}
                <div className="flex items-center gap-2.5 my-2">
                  <img src={c.img} alt={c.name} className="h-12 w-12 rounded-xl object-cover border border-border shrink-0 shadow-sm" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block leading-tight">User Bet:</span>
                    <span
                      className={`text-lg font-display font-black leading-tight ${
                        isHighest ? "text-destructive" : userBet > 0 ? "text-primary" : "text-muted-foreground/60"
                      }`}
                    >
                      🪙 ₹{userBet}
                    </span>
                    {isHighest && (
                      <span className="text-[9px] font-extrabold text-destructive block leading-none mt-0.5 animate-pulse">
                        ⚠️ MAX BET
                      </span>
                    )}
                  </div>
                </div>

                {/* P&L Analysis */}
                <div className="pt-1.5 border-t border-border/50 flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Admin P&L:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      netHousePL > 0 ? "text-emerald-400" : netHousePL < 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {netHousePL >= 0 ? `+₹${netHousePL}` : `-₹${Math.abs(netHousePL)}`}
                  </span>
                </div>

                {/* Bottom One-Tap Select Winner Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectWinner(i);
                  }}
                  className={`mt-2 w-full py-1.5 rounded-lg text-xs font-display font-extrabold transition shadow-sm flex items-center justify-center gap-1 ${
                    isWinnerSelected
                      ? "bg-amber-400 text-black shadow-gold"
                      : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                  }`}
                >
                  <span>{isWinnerSelected ? "👑 SELECTED WINNER" : "🏆 JITAAO"}</span>
                </button>
              </div>
            );
          })}
        </div>
      </main>

      {/* ============================================================== */}
      {/* BOTTOM ACTION BAR                                              */}
      {/* ============================================================== */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur-md p-2.5 flex items-center justify-between gap-2 shadow-2xl">
        <button
          onClick={handleClearBets}
          className="py-2.5 px-3 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive text-xs font-extrabold transition active:scale-95"
        >
          🗑️ Clear Bets
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
