import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  TVHostSync,
  DEFAULT_ROOM_ID,
  sanitizeRoomId,
  GameMessage,
  getSynchronizedRoundState,
  calculateProfitGuaranteedWinner,
  PAYOUT_MULTIPLIER,
} from "@/lib/realtime";
import {
  getLoggedInAgent,
  setLoggedInAgent,
  authenticateAgent,
  getUsers,
  setActiveUserId,
  settleRoundBets,
  autoSettleAllPendingBets,
  UserAccount,
} from "@/lib/userStore";
import { recordRoundWinnerHistory } from "@/lib/cards";
import { settleTicketsForRound } from "@/lib/ticketStore";
import { saveRecordedRoundWinner } from "@/lib/roundSettlement";
import { declareSoratRoundRpc } from "@/lib/supabase";
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

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "Sorat — Live TV Arena Display (Big Screen)" },
      { name: "description", content: "Big Screen Spectator Arena for Sorat Game" },
      { property: "og:title", content: "Sorat — Live TV Arena Display" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: TvArenaPage,
});

const CARDS = [
  { id: 0, name: "पतंग", img: kite },
  { id: 1, name: "छत्री", img: umbrella },
  { id: 2, name: "बॉल", img: ball },
  { id: 3, name: "सूर्य", img: sun },
  { id: 4, name: "गुलाब", img: rose },
  { id: 5, name: "दिवा", img: diya },
  { id: 6, name: "फुलपाखरू", img: butterfly },
  { id: 7, name: "चिमणी", img: sparrow },
  { id: 8, name: "ससा", img: rabbit },
  { id: 9, name: "भोवरा", img: top },
  { id: 10, name: "बादली", img: bucket },
  { id: 11, name: "गाय", img: cow },
];

type Phase = "bet" | "select" | "result";

interface ResultHistoryItem {
  roundId: string;
  cardIndex: number;
  cardName: string;
  timeStr: string;
}

