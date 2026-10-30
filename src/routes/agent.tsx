import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  AdminClientSync,
  DEFAULT_ROOM_ID,
  GameMessage,
  getSynchronizedRoundState,
} from "@/lib/realtime";
import { CARDS } from "@/lib/cards";
import {
  createTicket,
  getTickets,
  claimTicket,
  settleTicketsForRound,
  ThermalTicket,
  BetItem,
} from "@/lib/ticketStore";
import {
  getActiveUser,
  getLoggedInAgent,
  setLoggedInAgent,
  authenticateAgent,
  recordUserBet,
  getUsers,
  settleRoundBets,
  UserAccount,
} from "@/lib/userStore";
import { ThermalSlipModal } from "@/components/pos/ThermalSlipModal";
import { PrinterSettingsModal } from "@/components/pos/PrinterSettingsModal";
import {
  executeDirectPrint,
  isDirectPrinterConnected,
} from "@/lib/thermalPrinter";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "Sorat — Agent Counter POS Booking App" },
      { name: "description", content: "Mobile Counter POS App for Agent Booking & Thermal Printing" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" },
    ],
  }),
  component: AgentPage,
});

export default function AgentPage() {
  const initialSync = getSynchronizedRoundState();
  const [roundNumber, setRoundNumber] = useState(initialSync.roundNumber);
  const [roundId, setRoundId] = useState(initialSync.roundId);
  const [phase, setPhase] = useState<"bet" | "select" | "result">(initialSync.phase);
  const [timer, setTimer] = useState(initialSync.timeLeft);

  // Agent Authentication State
  const [loggedInAgent, setLoggedInAgentState] = useState<UserAccount | null>(() => getLoggedInAgent());
  const [loginIdInput, setLoginIdInput] = useState("");
  const [loginPinInput, setLoginPinInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  // Active User / Agent Wallet Balance
  const [agentUser, setAgentUser] = useState<UserAccount>(() => getLoggedInAgent() || getActiveUser());
  const [agentBalance, setAgentBalance] = useState<number>(() => {
    const u = getLoggedInAgent() || getActiveUser();
    return u ? u.balance : 1000;
  });

  // POS Booking State
  const [customerName, setCustomerName] = useState("");
  const [activeChip, setActiveChip] = useState<number>(10);
  const [selectedCards, setSelectedCards] = useState<Record<number, number>>({});
  const [ticketsList, setTicketsList] = useState<ThermalTicket[]>(() => getTickets());
  const [activeTab, setActiveTab] = useState<"punch" | "tickets" | "shift" | "printer">("punch");

  // Print Slip State
  const [printTicket, setPrintTicket] = useState<ThermalTicket | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [printerName, setPrinterName] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("sorat_printer_name") || "POS-58" : "POS-58"
  );

  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  const clientSyncRef = useRef<AdminClientSync | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Detect standalone PWA mode
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isStandaloneMode = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone;
      setIsStandalone(Boolean(isStandaloneMode));

      const handler = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  // Sync Timer
  useEffect(() => {
    const id = setInterval(() => {
      const sync = getSynchronizedRoundState();
      setRoundNumber(sync.roundNumber);
      setRoundId(sync.roundId);
      setPhase(sync.phase);
      setTimer(sync.timeLeft);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Sync Storage
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === "sorat_users_v2" ||
        e.key === "sorat_active_user_id_v2" ||
        e.key === "sorat_logged_in_agent_id_v1"
      ) {
        const u = getLoggedInAgent() || getActiveUser();
        setLoggedInAgentState(getLoggedInAgent());
        setAgentUser(u);
        setAgentBalance(u.balance);
      }
      if (e.key === "sorat_thermal_tickets_v1") {
        setTicketsList(getTickets());
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Realtime Sync with TV Screen
  useEffect(() => {
    const client = new AdminClientSync(DEFAULT_ROOM_ID);
    clientSyncRef.current = client;

    client.onMessage = (msg: GameMessage) => {
      if (msg.type === "SYNC_FROM_TV") {
        setRoundNumber(msg.roundNumber);
        setRoundId(msg.roundId);
        setPhase(msg.phase);
        setTimer(msg.t);
        if (msg.winner !== null && msg.phase === "result") {
          // Settle tickets locally
          settleTicketsForRound(msg.roundId, msg.winner, CARDS[msg.winner]?.name || "");
          setTicketsList(getTickets());
        }
      } else if (msg.type === "SET_AGENT_BALANCE") {
        setAgentBalance(msg.balance);
      } else if (msg.type === "RECHARGE_AGENT") {
        setAgentBalance((b) => b + msg.amount);
      }
    };

    client.connect();
    return () => client.destroy();
  }, []);

  const totalTicketStake = Object.values(selectedCards).reduce((a, b) => a + b, 0);
  const isBalanceEnough = agentBalance >= totalTicketStake;

  const handleCardClick = (cardIdx: number) => {
    if (phase !== "bet") return;
    setSelectedCards((prev) => ({
      ...prev,
      [cardIdx]: (prev[cardIdx] || 0) + activeChip,
    }));
  };

  const handleClearCard = (cardIdx: number) => {
    setSelectedCards((prev) => {
      const next = { ...prev };
      delete next[cardIdx];
      return next;
    });
  };

  const handleClearAll = () => {
    setSelectedCards({});
  };

  // Punch Bet & Trigger Thermal Print
  const handlePunchAndPrint = () => {
    if (phase !== "bet") {
      alert("Betting is currently closed for this round!");
      return;
    }

    if (totalTicketStake <= 0) {
      alert("Kripya kam se kam ek card par daav chunein!");
      return;
    }

    if (!isBalanceEnough) {
      alert(`Balance kam hai! Needed: ₹${totalTicketStake}, Available: ₹${agentBalance}. Kripya counter recharge karein!`);
      return;
    }

    // 1. Prepare Bet Items
    const items: BetItem[] = Object.entries(selectedCards).map(([idx, amt]) => ({
      cardIndex: Number(idx),
      cardName: CARDS[Number(idx)]?.name || `Card ${idx}`,
      amount: amt,
    }));

    // 2. Create Ticket
    const newTicket = createTicket({
      roundId,
      roundNumber,
      customerName: customerName.trim() || undefined,
      agentName: agentUser.displayName || "Counter Kiosk",
      items,
    });

    // 3. Deduct from agent wallet (Prepaid Burn model)
    const nextBalance = Math.max(0, agentBalance - totalTicketStake);
    setAgentBalance(nextBalance);

    // 4. Record bets in userStore & broadcast to TV and Admin
    Object.entries(selectedCards).forEach(([idx, amt]) => {
      const cardNum = Number(idx);
      try {
        recordUserBet(agentUser.id, {
          roundId,
          roundNumber,
          cardIndex: cardNum,
          cardName: CARDS[cardNum]?.name || `Card ${cardNum}`,
          stake: amt,
        });
      } catch {}

      // Send to TV Screen
      clientSyncRef.current?.send({
        type: "ADD_BET",
        card: cardNum,
        amount: amt,
      });
    });

    // Refresh tickets
    setTicketsList(getTickets());
    setSelectedCards({});
    setCustomerName("");

    // 5. Direct Thermal Print or Preview Slip
    setPrintTicket(newTicket);
    const paperWidth = ((typeof window !== "undefined" && localStorage.getItem("sorat_printer_width")) as any) || "58mm";
    const autoPrint = typeof window !== "undefined" && localStorage.getItem("sorat_auto_print") !== "false";

    if (autoPrint && isDirectPrinterConnected()) {
      executeDirectPrint(newTicket, paperWidth);
    } else {
      setShowSlipModal(true);
    }
  };

  const handleClaimPrize = (ticketId: string) => {
    const updated = claimTicket(ticketId);
    if (updated) {
      setTicketsList(getTickets());
      alert(`Ticket #${ticketId} prize of ₹${updated.winningPayout} marked as PAID! Customer ko cash de dijiye.`);
    }
  };

  const handleTestPrint = () => {
    const testTkt: ThermalTicket = {
      id: "TEST-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
      dateStr: new Date().toISOString().split("T")[0],
      timeStr: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      roundId,
      roundNumber,
      agentId: agentUser.id,
      agentName: agentUser.displayName,
      customerName: "PRINTER TEST SLIP",
      items: [
        { cardIndex: 0, cardName: "पतंग (TEST OK)", stake: 10, potentialPayout: 100 },
        { cardIndex: 11, cardName: "गाय (TEST OK)", stake: 10, potentialPayout: 100 },
      ],
      totalStake: 20,
      totalAmount: 20,
      maxPotentialPayout: 100,
      isWinner: false,
      isClaimed: false,
      status: "SETTLED",
    };
    const paperWidth = ((typeof window !== "undefined" && localStorage.getItem("sorat_printer_width")) as any) || "58mm";
    if (isDirectPrinterConnected()) {
      executeDirectPrint(testTkt, paperWidth);
    } else {
      setPrintTicket(testTkt);
      setShowSlipModal(true);
    }
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const res = authenticateAgent(loginIdInput, loginPinInput);
    if (res.success && res.user) {
      setLoggedInAgentState(res.user);
      setAgentUser(res.user);
      setAgentBalance(res.user.balance);
    } else {
      setLoginError(res.error || "Login fail! Sahi Agent ID aur 4-digit PIN daalein.");
    }
  };

  const handleLogout = () => {
    if (confirm("Kya aap counter se logout karna chahte hain?")) {
      setLoggedInAgent(null);
      setLoggedInAgentState(null);
      setLoginPinInput("");
    }
  };

  // Shift Stats
  const todayTickets = ticketsList.filter((t) => t.dateStr === initialSync.roundId || true);
  const totalSalesToday = ticketsList.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalPayoutsToday = ticketsList.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
  const agentCommission10 = Math.round(totalSalesToday * 0.10);

  // =========================================================================
  // IF NOT LOGGED IN: DISPLAY AGENT ID & PIN LOGIN SCREEN
  // =========================================================================
  if (!loggedInAgent) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-4 max-w-md mx-auto select-none">
        <div className="w-full bg-card/95 border border-primary/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md space-y-6">
          <div className="text-center space-y-2">
            <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-gold grid place-items-center font-display text-3xl font-black text-primary-foreground shadow-gold">
              S
            </div>
            <h1 className="font-display text-2xl font-black tracking-wide text-foreground">
              SORAT AGENT POS
            </h1>
            <p className="text-xs text-muted-foreground font-medium">
              Counter Booking & Thermal Printer App
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-bold font-mono">
              <span>🎰 Live Round:</span> {roundId} • <span>{timer}s</span>
            </div>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Agent ID / Username / Phone
              </label>
              <input
                type="text"
                required
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value)}
                placeholder="Jaise agent1, agent2 ya Mobile No."
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
              <span>🔐</span>
              <span>LOGIN & OPEN COUNTER</span>
            </button>
          </form>

          {/* Quick Demo Test Buttons */}
          <div className="border-t border-border/80 pt-4 space-y-2 text-center">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest block">
              Quick Test / Demo Login
            </span>
            <div className="grid grid-cols-3 gap-2">
              {getUsers().slice(0, 3).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setLoginIdInput(u.username);
                    setLoginPinInput(u.pin || "1234");
                    const res = authenticateAgent(u.username, u.pin || "1234");
                    if (res.success && res.user) {
                      setLoggedInAgentState(res.user);
                      setAgentUser(res.user);
                      setAgentBalance(res.user.balance);
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between max-w-md mx-auto border-x border-border/60 shadow-2xl select-none">
      {/* ============================================================== */}
      {/* AGENT APP TOP HEADER                                           */}
      {/* ============================================================== */}
      <header className="sticky top-0 z-30 bg-card/95 backdrop-blur-md border-b border-border p-3 shadow-md space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-gold grid place-items-center font-display text-sm font-black text-primary-foreground shadow-gold">
              S
            </div>
            <div>
              <span className="font-display text-sm font-black text-foreground tracking-wide block leading-tight">
                SORAT AGENT POS
              </span>
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block leading-tight">
                Counter Booking App
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="rounded-lg bg-primary/20 border border-primary/40 px-2 py-0.5 text-xs font-mono font-black text-primary">
              🎰 {roundId}
            </span>

            <span
              className={`text-xs font-mono font-black px-2 py-0.5 rounded-lg border ${
                phase === "bet"
                  ? timer <= 5
                    ? "bg-destructive/20 text-destructive border-destructive/40 animate-pulse"
                    : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/40"
              }`}
            >
              {phase === "bet" ? `⏳ ${timer}s` : `⚡ ${timer}s RESULT`}
            </span>

            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs"
              title="Open TV Arena"
            >
              📺
            </a>

            <button
              type="button"
              onClick={() => {
                setActiveTab("printer");
                setShowPrinterModal(true);
              }}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/25 border border-emerald-400 text-emerald-300 hover:bg-emerald-500/35 text-xs font-black transition flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Thermal Printer Setup & Bluetooth Connect"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>🖨️</span>
              <span className="text-[11px] font-bold">Printer</span>
            </button>
          </div>
        </div>

        {/* Counter Balance Status Card */}
        <div className="flex items-center justify-between rounded-xl bg-background/80 border border-border/80 px-3 py-2 shadow-inner">
          <div>
            <span className="text-[9px] uppercase font-bold text-muted-foreground block">
              Counter Live Balance
            </span>
            <div className="text-xl font-display font-black text-primary leading-none mt-0.5 flex items-center gap-1">
              <span>🪙</span> ₹{agentBalance.toLocaleString("en-IN")}
            </div>
          </div>

          <div className="text-right flex items-center gap-2">
            <div>
              <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                Agent / Counter
              </span>
              <span className="text-xs font-bold text-foreground truncate max-w-[120px] block">
                {agentUser.displayName}
              </span>
              <span className="text-[10px] font-mono text-primary font-black block">
                ID: {agentUser.username}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="p-1.5 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive border border-destructive/30 text-xs font-bold transition flex items-center gap-1"
              title="Logout from counter"
            >
              <span>🚪</span>
              <span className="text-[10px]">Exit</span>
            </button>
          </div>
        </div>

        {/* PWA App Install Banner */}
        {!isStandalone && (
          <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-amber-500/20 via-primary/15 to-amber-500/10 border border-primary/30 px-3 py-1.5 shadow-sm text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">📲</span>
              <div>
                <span className="font-bold text-foreground block text-[11px] leading-tight">
                  Phone me App Install Karein
                </span>
                <span className="text-[9px] text-muted-foreground block leading-tight">
                  Bina browser ke screen par App icon ban jayega
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (deferredPrompt) {
                  deferredPrompt.prompt();
                  const { outcome } = await deferredPrompt.userChoice;
                  if (outcome === "accepted") setDeferredPrompt(null);
                } else {
                  alert("Apne phone me Chrome ke 3-dots (⋮) par click karein aur 'Install app' ya 'Add to Home screen' dabayein!");
                }
              }}
              className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-black text-[10px] uppercase shadow hover:brightness-110 active:scale-95 transition"
            >
              Install App
            </button>
          </div>
        )}

        {/* App Sub-Navigation Tabs */}
        <div className="grid grid-cols-4 gap-1 bg-muted/80 p-1 rounded-xl border border-border text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("punch")}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "punch"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">🎯</span>
            <span className="text-[10px] leading-tight">Bet Book</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTicketsList(getTickets());
              setActiveTab("tickets");
            }}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "tickets"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">🎟️</span>
            <span className="text-[10px] leading-tight">Tickets ({ticketsList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("shift")}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "shift"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">💼</span>
            <span className="text-[10px] leading-tight">Shift</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("printer");
              setShowPrinterModal(true);
            }}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 border ${
              activeTab === "printer"
                ? "bg-emerald-500 text-zinc-950 border-emerald-400 font-black shadow-md"
                : "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25"
            }`}
            title="Printer Connect & Bluetooth Settings"
          >
            <span className="text-sm">🖨️</span>
            <span className="text-[10px] leading-tight font-black">Printer</span>
          </button>
        </div>
      </header>

      {/* ============================================================== */}
      {/* TAB CONTENT                                                    */}
      {/* ============================================================== */}
      <main className="p-3 flex-1 overflow-y-auto space-y-3 pb-28">
        {/* TAB 1: PUNCH BETS */}
        {activeTab === "punch" && (
          <div className="space-y-3">
            {/* Thermal Printer Quick-Connect Banner */}
            <div className="flex items-center justify-between rounded-2xl bg-emerald-950/40 border border-emerald-500/40 p-2.5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 grid place-items-center text-base">
                  🖨️
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-emerald-300">
                      {printerName || "POS-58 Bluetooth"}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono font-bold">
                      READY
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 block">
                    Bluetooth Thermal Slip (58mm / 80mm)
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrinterModal(true)}
                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs uppercase shadow transition active:scale-95 flex items-center gap-1 cursor-pointer"
              >
                <span>⚙️</span> Connect
              </button>
            </div>

            {/* Customer Name & Chips Selector */}
            <div className="space-y-2 bg-card p-2.5 rounded-2xl border border-border shadow-sm">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">👤</span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer Name / Token # (e.g. Ramesh #12)"
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-input bg-background text-foreground text-xs font-bold focus:border-primary focus:outline-none"
                />
              </div>

              {/* Stake Amount Selector */}
              <div className="flex items-center justify-between gap-1">
                {[10, 20, 50, 100, 200, 500].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setActiveChip(chip)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-black transition active:scale-95 border ${
                      activeChip === chip
                        ? "bg-gradient-gold text-primary-foreground border-primary shadow-gold"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ₹{chip}
                  </button>
                ))}
              </div>
            </div>

            {/* 12-Card Fast Touch Grid */}
            <div className="grid grid-cols-3 gap-2">
              {CARDS.map((card, i) => {
                const staked = selectedCards[i] || 0;
                return (
                  <div
                    key={i}
                    onClick={() => handleCardClick(i)}
                    className={`relative rounded-2xl border p-2 cursor-pointer transition active:scale-95 flex flex-col items-center justify-between text-center select-none ${
                      staked > 0
                        ? "border-primary bg-primary/20 ring-2 ring-primary shadow-gold"
                        : "border-border/80 bg-card hover:border-primary/50"
                    }`}
                  >
                    {/* Clear Cross */}
                    {staked > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearCard(i);
                        }}
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-white text-[10px] font-black grid place-items-center shadow-sm"
                      >
                        ✕
                      </button>
                    )}

                    <img
                      src={card.img}
                      alt={card.name}
                      className="h-14 w-14 rounded-xl object-cover border border-border shadow-sm mb-1"
                    />

                    <span className="font-display text-xs font-black text-foreground block leading-tight">
                      {card.name}
                    </span>

                    <span
                      className={`text-[11px] font-mono font-black mt-1 px-1.5 py-0.2 rounded w-full ${
                        staked > 0
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground/60 bg-muted/40"
                      }`}
                    >
                      {staked > 0 ? `₹${staked}` : "+ Add"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: TICKETS LIST & CLAIM INAM */}
        {activeTab === "tickets" && (
          <div className="space-y-2.5">
            {/* Quick Printer Status Banner in Tickets View */}
            <div className="flex items-center justify-between rounded-xl bg-card border border-border p-2.5 shadow-sm text-xs">
              <div className="flex items-center gap-2">
                <span className="text-base">🖨️</span>
                <div>
                  <span className="font-bold text-foreground text-xs block">
                    Printer: {printerName || "POS-58"}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Thermal Slip Ready (58mm / 80mm)
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrinterModal(true)}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black uppercase hover:bg-emerald-500/30 transition active:scale-95 cursor-pointer"
              >
                ⚙️ Printer Setup
              </button>
            </div>

            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-muted-foreground">
                Recent Issued Slips ({ticketsList.length})
              </span>
              <span className="text-[10px] text-muted-foreground">
                Inam aane par "Pay Out" karein
              </span>
            </div>

            {ticketsList.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs">
                No tickets issued yet. Punch a bet to print the first thermal slip!
              </div>
            ) : (
              ticketsList.map((t) => (
                <div
                  key={t.ticketId}
                  className={`p-3 rounded-2xl border transition flex flex-col justify-between gap-2.5 ${
                    t.status === "WON"
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
                      : t.status === "CLAIMED"
                      ? "border-zinc-500/30 bg-muted/30"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-xs text-foreground">
                      #{t.ticketId}
                    </span>
                    <span
                      className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                        t.status === "WON"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                          : t.status === "CLAIMED"
                          ? "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40"
                          : t.status === "LOST"
                          ? "bg-destructive/15 text-destructive border border-destructive/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      }`}
                    >
                      {t.status === "WON"
                        ? `🏆 WON ₹${t.winningPayout}`
                        : t.status === "CLAIMED"
                        ? "✓ PAID OUT"
                        : t.status === "LOST"
                        ? "LOST"
                        : "⏳ IN PLAY"}
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    Client: <strong className="text-foreground">{t.customerName}</strong> • Round {t.roundId}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {t.items.map((item, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-background border border-border"
                      >
                        {item.cardName}: ₹{item.amount}
                      </span>
                    ))}
                    <span className="text-[10px] font-mono font-black text-primary">
                      Total: ₹{t.totalAmount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">{t.timeStr}</span>
                    <div className="flex items-center gap-2">
                      {t.status === "WON" && (
                        <button
                          type="button"
                          onClick={() => handleClaimPrize(t.ticketId)}
                          className="py-1 px-3 rounded-lg bg-emerald-500 text-black font-display text-xs font-black shadow-gold"
                        >
                          💵 Pay Out ₹{t.winningPayout}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setPrintTicket(t);
                          setShowSlipModal(true);
                        }}
                        className="py-1 px-2.5 rounded-lg bg-muted text-foreground text-xs font-bold border border-border"
                      >
                        🖨️ Reprint
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: SHIFT REPORT */}
        {activeTab === "shift" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <h3 className="font-display text-sm font-black text-foreground">
                Agent Counter Shift Summary
              </h3>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Total Bets Punched:</span>
                  <span className="font-bold text-foreground">₹{totalSalesToday.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Payouts Given:</span>
                  <span className="font-bold text-emerald-400">₹{totalPayoutsToday.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Cash Surplus in Drawer:</span>
                  <span className="font-bold text-foreground">
                    ₹{Math.max(0, totalSalesToday - totalPayoutsToday).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex justify-between py-2 bg-primary/10 px-2 rounded-xl border border-primary/30">
                  <span className="font-sans font-bold text-primary">Your 10% Commission:</span>
                  <span className="font-display font-black text-sm text-primary">
                    +₹{agentCommission10.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DEDICATED THERMAL PRINTER SETTINGS & BLUETOOTH CONNECT */}
        {activeTab === "printer" && (
          <div className="space-y-3">
            <div className="rounded-3xl border border-emerald-500/40 bg-zinc-900/90 p-4 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-border/80 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-2xl bg-gradient-gold grid place-items-center text-zinc-950 font-black text-xl shadow-gold">
                    🖨️
                  </div>
                  <div>
                    <h3 className="font-display text-base font-black text-foreground leading-tight">
                      Thermal Printer Connect
                    </h3>
                    <span className="text-[10px] text-muted-foreground block leading-tight">
                      Bluetooth & USB POS Settings
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase font-mono border border-emerald-500/30 animate-pulse">
                  ONLINE
                </span>
              </div>

              {/* Active Printer Badge */}
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <span className="text-xs font-black text-emerald-300 block">
                      {printerName || "POS-58 Bluetooth Thermal"}
                    </span>
                    <span className="text-[10px] text-emerald-400/80 font-mono block">
                      ESC/POS Standard • Ready to Print
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPrinterModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 text-zinc-950 font-black text-[10px] uppercase shadow hover:brightness-110 active:scale-95 transition cursor-pointer"
                >
                  Configure
                </button>
              </div>

              {/* Big 1-Tap Connect Bluetooth Printer Button */}
              <button
                type="button"
                onClick={() => setShowPrinterModal(true)}
                className="w-full py-3.5 rounded-2xl bg-gradient-gold text-zinc-950 font-black text-sm uppercase tracking-wide shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>🔌</span>
                <span>SCAN & PAIR BLUETOOTH PRINTER</span>
              </button>

              {/* Test Print Slip Button */}
              <button
                type="button"
                onClick={handleTestPrint}
                className="w-full py-3 rounded-2xl border border-border bg-card hover:bg-muted text-foreground font-black text-xs transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer shadow-sm"
              >
                <span>🧾</span>
                <span>PRINT TEST ALIGNMENT SLIP</span>
              </button>

              {/* Step-by-Step Hindi Guide */}
              <div className="rounded-2xl bg-background/80 border border-border p-3.5 text-xs text-muted-foreground space-y-2">
                <span className="font-bold text-primary block uppercase tracking-wider text-[11px] flex items-center gap-1">
                  <span>💡</span> Bluetooth Thermal Printer Kaise Connect Karein:
                </span>
                <p className="leading-relaxed">
                  1. Apne <strong>Bluetooth Thermal Printer</strong> ka power button ON karein.
                </p>
                <p className="leading-relaxed">
                  2. Apne mobile phone ki <strong>Bluetooth Settings</strong> me jayein aur naya device pair karein (Printer name: <em>POS-58</em>, <em>MTP-2</em>, <em>InnerPrinter</em>, PIN: <strong>0000</strong> ya <strong>1234</strong>).
                </p>
                <p className="leading-relaxed">
                  3. Pair hote hi upar <strong>"PRINT TEST ALIGNMENT SLIP"</strong> dabayein, parchi turant bahar aa jayegi!
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab("punch")}
                className="w-full py-2.5 rounded-xl bg-muted text-muted-foreground hover:text-foreground font-bold text-xs transition cursor-pointer"
              >
                ← Wapas Bet Counter Par Jayein
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ============================================================== */}
      {/* STICKY BOTTOM BOOKING & PRINT BAR                              */}
      {/* ============================================================== */}
      {activeTab === "punch" && (
        <footer className="fixed bottom-0 inset-x-0 max-w-md mx-auto z-40 bg-card/95 backdrop-blur-md border-t border-border p-3 shadow-2xl space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Selected:</span>
              <strong className="text-foreground">{Object.keys(selectedCards).length} Cards</strong>
              {totalTicketStake > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-destructive hover:underline text-[10px] ml-1 font-bold"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 font-mono">
              <span className="text-muted-foreground">Total:</span>
              <span className="text-base font-display font-black text-primary">
                ₹{totalTicketStake}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab("printer");
                setShowPrinterModal(true);
              }}
              className="h-12 w-14 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-bold flex flex-col items-center justify-center shrink-0 transition active:scale-95 shadow-sm cursor-pointer"
              title="Bluetooth Printer Setup"
            >
              <span className="text-base leading-none">🖨️</span>
              <span className="text-[8px] font-black uppercase mt-0.5 tracking-tight">Printer</span>
            </button>

            <button
              type="button"
              onClick={handlePunchAndPrint}
              disabled={totalTicketStake <= 0 || !isBalanceEnough || phase !== "bet"}
              className="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-gold text-primary-foreground font-display text-sm font-black shadow-gold hover:opacity-90 transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>🎟️</span>
              <span>
                {phase !== "bet"
                  ? "BETTING CLOSED (WAIT FOR ROUND)"
                  : totalTicketStake <= 0
                  ? "SELECT CARDS TO BET"
                  : !isBalanceEnough
                  ? "INSUFFICIENT BALANCE (RECHARGE)"
                  : `PUNCH BET & PRINT SLIP (₹${totalTicketStake})`}
              </span>
            </button>
          </div>
        </footer>
      )}

      {/* Thermal Slip Print Dialog Modal */}
      <ThermalSlipModal
        ticket={printTicket}
        isOpen={showSlipModal}
        onClose={() => setShowSlipModal(false)}
      />

      {/* Bluetooth & USB Thermal Printer Settings Modal */}
      <PrinterSettingsModal
        isOpen={showPrinterModal}
        onClose={() => setShowPrinterModal(false)}
        onTestPrint={handleTestPrint}
      />
    </div>
  );
}

