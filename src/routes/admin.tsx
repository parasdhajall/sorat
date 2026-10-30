import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  AdminClientSync,
  DEFAULT_ROOM_ID,
  GameMessage,
  getSynchronizedRoundState,
  analyzeCardProfitability,
} from "@/lib/realtime";
import { CARDS } from "@/lib/cards";
import {
  getUsers,
  getActiveUserId,
  UserAccount,
  getActiveUser,
} from "@/lib/userStore";
import { UserAccountsView } from "@/components/admin/UserAccountsView";
import { OverviewView } from "@/components/admin/OverviewView";
import { DatabaseSettingsView } from "@/components/admin/DatabaseSettingsView";
import { getSupabaseConfig } from "@/lib/supabase";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Sorat — Live Admin Controller & User Accounts Manager" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

const MASTER_PIN = "1234";
const PAYOUT_MULTIPLIER = 10;

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  // Active Admin Tab: "users" (DEFAULT) | "game" | "database" | "overview"
  const [activeAdminTab, setActiveAdminTab] = useState<"users" | "game" | "database" | "overview">("users");

  // User Accounts State
  const [users, setUsers] = useState<UserAccount[]>(() => getUsers());

  const reloadUsers = useCallback(() => {
    setUsers([...getUsers()]);
  }, []);

  const [roomId] = useState(DEFAULT_ROOM_ID);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");

  // Synchronized live state identical to User Screen
  const initialSync = getSynchronizedRoundState();
  const [roundNumber, setRoundNumber] = useState(initialSync.roundNumber);
  const [roundId, setRoundId] = useState(initialSync.roundId);
  const [phase, setPhase] = useState<"bet" | "select" | "result">(initialSync.phase);
  const [timer, setTimer] = useState(initialSync.timeLeft);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [lastWinner, setLastWinner] = useState<number | null>(null);

  // Agent Wallet & Business Model Financials
  const [agentBalance, setAgentBalance] = useState(() => {
    const active = getActiveUser();
    return active ? active.balance : 1000;
  });
  const [totalTurnover, setTotalTurnover] = useState(0);
  const [totalPayouts, setTotalPayouts] = useState(0);
  const [houseProfit, setHouseProfit] = useState(0);
  const [profitPercentage, setProfitPercentage] = useState(100);

  // Admin Manual Override
  const [forcedWinner, setForcedWinner] = useState<number | null>(null);
  const [customBalanceInput, setCustomBalanceInput] = useState("");

  const clientSyncRef = useRef<AdminClientSync | null>(null);
  const tvMasterSyncRef = useRef<{
    t: number;
    receivedAt: number;
    phase: string;
    roundNumber: number;
  } | null>(null);

  // Check stored auth session
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("sorat_admin_auth");
      if (stored === "true") setIsAuthenticated(true);
    }
  }, []);

  // Listen for storage events for user synchronization
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sorat_users_v2" || e.key === "sorat_users_last_sync") {
        reloadUsers();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [reloadUsers]);

  // Synchronized Game Clock Ticker
  useEffect(() => {
    const updateTick = () => {
      if (tvMasterSyncRef.current) {
        const elapsedSec = Math.floor((Date.now() - tvMasterSyncRef.current.receivedAt) / 1000);
        const currentT = Math.max(0, tvMasterSyncRef.current.t - elapsedSec);
        setTimer(currentT);
        setPhase(tvMasterSyncRef.current.phase as any);
        setRoundNumber(tvMasterSyncRef.current.roundNumber);
        setRoundId(`#${String(tvMasterSyncRef.current.roundNumber).padStart(4, "0")}`);
      } else {
        const sync = getSynchronizedRoundState();
        setTimer(sync.timeLeft);
        setPhase(sync.phase);
        setRoundNumber(sync.roundNumber);
        setRoundId(sync.roundId);
      }
    };

    updateTick();
    const id = setInterval(updateTick, 250);
    return () => clearInterval(id);
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

  // Connect to User Screen via Cloud PubSub + Local Broadcast
  useEffect(() => {
    if (!isAuthenticated) return;

    const client = new AdminClientSync(roomId);
    clientSyncRef.current = client;

    client.onStatusChange = (status) => {
      setConnectionStatus(status);
    };

    client.onMessage = (msg: GameMessage) => {
      if (msg.type === "SYNC_FROM_TV") {
        tvMasterSyncRef.current = {
          t: msg.t,
          receivedAt: Date.now(),
          phase: msg.phase,
          roundNumber: msg.roundNumber,
        };
        setPhase(msg.phase);
        setTimer(msg.t);
        setRoundNumber(msg.roundNumber);
        setRoundId(msg.roundId);
        setBets(msg.bets || {});
        if (msg.winner !== null) setLastWinner(msg.winner);
        setForcedWinner(msg.forcedWinner);
        setAgentBalance(msg.agentBalance ?? 1000);
        setTotalTurnover(msg.totalTurnover ?? 0);
        setTotalPayouts(msg.totalPayouts ?? 0);
        setHouseProfit(msg.houseProfit ?? 0);
        setProfitPercentage(msg.profitPercentage ?? 100);
        // Refresh users when TV syncs
        reloadUsers();
      }
    };

    client.connect();

    return () => {
      client.destroy();
    };
  }, [isAuthenticated, roomId, reloadUsers]);

  // Handle active user sync from UserAccountsView
  const handleActiveUserSync = (userId: string, balance: number) => {
    setAgentBalance(balance);
    clientSyncRef.current?.send({ type: "SET_AGENT_BALANCE", balance });
    clientSyncRef.current?.send({ type: "SWITCH_ACTIVE_USER", userId });
  };

  // Admin locks/unlocks manual winner
  const handleSelectWinner = (cardIdx: number) => {
    if (forcedWinner === cardIdx) {
      // Toggle off / cancel override
      setForcedWinner(null);
      clientSyncRef.current?.send({ type: "FORCE_WINNER", card: null });
    } else {
      setForcedWinner(cardIdx);
      clientSyncRef.current?.send({ type: "FORCE_WINNER", card: cardIdx });
      // Re-send once after 100ms to guarantee zero packet loss
      setTimeout(() => {
        clientSyncRef.current?.send({ type: "FORCE_WINNER", card: cardIdx });
      }, 100);
    }
  };

  const handleClearForcedWinner = () => {
    setForcedWinner(null);
    clientSyncRef.current?.send({ type: "FORCE_WINNER", card: null });
  };

  // Wallet Balance Controls
  const handleSetExactBalance = (val?: number) => {
    const target = val !== undefined ? val : Number(customBalanceInput.trim());
    if (isNaN(target) || target < 0) {
      alert("Kripya valid amount enter karein!");
      return;
    }
    setAgentBalance(target);
    clientSyncRef.current?.send({ type: "SET_AGENT_BALANCE", balance: target });
    setCustomBalanceInput("");
  };

  const handleRechargeAgent = (amount: number) => {
    const next = agentBalance + amount;
    setAgentBalance(next);
    clientSyncRef.current?.send({ type: "RECHARGE_AGENT", amount });
  };

  const handleResetFinancials = () => {
    if (confirm("Are you sure? Total Turnover aur Payouts stats 0 ho jayenge.")) {
      setTotalTurnover(0);
      setTotalPayouts(0);
      setHouseProfit(0);
      setProfitPercentage(100);
      clientSyncRef.current?.send({ type: "RESET_FINANCIALS" });
    }
  };

  const handleTriggerSpin = () => {
    clientSyncRef.current?.send({ type: "TRIGGER_SPIN" });
  };

  const handleClearBets = () => {
    if (confirm("Round ke saare bets clear karne hain?")) {
      clientSyncRef.current?.send({ type: "CLEAR_ALL_BETS" });
      setBets({});
    }
  };

  // Calculations
  const totalUserBets = Object.values(bets).reduce((a, b) => a + b, 0);
  const betAmounts = Object.values(bets);
  const maxBetAmount = betAmounts.length > 0 ? Math.max(...betAmounts, 0) : 0;

  // 30% Profitability Analysis on all 12 cards
  const profitAnalysis = analyzeCardProfitability(bets, totalTurnover, totalPayouts);
  const analysisMap = new Map(profitAnalysis.map((a) => [a.card, a]));

  // PIN Lock Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-gold grid place-items-center text-primary-foreground font-display text-xl mb-4 shadow-gold">
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
      {/* HEADER WITH REALTIME STATUS & TAB SWITCHER                     */}
      {/* ============================================================== */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md px-3.5 py-2.5 shadow-lg space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg tracking-wide text-primary">ADMIN CONTROL</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 border border-primary/50 px-2 py-0.5 text-xs font-mono font-black text-primary shadow-sm tracking-wide">
              🎰 ROUND {roundId}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md border border-border bg-muted/80 text-foreground hover:bg-accent transition"
            >
              📺 Open TV Display
            </a>

            <button
              onClick={() => setActiveAdminTab("database")}
              className={`flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md border ${
                getSupabaseConfig().isConfigured
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : "bg-blue-500/15 border-blue-500/40 text-blue-400"
              }`}
            >
              <span>🗄️</span>
              <span>{getSupabaseConfig().isConfigured ? "SUPABASE" : "LOCAL DB"}</span>
            </button>

            <span
              className={`flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md border ${
                connectionStatus === "connected"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : "bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connectionStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {connectionStatus === "connected" ? "TV SYNCED" : "CONNECTING"}
            </span>

            <span
              className={`text-xs font-mono font-black px-2.5 py-1 rounded-md border ${
                phase === "bet"
                  ? timer <= 5
                    ? "bg-destructive/20 text-destructive border-destructive/40 animate-pulse"
                    : "bg-primary/20 text-primary border-primary/40"
                  : phase === "select"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse"
                  : "bg-purple-500/20 text-purple-400 border-purple-500/40"
              }`}
            >
              {phase === "bet"
                ? `⏳ ${timer}s`
                : phase === "select"
                ? `⚡ ${timer}s SPIN`
                : `🏆 ${timer}s WIN`}
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

        {/* PRIMARY NAVIGATION TABS */}
        <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl border border-border/70 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveAdminTab("users")}
            className={`flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg text-xs font-display font-extrabold transition whitespace-nowrap ${
              activeAdminTab === "users"
                ? "bg-primary text-primary-foreground shadow-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>👥</span>
            <span>MANAGE USER ACCOUNTS ({users.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveAdminTab("game")}
            className={`flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg text-xs font-display font-extrabold transition whitespace-nowrap ${
              activeAdminTab === "game"
                ? "bg-primary text-primary-foreground shadow-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>🎰</span>
            <span>GAME ROOM & 30% PROFIT VAULT</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveAdminTab("database")}
            className={`flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg text-xs font-display font-extrabold transition whitespace-nowrap ${
              activeAdminTab === "database"
                ? "bg-primary text-primary-foreground shadow-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>🗄️</span>
            <span>DATABASE & SUPABASE</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveAdminTab("overview")}
            className={`flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg text-xs font-display font-extrabold transition whitespace-nowrap ${
              activeAdminTab === "overview"
                ? "bg-primary text-primary-foreground shadow-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>📊</span>
            <span>ALL PLAYERS LEDGER & AUDIT</span>
          </button>
        </div>
      </header>

      {/* ============================================================== */}
      {/* TAB CONTENT                                                    */}
      {/* ============================================================== */}
      <main className="p-3 max-w-7xl mx-auto">
        {/* TAB 1: USER ACCOUNTS MANAGER */}
        {activeAdminTab === "users" && (
          <UserAccountsView
            users={users}
            onUsersChange={reloadUsers}
            onActiveUserSync={handleActiveUserSync}
          />
        )}

        {/* TAB 2: GAME ROOM & 30% PROFIT VAULT */}
        {activeAdminTab === "game" && (
          <div className="space-y-3">
            {/* Quick Agent Wallet bar */}
            <div className="rounded-xl border border-border/80 bg-card p-3 space-y-2.5 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🪙</span>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block leading-tight">
                      Active TV / Agent Live Wallet Balance
                    </span>
                    <span className="text-2xl font-display font-black text-primary leading-tight">
                      ₹{agentBalance.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>

                {/* Quick Top-Up Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Quick Add:</span>
                  <button
                    onClick={() => handleRechargeAgent(100)}
                    className="py-1 px-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-bold transition active:scale-95"
                  >
                    +₹100
                  </button>
                  <button
                    onClick={() => handleRechargeAgent(500)}
                    className="py-1 px-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-bold transition active:scale-95"
                  >
                    +₹500
                  </button>
                  <button
                    onClick={() => handleRechargeAgent(1000)}
                    className="py-1 px-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 text-xs font-black transition active:scale-95"
                  >
                    +₹1,000
                  </button>
                  <button
                    onClick={() => handleRechargeAgent(5000)}
                    className="py-1 px-2.5 rounded-lg bg-emerald-500/25 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/35 text-xs font-black transition active:scale-95"
                  >
                    +₹5,000
                  </button>
                </div>
              </div>

              {/* Direct Custom Amount Set / Add Input */}
              <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={customBalanceInput}
                    onChange={(e) => setCustomBalanceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSetExactBalance();
                    }}
                    placeholder="Specific amount enter karein (e.g. 2000, 5000)"
                    className="w-full pl-7 pr-3 py-1.5 rounded-xl border border-input bg-background text-foreground font-mono text-xs focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSetExactBalance()}
                    className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black transition hover:opacity-90 shadow-sm"
                  >
                    SET EXACT BALANCE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = Number(customBalanceInput.trim());
                      if (isNaN(val) || val <= 0) {
                        alert("Kripya valid add amount enter karein!");
                        return;
                      }
                      handleRechargeAgent(val);
                      setCustomBalanceInput("");
                    }}
                    className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-muted border border-border text-foreground hover:bg-accent font-display text-xs font-bold transition"
                  >
                    + ADD TO WALLET
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetExactBalance(1000)}
                    title="Reset wallet to default ₹1,000"
                    className="py-1.5 px-2 rounded-xl bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25 text-xs font-bold transition"
                  >
                    Reset ₹1k
                  </button>
                </div>
              </div>
            </div>

            {/* 30% PROFIT VAULT FINANCIAL METRICS */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5">
              <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-border/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🛡️</span>
                  <span className="text-[11px] font-black uppercase tracking-wider text-primary">
                    30% Guaranteed Profit Vault
                  </span>
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.2 text-[9px] font-black text-emerald-400">
                    ACTIVE
                  </span>
                </div>
                <button
                  onClick={handleResetFinancials}
                  title="Reset Cumulative Turnover & Payouts"
                  className="text-[10px] text-muted-foreground hover:text-destructive underline font-bold"
                >
                  Reset Stats
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="rounded-lg bg-background/80 p-1.5 border border-border/60">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">Round Bets</span>
                  <span className="text-sm font-display font-black text-primary">₹{totalUserBets}</span>
                </div>
                <div className="rounded-lg bg-background/80 p-1.5 border border-border/60">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">Total Turnover</span>
                  <span className="text-sm font-display font-black text-foreground">
                    ₹{totalTurnover.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="rounded-lg bg-background/80 p-1.5 border border-border/60">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">Player Payouts</span>
                  <span className="text-sm font-display font-black text-destructive">
                    ₹{totalPayouts.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="rounded-lg bg-background/80 p-1.5 border border-border/60">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">House Profit</span>
                  <span
                    className={`text-sm font-display font-black ${
                      houseProfit >= 0 ? "text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {profitPercentage}% (₹{houseProfit.toLocaleString("en-IN")})
                  </span>
                </div>
              </div>
            </div>

            {/* Active Locked Winner Alert Banner */}
            {forcedWinner !== null && (
              <div className="rounded-xl bg-amber-500/25 border-2 border-amber-400 p-2.5 text-center flex items-center justify-between shadow-[0_0_20px_rgba(245,158,11,0.35)] animate-pulse">
                <div className="flex items-center gap-2 text-left">
                  <span className="text-xl">👑</span>
                  <div>
                    <span className="text-xs font-black text-amber-300 block uppercase tracking-wide">
                      ADMIN OVERRIDE: {CARDS[forcedWinner]?.name}
                    </span>
                    <span className="text-[10px] text-amber-200/90 font-bold block">
                      Yeh card 100% jeetega iss round me!
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleClearForcedWinner}
                  className="text-[10px] bg-destructive text-destructive-foreground px-2.5 py-1 rounded-lg font-black uppercase tracking-wider hover:opacity-90 shadow-sm"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* 12-Card Live Bet Monitor & 30% Profitability Grid */}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Card Bets & 30% Safety Status (10x Payout):
              </span>
              <span className="text-[10px] font-bold text-emerald-400">
                🔒 Auto picks Safe/0-Bet cards
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {CARDS.map((c, i) => {
                const userBet = bets[i] ?? 0;
                const payout = userBet * PAYOUT_MULTIPLIER;
                const netHousePL = totalUserBets - payout;
                const isHighest = userBet > 0 && userBet === maxBetAmount;
                const isWinnerSelected = forcedWinner === i;

                const cardInfo = analysisMap.get(i);
                const isSafe = cardInfo?.isSafe ?? true;

                return (
                  <div
                    key={i}
                    onClick={() => handleSelectWinner(i)}
                    className={`relative rounded-2xl border p-2.5 transition active:scale-95 cursor-pointer flex flex-col justify-between ${
                      isWinnerSelected
                        ? "border-amber-400 bg-amber-500/20 ring-4 ring-amber-400/80 shadow-[0_0_25px_rgba(251,191,36,0.5)] z-20"
                        : isHighest
                        ? "border-destructive/80 bg-destructive/10 ring-2 ring-destructive/40 shadow-sm"
                        : !isSafe && userBet > 0
                        ? "border-destructive/40 bg-card/60 opacity-90"
                        : userBet > 0
                        ? "border-primary/80 bg-primary/10 shadow-sm"
                        : "border-border/80 bg-card hover:border-border"
                    }`}
                  >
                    {/* Header row: Card Name + 30% Profit Status Badge */}
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-extrabold text-foreground">{c.name}</span>
                      {userBet === 0 ? (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                          ⭐ 100% PROFIT
                        </span>
                      ) : isSafe ? (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          🟢 SAFE (≥30%)
                        </span>
                      ) : (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider bg-destructive/20 text-destructive border border-destructive/40">
                          🚫 BLOCKED (&lt;30%)
                        </span>
                      )}
                    </div>

                    {/* Card Image Thumbnail + User Bet Info */}
                    <div className="flex items-center gap-2.5 my-2">
                      <img
                        src={c.img}
                        alt={c.name}
                        className="h-12 w-12 rounded-xl object-cover border border-border shrink-0 shadow-sm"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block leading-tight">
                          Round Bet:
                        </span>
                        <span
                          className={`text-lg font-display font-black leading-tight ${
                            isHighest ? "text-destructive" : userBet > 0 ? "text-primary" : "text-muted-foreground/60"
                          }`}
                        >
                          🪙 ₹{userBet}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground block leading-none mt-0.5">
                          Payout: ₹{payout}
                        </span>
                      </div>
                    </div>

                    {/* P&L Analysis */}
                    <div className="pt-1.5 border-t border-border/50 flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Round PL:</span>
                      <span
                        className={`font-mono font-extrabold ${
                          netHousePL > 0 ? "text-emerald-400" : netHousePL < 0 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {netHousePL >= 0 ? `+₹${netHousePL}` : `-₹${Math.abs(netHousePL)}`}
                      </span>
                    </div>

                    {/* Bottom One-Tap Force Winner Button */}
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
                      <span>{isWinnerSelected ? "👑 100% JEETEGA (LOCKED)" : "🏆 FORCE WIN"}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: SUPABASE DATABASE & CLOUD SYNC */}
        {activeAdminTab === "database" && (
          <DatabaseSettingsView onSyncComplete={reloadUsers} />
        )}

        {/* TAB 4: ALL PLAYERS AUDIT OVERVIEW */}
        {activeAdminTab === "overview" && (
          <OverviewView
            users={users}
            totalTurnover={totalTurnover}
            totalPayouts={totalPayouts}
            houseProfit={houseProfit}
            profitPercentage={profitPercentage}
            onSelectUser={(userId) => {
              setActiveAdminTab("users");
            }}
          />
        )}
      </main>

      {/* ============================================================== */}
      {/* BOTTOM ACTION BAR (FOR LIVE GAME CONTROLS)                      */}
      {/* ============================================================== */}
      {activeAdminTab === "game" && (
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
      )}
    </div>
  );
}