export default function TvArenaPage() {
  const initialSync = getSynchronizedRoundState();
  const [roundNumber, setRoundNumber] = useState(initialSync.roundNumber);
  const [roundId, setRoundId] = useState(initialSync.roundId);
  const [phase, setPhase] = useState<Phase>(initialSync.phase);
  const [t, setT] = useState(initialSync.timeLeft);

  // Room / Counter ID (Accepts ?room=... or localStorage override or defaults to logged in agent)
  const [activeRoomId, setActiveRoomId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const r = sp.get("room") || sp.get("counter") || sp.get("agent");
      if (r) return sanitizeRoomId(r);
      const savedTvRoom = localStorage.getItem("sorat_tv_room");
      if (savedTvRoom) return sanitizeRoomId(savedTvRoom);
    }
    const agent = getLoggedInAgent();
    if (agent?.agentCode || agent?.username || agent?.id) {
      return sanitizeRoomId(agent.agentCode || agent.username || agent.id);
    }
    return DEFAULT_ROOM_ID;
  });

  const [showRoomSelector, setShowRoomSelector] = useState(false);
  const [allUsersList, setAllUsersList] = useState<UserAccount[]>(() => getUsers());
  useEffect(() => {
    setAllUsersList(getUsers());
  }, []);

  const handleSelectTvRoom = (roomId: string, user?: UserAccount) => {
    const clean = sanitizeRoomId(roomId);
    setActiveRoomId(clean);
    if (user) {
      setTvAgent(user);
      setLoggedInAgent(user.id);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("sorat_tv_room", clean);
      const url = new URL(window.location.href);
      url.searchParams.set("room", clean);
      window.history.replaceState({}, "", url.toString());
    }
    setShowRoomSelector(false);
  };

  const hasUrlRoom = typeof window !== "undefined" && Boolean(
    new URLSearchParams(window.location.search).get("room") ||
    new URLSearchParams(window.location.search).get("counter") ||
    new URLSearchParams(window.location.search).get("agent")
  );

  // TV Agent Authentication State
  const [tvAgent, setTvAgent] = useState<UserAccount | null>(() => getLoggedInAgent());
  const [loginIdInput, setLoginIdInput] = useState("");
  const [loginPinInput, setLoginPinInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  // Game Board State (Synced from Agent POS App)
  const [bets, setBets] = useState<Record<number, number>>({});
  const [winner, setWinner] = useState<number | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Financials for Guaranteed 30%-35% Margin Engine (Isolated to this Room / Counter)
  const [totalTurnover, setTotalTurnover] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`sorat_total_turnover_${activeRoomId}`);
      if (saved) return Number(saved);
      const legacy = localStorage.getItem("sorat_total_turnover");
      if (legacy && activeRoomId === DEFAULT_ROOM_ID) return Number(legacy);
    }
    return 0;
  });
  const [totalPayouts, setTotalPayouts] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`sorat_total_payouts_${activeRoomId}`);
      if (saved) return Number(saved);
      const legacy = localStorage.getItem("sorat_total_payouts");
      if (legacy && activeRoomId === DEFAULT_ROOM_ID) return Number(legacy);
    }
    return 0;
  });

  // Recent Winners History (Room-scoped)
  const [resultsHistory, setResultsHistory] = useState<ResultHistoryItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`sorat_tv_results_history_${activeRoomId}`);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [
      { roundId: "#0839", cardIndex: 11, cardName: "गाय", timeStr: "08:39 PM" },
      { roundId: "#0838", cardIndex: 3, cardName: "सूर्य", timeStr: "08:38 PM" },
      { roundId: "#0837", cardIndex: 0, cardName: "पतंग", timeStr: "08:37 PM" },
      { roundId: "#0836", cardIndex: 7, cardName: "चिमणी", timeStr: "08:36 PM" },
      { roundId: "#0835", cardIndex: 4, cardName: "गुलाब", timeStr: "08:35 PM" },
      { roundId: "#0834", cardIndex: 8, cardName: "ससा", timeStr: "08:34 PM" },
    ];
  });

  const lastProcessedRoundRef = useRef<number>(initialSync.roundNumber);
  const lastDecidedWinnerRoundRef = useRef<number | null>(null);
  const forcedWinnerRef = useRef<number | null>(null);
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);
  const hostSyncRef = useRef<TVHostSync | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Audio Context Helpers
  const getAudioContext = () => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const playBeep = (freq: number, duration: number, type: OscillatorType = "sine") => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {}
  };

  const playVictoryFanfare = () => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
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

  // Listen to cross-tab storage changes (if Agent logs in/out in another tab)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sorat_logged_in_agent_id_v1") {
        const u = getLoggedInAgent();
        setTvAgent(u);
        if (u) {
          const newRoom = sanitizeRoomId(u.agentCode || u.username || u.id);
          setActiveRoomId(newRoom);
        }
      }
      if (e.key === "sorat_tv_room" && e.newValue) {
        setActiveRoomId(sanitizeRoomId(e.newValue));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Initialize TV Host Sync to receive live bets from Agent POS Mobile App (Scoped to activeRoomId)
  useEffect(() => {
    const host = new TVHostSync(activeRoomId);
    hostSyncRef.current = host;

    host.onMessage = (msg: GameMessage) => {
      if (msg.type === "SWITCH_ACTIVE_USER") {
        if (msg.roomId) {
          setActiveRoomId(sanitizeRoomId(msg.roomId));
        } else if (msg.userId) {
          const u = getUsers().find((x) => x.id === msg.userId || x.username === msg.userId);
          if (u) {
            setActiveRoomId(sanitizeRoomId(u.agentCode || u.username || u.id));
          }
        }
      } else if (msg.type === "ADD_TICKET_BETS") {
        setBets((prev) => {
          const next = { ...prev };
          Object.entries(msg.bets).forEach(([c, amt]) => {
            const cardNum = Number(c);
            next[cardNum] = (next[cardNum] ?? 0) + amt;
          });
          return next;
        });
        setTotalTurnover((t) => {
          const next = t + msg.totalAmount;
          if (typeof window !== "undefined") {
            localStorage.setItem(`sorat_total_turnover_${activeRoomId}`, String(next));
          }
          return next;
        });
        playBeep(720, 0.08, "sine");
      } else if (msg.type === "ADD_BET") {
        setBets((prev) => ({
          ...prev,
          [msg.card]: (prev[msg.card] ?? 0) + msg.amount,
        }));
        setTotalTurnover((t) => {
          const next = t + msg.amount;
          if (typeof window !== "undefined") {
            localStorage.setItem(`sorat_total_turnover_${activeRoomId}`, String(next));
          }
          return next;
        });
        playBeep(720, 0.08, "sine");
      } else if (msg.type === "FORCE_WINNER") {
        const card = msg.card !== undefined && msg.card !== null ? Number(msg.card) : null;
        setForcedWinner(card);
        forcedWinnerRef.current = card;
        playBeep(880, 0.15, "triangle");
      } else if (msg.type === "CLEAR_ALL_BETS") {
        setBets({});
        playBeep(440, 0.1, "sine");
      } else if (msg.type === "TRIGGER_SPIN") {
        setPhase("select");
        setT(5);
        playBeep(960, 0.15, "sine");
      } else if (msg.type === "RESET_FINANCIALS") {
        setTotalTurnover(0);
        setTotalPayouts(0);
        if (typeof window !== "undefined") {
          localStorage.removeItem(`sorat_total_turnover_${activeRoomId}`);
          localStorage.removeItem(`sorat_total_payouts_${activeRoomId}`);
        }
      }
    };

    host.connect();
    return () => host.destroy();
  }, [activeRoomId, soundEnabled]);

  // Synchronized Clock Ticker
  useEffect(() => {
    const updateTick = () => {
      const sync = getSynchronizedRoundState();
      setT(sync.timeLeft);
      setPhase(sync.phase);

      // New Round Rollover every 60 seconds
      if (sync.roundNumber !== lastProcessedRoundRef.current) {
        lastProcessedRoundRef.current = sync.roundNumber;
        setRoundNumber(sync.roundNumber);
        setRoundId(sync.roundId);
        setBets({});
        setWinner(null);
        setSpot(null);
        lastDecidedWinnerRoundRef.current = null;
        setForcedWinner(null);
        forcedWinnerRef.current = null;
      }

      // Audio countdown cues in final 5 seconds of betting phase
      if (sync.phase === "bet" && sync.timeLeft <= 5 && sync.timeLeft > 0) {
        playBeep(880, 0.12, "sawtooth");
      }
    };

    updateTick();
    const id = setInterval(updateTick, 250);
    return () => clearInterval(id);
  }, [soundEnabled]);

  // Determine Winner When Entering "select" Phase (Scoped strictly to this Counter / Room)
  useEffect(() => {
    if (phase === "select" && lastDecidedWinnerRoundRef.current !== roundNumber) {
      lastDecidedWinnerRoundRef.current = roundNumber;

      const decision = calculateProfitGuaranteedWinner(
        bets,
        totalTurnover,
        totalPayouts,
        forcedWinnerRef.current
      );

      const w = decision.winner;
      const prize = (bets[w] ?? 0) * PAYOUT_MULTIPLIER;
      setWinner(w);

      if (prize > 0) {
        setTotalPayouts((p) => {
          const next = p + prize;
          if (typeof window !== "undefined") {
            localStorage.setItem(`sorat_total_payouts_${activeRoomId}`, String(next));
          }
          return next;
        });
      }

      const winnerCard = CARDS[w] ?? CARDS[0]!;
      const winnerCardName = winnerCard.name;

      // Automatically settle tickets and bets placed on this round & room
      settleTicketsForRound(roundId, w, winnerCardName, activeRoomId);
      settleRoundBets(roundId, w, winnerCardName, false);
      autoSettleAllPendingBets(roundNumber, "select", w);
      recordRoundWinnerHistory(roundNumber, w);
      saveRecordedRoundWinner(roundNumber, w, activeRoomId);

      // Persist round declaration in Supabase
      try {
        declareSoratRoundRpc({
          roundId,
          winningCard: w,
          winningCardName: winnerCardName,
          selectionReason: `${decision.reason} [Counter: ${activeRoomId}]`,
        }).catch(() => {});
      } catch {}

      // Record to recent history
      const nowStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const newHistItem: ResultHistoryItem = {
        roundId,
        cardIndex: w,
        cardName: winnerCardName,
        timeStr: nowStr,
      };
      setResultsHistory((prev) => {
        const next = [newHistItem, ...prev.slice(0, 11)];
        if (typeof window !== "undefined") {
          localStorage.setItem(`sorat_tv_results_history_${activeRoomId}`, JSON.stringify(next));
        }
        return next;
      });

      // 1. Authoritative Winner Declaration broadcast via Supabase Realtime channel
      hostSyncRef.current?.broadcast({
        type: "WINNER_DECLARED",
        roundNumber,
        roundId,
        winner: w,
        winnerName: winnerCardName,
        netPayout: prize,
        reason: decision.reason,
        roomId: activeRoomId,
      });

      // 2. Full State Sync to Agent Mobile POS Apps
      hostSyncRef.current?.broadcast({
        type: "SYNC_FROM_TV",
        roundNumber,
        roundId,
        phase: "select",
        t,
        bets,
        pool: Object.values(bets).reduce((a, b) => a + b, 0),
        winner: w,
        forcedWinner: forcedWinnerRef.current,
        agentBalance: 0,
        totalTurnover,
        totalPayouts: totalPayouts + prize,
        houseProfit: totalTurnover - (totalPayouts + prize),
        profitPercentage: 35,
        roomId: activeRoomId,
      });

      playVictoryFanfare();
    }
  }, [phase, roundNumber, bets, totalTurnover, totalPayouts, soundEnabled, activeRoomId]);

  // Broadcast again when entering "result" phase so all agents reveal winner simultaneously
  useEffect(() => {
    if (phase === "result" && winner !== null) {
      hostSyncRef.current?.broadcast({
        type: "SYNC_FROM_TV",
        roundNumber,
        roundId,
        phase: "result",
        t,
        bets,
        pool: Object.values(bets).reduce((a, b) => a + b, 0),
        winner,
        forcedWinner: forcedWinnerRef.current,
        agentBalance: 0,
        totalTurnover,
        totalPayouts,
        houseProfit: totalTurnover - totalPayouts,
        profitPercentage: 35,
        roomId: activeRoomId,
      });
    }
  }, [phase, winner, activeRoomId]);

  // High-Speed Selection Animation during "select" phase
  useEffect(() => {
    if (phase !== "select") return;
    let s = 0;
    const id = setInterval(() => {
      s = (s + 1) % 12;
      setSpot(s);
      playBeep(440 + s * 40, 0.04, "triangle");
    }, 110);
    return () => clearInterval(id);
  }, [phase, soundEnabled]);

  // Total Bets on Board
  const totalBetsOnBoard = Object.values(bets).reduce((a, b) => a + b, 0);
  const hurry = phase === "bet" && t <= 5;

  // TV Agent Login Form Submission
  const handleTvLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const res = authenticateAgent(loginIdInput, loginPinInput);
    if (res.success && res.user) {
      setTvAgent(res.user);
      setActiveUserId(res.user.id);
      const newRoom = sanitizeRoomId(res.user.agentCode || res.user.username || res.user.id);
      setActiveRoomId(newRoom);
      if (typeof window !== "undefined") {
        localStorage.setItem("sorat_tv_room", newRoom);
        const url = new URL(window.location.href);
        url.searchParams.set("room", newRoom);
        window.history.replaceState({}, "", url.toString());
      }
    } else {
      setLoginError(res.error || "Login fail! Sahi Agent ID aur 4-digit PIN daalein.");
    }
  };

  const handleTvLogout = () => {
    if (confirm("Kya aap TV screen se counter disconnect karna chahte hain?")) {
      setLoggedInAgent(null);
      setTvAgent(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem("sorat_tv_room");
        window.location.href = "/tv";
      }
    }
  };

  // =========================================================================
  // SCREEN 1: TV AGENT LOGIN GATE (If TV is not connected via URL or logged-in agent)
  // =========================================================================
  if (!tvAgent && !hasUrlRoom) {
    return (
      <main className="h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
        {/* Ambient Glow */}
        <div className="absolute -top-32 -left-32 h-[450px] w-[450px] rounded-full bg-amber-500/20 blur-[130px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 h-[450px] w-[450px] rounded-full bg-purple-600/20 blur-[130px] pointer-events-none" />

        <div className="w-full max-w-md bg-zinc-900/95 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6 relative z-10">
          <div className="text-center space-y-2">
            <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-gold grid place-items-center font-display text-3xl font-black text-primary-foreground shadow-gold">
              S
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-black tracking-wide text-foreground">
              SORAT TV ARENA
            </h1>
            <p className="text-xs text-muted-foreground font-medium">
              Big Screen Spectator Arena Display Setup
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-bold font-mono">
              <span>🎰 Live Round:</span> {roundId} • <span>{t}s</span>
            </div>
          </div>

          <form onSubmit={handleTvLogin} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Agent ID / Username
              </label>
              <input
                type="text"
                required
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value)}
                placeholder="Jaise agent1, agent2"
                className="w-full bg-background border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-bold text-foreground placeholder:text-muted-foreground/50 outline-none transition"
              />
            </div>

            <div className="space-y-1.5 text-left">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                4-Digit Password / PIN
              </label>
              <input
                type="password"
                required
                maxLength={8}
                value={loginPinInput}
                onChange={(e) => setLoginPinInput(e.target.value)}
                placeholder="•••• (Default: 1234)"
                className="w-full bg-background border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-bold text-foreground tracking-widest placeholder:tracking-normal placeholder:text-muted-foreground/50 outline-none transition"
              />
            </div>

            {loginError && (
              <div className="rounded-xl bg-destructive/15 border border-destructive/40 p-3 text-xs text-destructive font-bold text-center">
                ⚠️ {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl bg-gradient-gold text-primary-foreground font-display text-base font-black tracking-wide shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>📺</span>
              <span>START LIVE TV DISPLAY</span>
            </button>
          </form>

          {/* Quick Demo Buttons */}
          <div className="border-t border-border/80 pt-4 space-y-2 text-center">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
              Quick 1-Tap Demo Connect
            </span>
            <div className="grid grid-cols-3 gap-2">
              {getUsers().slice(0, 3).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    const res = authenticateAgent(u.username, u.pin || "1234");
                    if (res.success && res.user) {
                      setTvAgent(res.user);
                      setActiveUserId(res.user.id);
                    }
                  }}
                  className="p-2 rounded-xl bg-muted/60 hover:bg-muted border border-border text-left transition"
                >
                  <div className="text-[11px] font-black text-foreground truncate">{u.displayName.split(" ")[0]}</div>
                  <div className="text-[9px] text-primary font-mono font-bold">ID: {u.username}</div>
                  <div className="text-[9px] text-muted-foreground font-mono">PIN: {u.pin || "1234"}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // =========================================================================
  // SCREEN 2: PURE SPECTATOR TV ARENA (NO BETTING CONTROLS OR DASHBOARD)
  // =========================================================================
  return (
    <main
      className={`relative h-screen max-h-screen w-full overflow-hidden bg-background text-foreground flex flex-col justify-between select-none ${
        hurry ? "shadow-[inset_0_0_90px_rgba(239,68,68,0.35)]" : ""
      }`}
    >
      {/* Ambient Lighting Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-24 -left-24 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-amber-500/20 via-yellow-600/10 to-transparent blur-[120px]" />
        <div className="absolute top-1/3 -right-32 h-[580px] w-[580px] rounded-full bg-gradient-to-tl from-indigo-500/20 via-purple-600/10 to-transparent blur-[140px]" />
        <div className="absolute -bottom-24 left-1/4 h-[480px] w-[480px] rounded-full bg-gradient-to-tr from-emerald-500/15 via-teal-600/10 to-transparent blur-[130px]" />

        {hurry && (
          <div className="fixed inset-0 bg-gradient-to-b from-red-600/15 via-amber-600/10 to-red-950/20 animate-pulse" />
        )}

        {phase === "result" && (
          <div className="victory-glow-burst fixed inset-0 bg-radial from-amber-400/25 via-primary/10 to-transparent" />
        )}
      </div>

      {/* ============================================================== */}
      {/* 1. TOP HEADER STATUS BAR (SPECTATOR FRIENDLY)                 */}
      {/* ============================================================== */}
      <header className="relative z-20 px-3 sm:px-6 py-2.5 bg-card/90 backdrop-blur-md border-b border-border/80 shadow-md flex items-center justify-between shrink-0">
        
        {/* Brand & Live Indicator */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-gold grid place-items-center font-display text-base font-black text-primary-foreground shadow-gold">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-xl sm:text-2xl font-black tracking-wider leading-none">
                SORAT
              </span>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-destructive/20 border border-destructive/40 text-[10px] font-black text-destructive tracking-widest uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-ping" />
                LIVE ARENA
              </span>
            </div>
            <div className="text-[10px] font-bold text-muted-foreground mt-0.5">
              12 Picture Cards • 9X Payout
            </div>
          </div>
        </div>

        {/* Center Countdown & Phase Gauge */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="px-3 py-1 rounded-xl bg-primary text-primary-foreground font-mono font-black text-xs sm:text-sm shadow-gold tracking-wider">
            🎰 ROUND {roundId}
          </span>

          <div
            className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-black tracking-wide border flex items-center gap-1.5 ${
              phase === "bet"
                ? hurry
                  ? "bg-destructive/20 text-destructive border-destructive/40 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                  : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                : phase === "select"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.5)]"
                : "bg-purple-500/25 text-purple-300 border-purple-500/50 shadow-gold"
            }`}
          >
            {phase === "bet" ? (
              <span>⏳ {t}s {hurry ? "CLOSING SOON!" : "BETS OPEN"}</span>
            ) : phase === "select" ? (
              <span>⚡ {t}s WHEEL SPINNING...</span>
            ) : (
              <span>🏆 WINNER: {winner !== null ? CARDS[winner]?.name : ""}!</span>
            )}
          </div>
        </div>

        {/* Right Info & Display Controls */}
        <div className="flex items-center gap-3">
          {/* Active Counter Badge with 1-Tap Switcher */}
          <button
            type="button"
            onClick={() => {
              setAllUsersList(getUsers());
              setShowRoomSelector(true);
            }}
            title="Click to Switch Counter Room / Agent TV Display"
            className="hidden sm:flex flex-col text-right p-1.5 rounded-xl hover:bg-muted/80 border border-border/40 hover:border-primary/50 transition cursor-pointer"
          >
            <span className="text-[9px] uppercase font-bold text-muted-foreground flex items-center justify-end gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Counter Room ⇄
            </span>
            <span className="text-xs font-black text-primary font-mono truncate max-w-[160px]">
              📡 {activeRoomId.toUpperCase()}
            </span>
          </button>

          {/* Action Total Pool */}
          <div className="px-3 py-1 rounded-xl bg-background/80 border border-border text-xs font-mono font-black text-primary flex items-center gap-1">
            <span>🪙</span>
            <span>POOL: ₹{totalBetsOnBoard.toLocaleString("en-IN")}</span>
          </div>

          {/* Screen Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSound}
              title={soundEnabled ? "Mute Sound" : "Enable Sound FX"}
              className={`p-1.5 rounded-lg text-xs font-bold transition border ${
                soundEnabled
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {soundEnabled ? "🔊" : "🔇"}
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (TV Mode)"}
              className="p-1.5 rounded-lg text-xs font-bold transition border bg-muted border-border text-muted-foreground hover:text-foreground"
            >
              {isFullscreen ? "🗗" : "⛶"}
            </button>
            <button
              onClick={handleTvLogout}
              title="Disconnect / Switch Agent"
              className="p-1.5 rounded-lg text-xs font-bold transition border bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25"
            >
              🚪
            </button>
          </div>
        </div>

      </header>

      {/* ============================================================== */}
      {/* 2. MAIN SPECTATOR STAGE: 12 PICTURE CARDS (FULL BLEED GRID)     */}
      {/* ============================================================== */}
      <section className="relative z-10 flex-1 min-h-0 p-2 sm:p-4 flex flex-col justify-between overflow-hidden">
        
        {/* LED Marquee Ticker */}
        <div className="casino-marquee h-1.5 w-full shrink-0 rounded-full border border-amber-500/40 opacity-80 shadow-[0_0_10px_rgba(245,158,11,0.5)] mb-2" />

        {/* 12 Picture Cards Grid - 4 Columns x 3 Rows, strictly fitting screen height */}
        <div className="grid flex-1 min-h-0 grid-cols-4 grid-rows-3 gap-2 sm:gap-3.5">
          {CARDS.map((card, idx) => {
            const isLit = (phase === "select" && spot === idx) || (phase === "result" && winner === idx);
            const cardBet = bets[idx] || 0;
            const isWinner = phase === "result" && winner === idx;

            return (
              <div
                key={card.id}
                className={`relative overflow-hidden rounded-2xl border text-center transition-all duration-200 select-none h-full w-full min-h-0 flex flex-col items-center justify-between p-1.5 pointer-events-none ${
                  isLit
                    ? "ring-4 ring-primary shadow-[0_0_40px_rgba(245,158,11,0.9)] scale-[1.03] z-20 border-primary bg-card"
                    : cardBet > 0
                    ? "border-primary/80 ring-2 ring-primary/40 shadow-[0_0_15px_rgba(245,158,11,0.3)] bg-card/90"
                    : "border-border/80 bg-card/75"
                } ${phase === "result" && !isWinner ? "opacity-35 grayscale-[25%]" : ""}`}
              >
                {/* Floating Bet Chip Badge */}
                {cardBet > 0 && (
                  <div className="absolute top-2 right-2 z-30 flex items-center gap-1 rounded-full bg-gradient-gold text-primary-foreground font-black px-2.5 py-0.5 text-xs sm:text-sm shadow-gold animate-bounce">
                    <span>🪙</span>
                    <span>₹{cardBet}</span>
                  </div>
                )}

                {/* Card Picture */}
                <div className="flex-1 w-full flex items-center justify-center min-h-0 p-1">
                  <img
                    src={card.img}
                    alt={card.name}
                    className="max-h-full max-w-full object-contain rounded-xl drop-shadow-lg transition-transform duration-300"
                  />
                </div>

                {/* Marathi Name Footer */}
                <div className="w-full py-0.5 rounded-xl bg-background/90 border border-border/60 shrink-0 text-center">
                  <span className="font-display text-xs sm:text-sm md:text-base font-black text-foreground tracking-wide block">
                    {card.name}
                  </span>
                </div>

                {/* Winner Crown Ribbon */}
                {isWinner && (
                  <div className="absolute inset-x-0 top-1/3 z-40 bg-gradient-gold text-primary-foreground py-1 font-display text-sm sm:text-base font-black tracking-widest uppercase shadow-gold animate-pulse">
                    🏆 WINNER (9X) 🏆
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </section>

      {/* ============================================================== */}
      {/* 3. BOTTOM SPECTATOR BAR: RECENT WINNERS HISTORY                */}
      {/* ============================================================== */}
      <footer className="relative z-20 px-3 sm:px-6 py-2 bg-card/95 border-t border-border/80 backdrop-blur-md shrink-0">
        <div className="flex items-center justify-between gap-3 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-black text-muted-foreground uppercase tracking-widest hidden sm:inline">
              📜 RECENT RESULTS:
            </span>
            <span className="text-xs font-black text-muted-foreground uppercase tracking-widest sm:hidden">
              📜 LAST:
            </span>
          </div>

          {/* Horizontal Recent Results Carousel */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {resultsHistory.slice(0, 10).map((hist, i) => {
              const card = CARDS[hist.cardIndex] ?? CARDS[0]!;
              return (
                <div
                  key={`${hist.roundId}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-background border border-border/80 shrink-0 shadow-sm"
                >
                  <img
                    src={card.img}
                    alt={card.name}
                    className="h-6 w-6 rounded-md object-contain bg-muted"
                  />
                  <div>
                    <span className="text-[11px] font-black text-foreground block leading-tight">
                      {card.name}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground block leading-tight">
                      {hist.roundId}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Public Notice */}
          <div className="hidden lg:block text-right shrink-0 text-[10px] font-bold text-muted-foreground">
            Bets accepted at Operator Counter only • 9x Fixed Payout
          </div>
        </div>
      </footer>

      {/* ============================================================== */}
      {/* 4. MASSIVE WINNER 3D POP OVERLAY                               */}
      {/* ============================================================== */}
      {phase === "result" && winner !== null && CARDS[winner] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in zoom-in-75 duration-300 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.35)_0%,transparent_70%)]" />
          <div className="laser-sweep-beam absolute -top-[50%] -left-[50%] h-[200%] w-[200%] bg-[conic-gradient(from_0deg_at_50%_50%,rgba(245,158,11,0.3)_0deg,transparent_60deg,transparent_360deg)] animate-spin duration-1000" />

          <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-gradient-to-b from-amber-500/25 via-zinc-900 to-zinc-950 border-4 border-amber-400 rounded-3xl p-6 sm:p-8 text-center shadow-[0_0_100px_rgba(245,158,11,0.95)] animate-in zoom-in-50 duration-500">
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-gold text-zinc-950 font-display text-sm sm:text-base font-black uppercase tracking-widest shadow-gold mb-3 animate-pulse">
              <span>🏆</span>
              <span>LUCKY WINNER • 9X PAYOUT</span>
              <span>🏆</span>
            </div>

            <div className="relative mx-auto w-52 h-52 sm:w-64 sm:h-64 my-2 rounded-2xl overflow-hidden border-4 border-amber-400/90 bg-zinc-950 shadow-[0_0_60px_rgba(245,158,11,0.8)] flex items-center justify-center p-3">
              <img
                src={CARDS[winner].img}
                alt={CARDS[winner].name}
                className="w-full h-full object-contain filter drop-shadow-2xl scale-110 animate-pulse"
              />
            </div>

            <h2 className="mt-3 font-display text-5xl sm:text-6xl font-black text-amber-400 tracking-wider drop-shadow-[0_4px_25px_rgba(245,158,11,0.9)]">
              {CARDS[winner].name}
            </h2>

            <div className="mt-4 flex items-center justify-center gap-3 text-xs sm:text-sm font-mono font-bold">
              <span className="px-3.5 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300">
                ROUND {roundId}
              </span>
              <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/25 border border-emerald-500/50 text-emerald-400 font-black tracking-wide">
                WIN PAYS 9X
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. COUNTER ROOM SWITCHER MODAL                                 */}
      {/* ============================================================== */}
      {showRoomSelector && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div>
                <h3 className="font-display text-base font-black text-foreground flex items-center gap-2">
                  <span>📺</span>
                  <span>Select Counter Room Display</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Kis counter/agent ka live TV display screen open karna hai?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRoomSelector(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1.5 rounded-lg hover:bg-muted cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {/* Main Arena / All Counters */}
              <button
                type="button"
                onClick={() => handleSelectTvRoom("sorat_main")}
                className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                  activeRoomId === "sorat_main"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/40 hover:bg-muted text-foreground"
                }`}
              >
                <div>
                  <div className="font-black text-sm flex items-center gap-1.5">
                    <span>🌐</span>
                    <span>Main Global Arena</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">Default universal live room (sorat_main)</span>
                </div>
                {activeRoomId === "sorat_main" && (
                  <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">ACTIVE</span>
                )}
              </button>

              {/* Individual Agents List */}
              {allUsersList.map((user) => {
                const userRoom = sanitizeRoomId(user.agentCode || user.username || user.id);
                const isSelected = activeRoomId === userRoom;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelectTvRoom(userRoom, user)}
                    className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/10 text-amber-300"
                        : "border-border/60 bg-muted/40 hover:bg-muted text-foreground"
                    }`}
                  >
                    <div>
                      <div className="font-black text-sm flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span>{user.displayName}</span>
                        <span className="text-xs font-mono font-normal text-muted-foreground">(@{user.username})</span>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        Room: <span className="font-bold text-foreground">{userRoom.toUpperCase()}</span> • Code: {user.agentCode || "—"}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="text-xs font-black bg-amber-400 text-zinc-950 px-2 py-0.5 rounded-full">
                        ACTIVE TV
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border/60 text-center">
              <span className="text-[11px] text-muted-foreground">
                Direct link bhi use kar sakte hain: <code className="text-primary font-mono font-bold">/tv?room=kira</code>
              </span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

