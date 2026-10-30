import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  TVHostSync,
  DEFAULT_ROOM_ID,
  GameMessage,
  getSynchronizedRoundState,
  calculateProfitGuaranteedWinner,
  BET_DURATION,
  SELECT_DURATION,
  RESULT_DURATION,
  ROUND_DURATION,
} from "@/lib/realtime";
import {
  getActiveUser,
  getUsers,
  setActiveUserId,
  recordUserBet,
  settleRoundBets,
  UserAccount,
} from "@/lib/userStore";
import { CounterPosModal } from "@/components/pos/CounterPosModal";
import { ThermalSlipModal } from "@/components/pos/ThermalSlipModal";
import { settleTicketsForRound, ThermalTicket } from "@/lib/ticketStore";
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

  // User Account Management State
  const [activeUser, setActiveUser] = useState<UserAccount>(() => getActiveUser());
  const [allUsers, setAllUsers] = useState<UserAccount[]>(() => getUsers());
  const [showUserModal, setShowUserModal] = useState(false);

  // Agent Wallet & Business Model Financials (Persisted in localStorage)
  const [agentBalance, setAgentBalance] = useState<number>(() => {
    const u = getActiveUser();
    return u ? u.balance : 1000;
  });
  const [totalTurnover, setTotalTurnover] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sorat_total_turnover");
      if (saved) return Number(saved);
    }
    return 0;
  });
  const [totalPayouts, setTotalPayouts] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sorat_total_payouts");
      if (saved) return Number(saved);
    }
    return 0;
  });

  const [bets, setBets] = useState<Record<number, number>>({});
  const [winner, setWinner] = useState<number | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [won, setWon] = useState(0);
  const [players, setPlayers] = useState(15);
  const [pool, setPool] = useState(128700);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);

  // Counter POS Terminal & Thermal Printer Slip State
  const [showPosModal, setShowPosModal] = useState(false);
  const [printSlipTicket, setPrintSlipTicket] = useState<ThermalTicket | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);

  // Round tracking references
  const lastProcessedRoundRef = useRef<number>(initialSync.roundNumber);
  const lastDecidedWinnerRoundRef = useRef<number | null>(null);
  const forcedWinnerRef = useRef<number | null>(null);

  // Realtime TV-Phone sync state
  const [counterConnected, setCounterConnected] = useState(false);
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);
  const hostSyncRef = useRef<TVHostSync | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Sync financials to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sorat_agent_balance", String(agentBalance));
    }
  }, [agentBalance]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sorat_total_turnover", String(totalTurnover));
    }
  }, [totalTurnover]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sorat_total_payouts", String(totalPayouts));
    }
  }, [totalPayouts]);

  // Synchronize User Accounts from storage / admin actions
  useEffect(() => {
    const handleSync = () => {
      const u = getActiveUser();
      setActiveUser(u);
      setAgentBalance(u.balance);
      setAllUsers(getUsers());
    };
    window.addEventListener("storage", handleSync);
    return () => window.removeEventListener("storage", handleSync);
  }, []);

  const houseProfit = totalTurnover - totalPayouts;
  const profitPercentage = totalTurnover > 0 ? Math.round(((totalTurnover - totalPayouts) / totalTurnover) * 100) : 100;

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
    } catch { }
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
    } catch { }
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
      document.documentElement.requestFullscreen().catch(() => { });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => { });
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
        setTotalTurnover((t) => t + msg.amount);
        setAgentBalance((b) => Math.max(0, b - msg.amount));
        playBeep(720, 0.07, "sine");
      } else if (msg.type === "SUB_BET") {
        setBets((prev) => ({
          ...prev,
          [msg.card]: Math.max(0, (prev[msg.card] ?? 0) - msg.amount),
        }));
        setTotalTurnover((t) => Math.max(0, t - msg.amount));
        setAgentBalance((b) => b + msg.amount);
      } else if (msg.type === "CLEAR_CARD") {
        setBets((prev) => {
          const currentAmt = prev[msg.card] ?? 0;
          setTotalTurnover((t) => Math.max(0, t - currentAmt));
          setAgentBalance((b) => b + currentAmt);
          const next = { ...prev };
          delete next[msg.card];
          return next;
        });
      } else if (msg.type === "CLEAR_ALL_BETS") {
        setBets((prev) => {
          const roundSum = Object.values(prev).reduce((a, b) => a + b, 0);
          setTotalTurnover((t) => Math.max(0, t - roundSum));
          setAgentBalance((b) => b + roundSum);
          return {};
        });
      } else if (msg.type === "SET_AGENT_BALANCE") {
        setAgentBalance(msg.balance);
        if (typeof window !== "undefined") {
          localStorage.setItem("sorat_agent_balance", String(msg.balance));
        }
        playBeep(920, 0.2, "sine");
      } else if (msg.type === "RECHARGE_AGENT") {
        setAgentBalance((prev) => {
          const next = prev + msg.amount;
          if (typeof window !== "undefined") {
            localStorage.setItem("sorat_agent_balance", String(next));
          }
          return next;
        });
        playBeep(880, 0.15, "sine");
      } else if (msg.type === "SWITCH_ACTIVE_USER") {
        setActiveUserId(msg.userId);
        const u = getActiveUser();
        setActiveUser(u);
        setAgentBalance(u.balance);
        setAllUsers(getUsers());
      } else if (msg.type === "SYNC_USERS") {
        const u = getActiveUser();
        setActiveUser(u);
        setAgentBalance(u.balance);
        setAllUsers(getUsers());
      } else if (msg.type === "RESET_FINANCIALS") {
        setTotalTurnover(0);
        setTotalPayouts(0);
      } else if (msg.type === "FORCE_WINNER") {
        forcedWinnerRef.current = msg.card;
        setForcedWinner(msg.card);
        if (msg.card !== null && msg.card >= 0 && msg.card < 12) {
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
      }
    };

    host.start();

    return () => {
      host.destroy();
    };
  }, [phase, bets]);

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
      forcedWinner,
      agentBalance,
      totalTurnover,
      totalPayouts,
      houseProfit,
      profitPercentage,
    });
  }, [roundNumber, roundId, t, phase, bets, pool, winner, forcedWinner, agentBalance, totalTurnover, totalPayouts, houseProfit, profitPercentage]);

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

  // 🔒 GUARANTEED 30% PROFIT BUSINESS ENGINE: Determine winner ONCE when phase enters "select"
  useEffect(() => {
    if (phase === "select" && lastDecidedWinnerRoundRef.current !== roundNumber) {
      lastDecidedWinnerRoundRef.current = roundNumber;

      const adminPick = forcedWinnerRef.current !== null ? forcedWinnerRef.current : forcedWinner;

      // Autonomous 30% Margin Protected Winner Selection
      const decision = calculateProfitGuaranteedWinner(
        bets,
        totalTurnover,
        totalPayouts,
        adminPick
      );

      const w = decision.winner;
      const prize = (bets[w] ?? 0) * PAYOUT;
      setWinner(w);
      setWon(prize);

      // Book accounting payouts
      if (prize > 0) {
        setTotalPayouts((p) => p + prize);
        // Note: In Prepaid Burn Model, agent's wagering points balance is NOT re-inflated upon wins.
        // Balance strictly consumes down to 0, requiring top-up from Owner!
      }

      // Settle bets in userStore (Prepaid Burn Model: creditBalance = false)
      try {
        settleRoundBets(roundId, w, CARDS[w].name, false);
        settleTicketsForRound(roundId, w, CARDS[w].name);
        const updated = getActiveUser();
        setActiveUser(updated);
        setAgentBalance(updated.balance);
      } catch (e) {
        console.error(e);
      }

      playVictoryFanfare();
    }
  }, [phase, roundNumber, forcedWinner, bets, totalTurnover, totalPayouts, soundEnabled]);

  // Immediate live override if admin locks a winner at any time during select or result phase
  useEffect(() => {
    const adminPick = forcedWinnerRef.current !== null ? forcedWinnerRef.current : forcedWinner;
    if (adminPick !== null && adminPick >= 0 && adminPick < 12) {
      if (phase === "select" || phase === "result") {
        setWinner(adminPick);
        const prize = (bets[adminPick] ?? 0) * PAYOUT;
        setWon(prize);
      }
    }
  }, [forcedWinner, phase, bets]);

  // Safety net: ensure winner is never null when entering result phase
  useEffect(() => {
    if (phase === "result" && winner === null) {
      const adminPick = forcedWinnerRef.current !== null ? forcedWinnerRef.current : forcedWinner;
      const w = adminPick !== null && adminPick >= 0 && adminPick < 12 ? adminPick : 0;
      setWinner(w);
      setWon((bets[w] ?? 0) * PAYOUT);
    }
  }, [phase, winner, forcedWinner, bets]);

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

  // User / Operator places bet by clicking cards
  const place = (i: number) => {
    if (phase !== "bet" || activeUser.balance < stake) return;
    const nextAgentBalance = activeUser.balance - stake;
    const nextTurnover = totalTurnover + stake;
    const newBets = { ...bets, [i]: (bets[i] ?? 0) + stake };
    const nextProfit = nextTurnover - totalPayouts;
    const nextProfitPct = nextTurnover > 0 ? Math.round((nextProfit / nextTurnover) * 100) : 100;

    // Record bet under active user
    try {
      recordUserBet(activeUser.id, {
        roundId,
        roundNumber,
        cardIndex: i,
        cardName: CARDS[i].name,
        stake,
      });
      const updated = getActiveUser();
      setActiveUser(updated);
    } catch (e) {
      console.error(e);
    }

    setAgentBalance(nextAgentBalance);
    setBets(newBets);
    setTotalTurnover(nextTurnover);
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
      forcedWinner,
      agentBalance: nextAgentBalance,
      totalTurnover: nextTurnover,
      totalPayouts,
      houseProfit: nextProfit,
      profitPercentage: nextProfitPct,
    });
  };

  // Counter POS Terminal: Parchi Booking & Print Handler
  const handlePosBetPlaced = (
    betsDelta: Record<number, number>,
    totalBet: number,
    ticket: ThermalTicket
  ) => {
    const nextAgentBalance = Math.max(0, agentBalance - totalBet);
    const nextTurnover = totalTurnover + totalBet;

    const nextBets = { ...bets };
    Object.entries(betsDelta).forEach(([idx, amt]) => {
      const cardNum = Number(idx);
      nextBets[cardNum] = (nextBets[cardNum] || 0) + amt;

      try {
        recordUserBet(activeUser.id, {
          roundId,
          roundNumber,
          cardIndex: cardNum,
          cardName: CARDS[cardNum]?.name || `Card ${cardNum}`,
          stake: amt,
        });
      } catch (e) {
        console.error(e);
      }
    });

    const nextProfit = nextTurnover - totalPayouts;
    const nextProfitPct = nextTurnover > 0 ? Math.round((nextProfit / nextTurnover) * 100) : 100;

    setAgentBalance(nextAgentBalance);
    setBets(nextBets);
    setTotalTurnover(nextTurnover);
    setPool((p) => p + totalBet);

    const updatedUser = getActiveUser();
    setActiveUser(updatedUser);

    playBeep(720, 0.08, "sine");

    // Immediately push update to Admin Panel
    hostSyncRef.current?.broadcast({
      type: "SYNC_FROM_TV",
      roundNumber,
      roundId,
      phase,
      t,
      bets: nextBets,
      pool: pool + totalBet,
      winner,
      forcedWinner,
      agentBalance: nextAgentBalance,
      totalTurnover: nextTurnover,
      totalPayouts,
      houseProfit: nextProfit,
      profitPercentage: nextProfitPct,
    });
  };

  const hurry = phase === "bet" && t <= 5;
  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0);
  const total = phase === "bet" ? BET_DURATION : phase === "select" ? SELECT_DURATION : RESULT_DURATION;

  return (
    <main
      className={`relative h-screen max-h-screen w-full overflow-hidden bg-background text-foreground flex flex-col md:flex-row ${hurry ? "shadow-[inset_0_0_90px_rgba(239,68,68,0.35)]" : ""
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

            {/* Big Screen Quick Actions: Sound & Fullscreen & Admin */}
            <div className="flex items-center gap-1">
              <a
                href="/admin"
                title="Admin Control & User Accounts Panel"
                className="p-1.5 rounded-lg text-xs font-bold transition border bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
              >
                ⚙️
              </a>
              <button
                onClick={toggleSound}
                title={soundEnabled ? "Mute Sound" : "Enable Sound FX"}
                className={`p-1.5 rounded-lg text-xs font-bold transition border ${soundEnabled ? "bg-primary/20 border-primary text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"
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

          {/* Active Player Account & Wallet Balance Status */}
          <div className="rounded-xl border border-border/80 bg-card/80 p-2.5 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs">👤</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
                  Player:
                </span>
                <span className="text-xs font-bold text-foreground truncate">
                  {activeUser.displayName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAllUsers(getUsers());
                  setShowUserModal(true);
                }}
                className="shrink-0 rounded-lg bg-primary/15 border border-primary/30 px-2 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/25 transition active:scale-95"
              >
                Switch Player
              </button>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border/40">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">Wallet Balance:</span>
              <div className="text-base font-display font-black text-primary flex items-center gap-1 leading-none">
                <span>🪙</span> ₹{activeUser.balance.toLocaleString("en-IN")}
              </div>
            </div>
          </div>

          {/* POS COUNTER: PUNCH BET & PRINT PARCHI BUTTON */}
          <button
            type="button"
            onClick={() => setShowPosModal(true)}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-gold text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>🖨️</span>
            <span>PUNCH BET & PRINT PARCHI</span>
          </button>

          {/* Animated Big-Screen Countdown Gauge */}
          <div
            className={`relative overflow-hidden rounded-xl border p-2.5 text-center transition-all duration-300 ${hurry
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
              className={`relative mx-auto h-14 w-14 rounded-full flex items-center justify-center ${hurry ? "timer-glow-urgent" : "timer-glow-normal"
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
                  className={`rounded-lg py-1.5 text-xs font-extrabold transition shadow-sm ${s === stake
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
              className={`px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-black tracking-wide ${hurry
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
                className={`card-tile group relative overflow-hidden rounded-xl sm:rounded-2xl border text-left transition-all duration-200 select-none h-full w-full min-h-0 flex flex-col items-center justify-center p-1 active:scale-95 ${isLit
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
      {/* ============================================================== */}
      {/* SWITCH ACTIVE PLAYER ACCOUNT MODAL                             */}
      {/* ============================================================== */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">👥</span>
                <div>
                  <h3 className="font-display text-base font-black text-foreground">
                    Switch Player Account
                  </h3>
                  <span className="text-[10px] text-muted-foreground block">
                    Choose which user places bets on this screen
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {allUsers.map((u) => {
                const isActive = u.id === activeUser.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => {
                      setActiveUserId(u.id);
                      setActiveUser(u);
                      setAgentBalance(u.balance);
                      setShowUserModal(false);
                      hostSyncRef.current?.broadcast({
                        type: "SYNC_FROM_TV",
                        roundNumber,
                        roundId,
                        phase,
                        t,
                        bets,
                        pool,
                        winner,
                        forcedWinner,
                        agentBalance: u.balance,
                        totalTurnover,
                        totalPayouts,
                        houseProfit,
                        profitPercentage,
                      });
                    }}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${isActive
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border/80 bg-background/60 hover:border-primary/40 hover:bg-background/90"
                      }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-gradient-gold grid place-items-center text-xs font-bold text-primary-foreground font-display">
                        {u.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-display text-sm font-extrabold text-foreground">
                            {u.displayName}
                          </span>
                          {isActive && (
                            <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-1.5 py-0.2 text-[8px] font-black">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground block">
                          @{u.username} {u.phone ? `• ${u.phone}` : ""}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold text-muted-foreground block">Balance</span>
                      <span className="text-sm font-display font-black text-primary">
                        ₹{u.balance.toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border/60 flex items-center justify-between">
              <a
                href="/admin"
                className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
              >
                <span>⚙️</span>
                <span>Open Full Admin Panel & Deposit</span>
              </a>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="py-1.5 px-3 rounded-xl bg-muted text-muted-foreground hover:text-foreground text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* COUNTER POS BOOKING & THERMAL PARCHI MODAL                      */}
      {/* ============================================================== */}
      <CounterPosModal
        isOpen={showPosModal}
        onClose={() => setShowPosModal(false)}
        roundId={roundId}
        roundNumber={roundNumber}
        agentBalance={agentBalance}
        onBetPlaced={handlePosBetPlaced}
        onShowSlip={(ticket) => {
          setPrintSlipTicket(ticket);
          setShowSlipModal(true);
        }}
      />

      <ThermalSlipModal
        ticket={printSlipTicket}
        isOpen={showSlipModal}
        onClose={() => setShowSlipModal(false)}
      />
    </main>
  );
}

