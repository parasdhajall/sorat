import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import {
  AdminClientSync,
  DEFAULT_ROOM_ID,
  GameMessage,
  getSynchronizedRoundState,
  getDeterministicRoundWinner,
} from "@/lib/realtime";
import {
  CARDS,
  getPastRoundsHistory,
  recordRoundWinnerHistory,
  RoundHistoryItem,
} from "@/lib/cards";
import { resolveProfitGuaranteedWinnerForRound } from "@/lib/roundSettlement";
import {
  createTicket,
  getTickets,
  clearTickets,
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
  authenticateAgentAsync,
  recordUserBet,
  getUsers,
  settleRoundBets,
  autoSettleAllPendingBets,
  UserAccount,
  deductAgentBalance,
  pullUsersFromCloud,
  subscribeToCloudUsers,
  getTodayDateStr,
  getYesterdayDateStr,
  getCategorizedUserBets,
  getUserProfitStats,
  UserBetRecord,
} from "@/lib/userStore";
import { ThermalSlipModal } from "@/components/pos/ThermalSlipModal";
import { PrinterSettingsModal } from "@/components/pos/PrinterSettingsModal";
import { PrinterStatusBadge } from "@/components/pos/PrinterStatusBadge";
import {
  executeDirectPrint,
  isDirectPrinterConnected,
} from "@/lib/thermalPrinter";

export const Route = createFileRoute("/")({
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
  const [declaredWinner, setDeclaredWinner] = useState<number | null>(null);
  const lastSettledRoundRef = useRef<number | null>(null);

  // Agent Authentication State
  const [loggedInAgent, setLoggedInAgentState] = useState<UserAccount | null>(() => getLoggedInAgent());
  const [loginIdInput, setLoginIdInput] = useState("");
  const [loginPinInput, setLoginPinInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<UserAccount[]>(() => getUsers());
  const [isSyncingAccounts, setIsSyncingAccounts] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

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
  const [ticketsList, setTicketsList] = useState<ThermalTicket[]>(() => {
    const u = getLoggedInAgent();
    return u ? getTickets(u.id || u.username) : [];
  });

  // Persist Active Tab so page updates/reloads never reset the agent from Tickets/Shift/History back to Bet Book
  const [activeTab, setActiveTabState] = useState<"punch" | "tickets" | "shift" | "history" | "printer">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("sorat_active_agent_tab");
        if (saved === "punch" || saved === "tickets" || saved === "shift" || saved === "history" || saved === "printer") {
          return saved;
        }
      } catch {}
    }
    return "punch";
  });

  const setActiveTab = (tab: "punch" | "tickets" | "shift" | "history" | "printer") => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("sorat_active_agent_tab", tab);
      } catch {}
    }
  };

  // Period filter states for Shift, Tickets, and History tabs ("today" | "yesterday" | "all")
  const [shiftPeriod, setShiftPeriod] = useState<"today" | "yesterday" | "all">("today");
  const [ticketFilterPeriod, setTicketFilterPeriod] = useState<"today" | "yesterday" | "all">("today");
  const [historyTabMode, setHistoryTabMode] = useState<"rounds" | "mybets">("rounds");
  const [historyPeriod, setHistoryPeriod] = useState<"today" | "yesterday" | "all">("yesterday");

  // Recent Round Winners History (35 past rounds)
  const [recentWinners, setRecentWinners] = useState<RoundHistoryItem[]>(() => getPastRoundsHistory(35));

  const agentUserRef = useRef(agentUser);
  useEffect(() => {
    agentUserRef.current = agentUser;
  }, [agentUser]);

  // Helper to always fetch tickets strictly scoped to the active/logged-in agent
  const refreshAgentTickets = () => {
    const currentAgent = loggedInAgent || agentUserRef.current || getLoggedInAgent();
    const id = currentAgent?.id || currentAgent?.username;
    if (id) {
      setTicketsList(getTickets(id));
    } else {
      setTicketsList([]);
    }
  };

  // Keep ticketsList strictly scoped to current logged-in agent
  useEffect(() => {
    refreshAgentTickets();
  }, [loggedInAgent?.id, loggedInAgent?.username]);

  // Print Slip State
  const [printTicket, setPrintTicket] = useState<ThermalTicket | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [printerName, setPrinterName] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("sorat_printer_name") || "POS-58" : "POS-58"
  );

  // PWA & Native App Mode Detection
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isNativeApp, setIsNativeApp] = useState(false);

  const clientSyncRef = useRef<AdminClientSync | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Detect standalone PWA mode and native Android App
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isStandaloneMode = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone;
      setIsStandalone(Boolean(isStandaloneMode));

      const isNative =
        (typeof navigator !== "undefined" && navigator.userAgent.includes("SoratApp")) ||
        Boolean((window as any).AndroidBridge) ||
        Boolean((window as any).AndroidPrinter);
      setIsNativeApp(isNative);

      const handler = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  // Sync Timer & Clock Rollover
  useEffect(() => {
    const id = setInterval(() => {
      const sync = getSynchronizedRoundState();
      setRoundNumber(sync.roundNumber);
      setRoundId(sync.roundId);
      setPhase(sync.phase);
      setTimer(sync.timeLeft);

      // New round rollover: clear old winner and refresh history
      if (sync.phase === "bet" && declaredWinner !== null) {
        setDeclaredWinner(null);
        setRecentWinners(getPastRoundsHistory(35));
      }

      // If in result phase and winner has not been declared yet from TV:
      if (sync.phase === "result" && lastSettledRoundRef.current !== sync.roundNumber) {
        lastSettledRoundRef.current = sync.roundNumber;
        const fallbackWinner =
          declaredWinner ?? resolveProfitGuaranteedWinnerForRound(sync.roundNumber, sync.roundId);
        if (declaredWinner === null) {
          setDeclaredWinner(fallbackWinner);
        }
        recordRoundWinnerHistory(sync.roundNumber, fallbackWinner);
        settleTicketsForRound(sync.roundId, fallbackWinner, CARDS[fallbackWinner]?.name || "");
        settleRoundBets(sync.roundId, fallbackWinner, CARDS[fallbackWinner]?.name || "", false);
        autoSettleAllPendingBets(sync.roundNumber, sync.phase, fallbackWinner);
        refreshAgentTickets();
        setRecentWinners(getPastRoundsHistory(35));
      }
    }, 250);
    return () => clearInterval(id);
  }, [declaredWinner]);

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
        refreshAgentTickets();
      }
      if (e.key === "sorat_round_winners_history") {
        setRecentWinners(getPastRoundsHistory(35));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Realtime Cloud User Accounts Sync (syncs with Admin on PC instantly)
  useEffect(() => {
    pullUsersFromCloud().then((cloudUsers) => {
      setAvailableUsers([...cloudUsers]);
      const u = getLoggedInAgent() || getActiveUser();
      setLoggedInAgentState(getLoggedInAgent());
      setAgentUser(u);
      setAgentBalance(u.balance);
    });

    const unsub = subscribeToCloudUsers((freshUsers) => {
      setAvailableUsers([...freshUsers]);
      const u = getLoggedInAgent() || getActiveUser();
      setLoggedInAgentState(getLoggedInAgent());
      setAgentUser(u);
      setAgentBalance(u.balance);
    });
    return () => unsub();
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
        // Accept winner immediately whether in select or result phase
        if (msg.winner !== null && msg.winner >= 0 && msg.winner < 12) {
          setDeclaredWinner(msg.winner);
          recordRoundWinnerHistory(msg.roundNumber, msg.winner);
          settleTicketsForRound(msg.roundId, msg.winner, CARDS[msg.winner]?.name || "");
          settleRoundBets(msg.roundId, msg.winner, CARDS[msg.winner]?.name || "", false);
          autoSettleAllPendingBets(msg.roundNumber, msg.phase, msg.winner);
          refreshAgentTickets();
          setRecentWinners(getPastRoundsHistory(35));
        }
      } else if (msg.type === "SET_AGENT_BALANCE") {
        setAgentBalance(msg.balance);
        setAgentUser((u) => ({ ...u, balance: msg.balance }));
      } else if (msg.type === "RECHARGE_AGENT") {
        setAgentBalance((b) => b + msg.amount);
        setAgentUser((u) => ({ ...u, balance: u.balance + msg.amount }));
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

    // 2. Atomically Deduct Balance & Persist in userStore
    const deductRes = deductAgentBalance(
      agentUser.id || agentUser.username,
      totalTicketStake,
      roundId,
      roundNumber,
      items
    );

    if (!deductRes.success) {
      alert(deductRes.error || "Balance deduct nahi ho paya!");
      return;
    }

    // 3. Immediately reflect deducted balance in React state
    setAgentBalance(deductRes.newBalance);
    setAgentUser((prev) => ({ ...prev, balance: deductRes.newBalance }));

    // 4. Create Ticket
    const newTicket = createTicket({
      roundId,
      roundNumber,
      customerName: customerName.trim() || undefined,
      agentName: agentUser.displayName || "Counter Kiosk",
      agentId: agentUser.id,
      username: agentUser.username,
      items,
    });

    // 5. Send single ATOMIC bet packet to TV Screen
    clientSyncRef.current?.send({
      type: "ADD_TICKET_BETS",
      bets: { ...selectedCards },
      totalAmount: totalTicketStake,
      agentName: agentUser.displayName,
      roundId,
    });

    // Refresh tickets & clear staged selection (scoped to current agent)
    setTicketsList(getTickets(agentUser.id || agentUser.username));
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
      setTicketsList(getTickets(agentUser?.id || agentUser?.username));
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

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      let res = await authenticateAgentAsync(loginIdInput, loginPinInput);
      if (!res.success) {
        // Pull fresh users from cloud in case account was just created or updated on Admin
        const fresh = await pullUsersFromCloud();
        setAvailableUsers([...fresh]);
        res = await authenticateAgentAsync(loginIdInput, loginPinInput);
      }
      if (res.success && res.user) {
        setLoggedInAgentState(res.user);
        setAgentUser(res.user);
        setAgentBalance(res.user.balance);
        setTicketsList(getTickets(res.user.id || res.user.username));
      } else {
        setLoginError(res.error || "Login fail! Sahi Agent ID aur 4-digit PIN daalein.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleManualSyncAccounts = async () => {
    setIsSyncingAccounts(true);
    setSyncNotice(null);
    try {
      const fresh = await pullUsersFromCloud();
      setAvailableUsers([...fresh]);
      setSyncNotice(`✅ ${fresh.length} Agent Accounts Cloud Se Sync Ho Gaye!`);
      setTimeout(() => setSyncNotice(null), 3500);
    } catch {
      setSyncNotice("⚠️ Cloud sync fail hua.");
      setTimeout(() => setSyncNotice(null), 3000);
    } finally {
      setIsSyncingAccounts(false);
    }
  };

  const handleLogout = () => {
    if (confirm("Kya aap counter se logout karna chahte hain?")) {
      setLoggedInAgent(null);
      setLoggedInAgentState(null);
      setLoginPinInput("");
      setTicketsList([]);
    }
  };

  // Dates
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();

  // Categorized user bets from user store (contains persistent history synced from Supabase/cloud)
  const categorizedBets = useMemo(() => {
    return agentUser ? getCategorizedUserBets(agentUser) : { today: [], yesterday: [], older: [], all: [] };
  }, [agentUser]);

  // Tickets filtered by date
  const todayTickets = useMemo(() => ticketsList.filter((t) => t.dateStr === todayStr), [ticketsList, todayStr]);
  const yesterdayTickets = useMemo(() => ticketsList.filter((t) => t.dateStr === yesterdayStr), [ticketsList, yesterdayStr]);

  // Fallback: If ticketsList in localStorage has 0 yesterday tickets, synthesize them from agentUser.bets!
  const yesterdaySynthesizedTickets: ThermalTicket[] = useMemo(() => {
    if (yesterdayTickets.length > 0) return yesterdayTickets;
    if (!categorizedBets.yesterday || categorizedBets.yesterday.length === 0) return [];

    const roundMap = new Map<string, typeof categorizedBets.yesterday>();
    categorizedBets.yesterday.forEach((b) => {
      const arr = roundMap.get(b.roundId) || [];
      arr.push(b);
      roundMap.set(b.roundId, arr);
    });

    return Array.from(roundMap.entries()).map(([rId, bets], idx) => {
      const totalAmount = bets.reduce((s, b) => s + b.stake, 0);
      const winningPayout = bets.reduce((s, b) => s + (b.payout || 0), 0);
      const isWin = bets.some((b) => b.isWin || (b.payout && b.payout > 0));
      const firstBet = bets[0];
      return {
        ticketId: firstBet.ticketId || `TKT-YEST-${idx + 1}`,
        barcode: `YEST${idx + 1}`,
        roundId: rId,
        roundNumber: firstBet.roundNumber || 0,
        timestamp: firstBet.timestamp,
        dateStr: firstBet.dateStr || yesterdayStr,
        timeStr: firstBet.timeStr || "12:00 PM",
        customerName: "Counter Customer",
        agentName: agentUser.displayName,
        agentId: agentUser.id,
        username: agentUser.username,
        items: bets.map((b) => ({
          cardIndex: b.cardIndex,
          cardName: b.cardName,
          amount: b.stake,
        })),
        totalAmount,
        winningPayout,
        status: isWin ? "WON" : "LOST",
      } as ThermalTicket;
    });
  }, [yesterdayTickets, categorizedBets.yesterday, yesterdayStr, agentUser]);

  // All tickets combined (ticketsList plus synthesized yesterday tickets if ticketsList was missing them)
  const allTicketsCombined = useMemo(() => {
    if (ticketsList.some((t) => t.dateStr === yesterdayStr)) return ticketsList;
    return [...ticketsList, ...yesterdaySynthesizedTickets];
  }, [ticketsList, yesterdayStr, yesterdaySynthesizedTickets]);

  // Filtered tickets for Tickets Tab
  const filteredTickets = useMemo(() => {
    if (ticketFilterPeriod === "today") return todayTickets;
    if (ticketFilterPeriod === "yesterday") return yesterdaySynthesizedTickets;
    return allTicketsCombined;
  }, [ticketFilterPeriod, todayTickets, yesterdaySynthesizedTickets, allTicketsCombined]);

  // Shift Stats for selected period ("today" | "yesterday" | "all")
  const shiftTickets = useMemo(() => {
    if (shiftPeriod === "today") return todayTickets;
    if (shiftPeriod === "yesterday") return yesterdaySynthesizedTickets;
    return allTicketsCombined;
  }, [shiftPeriod, todayTickets, yesterdaySynthesizedTickets, allTicketsCombined]);

  const shiftSales = useMemo(() => {
    if (shiftPeriod === "today") {
      const tSales = todayTickets.reduce((sum, t) => sum + t.totalAmount, 0);
      const bSales = categorizedBets.today.reduce((sum, b) => sum + b.stake, 0);
      return tSales > 0 ? tSales : bSales;
    }
    if (shiftPeriod === "yesterday") {
      const tSales = yesterdayTickets.reduce((sum, t) => sum + t.totalAmount, 0);
      const bSales = categorizedBets.yesterday.reduce((sum, b) => sum + b.stake, 0);
      return tSales > 0 ? tSales : bSales;
    }
    const tSales = allTicketsCombined.reduce((sum, t) => sum + t.totalAmount, 0);
    const bSales = (agentUser?.bets || []).reduce((sum, b) => sum + b.stake, 0);
    return tSales > 0 ? tSales : bSales;
  }, [shiftPeriod, todayTickets, yesterdayTickets, allTicketsCombined, categorizedBets, agentUser]);

  const shiftPayouts = useMemo(() => {
    if (shiftPeriod === "today") {
      const tPayouts = todayTickets.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
      const bPayouts = categorizedBets.today.reduce((sum, b) => sum + (b.payout || 0), 0);
      return tPayouts > 0 ? tPayouts : bPayouts;
    }
    if (shiftPeriod === "yesterday") {
      const tPayouts = yesterdayTickets.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
      const bPayouts = categorizedBets.yesterday.reduce((sum, b) => sum + (b.payout || 0), 0);
      return tPayouts > 0 ? tPayouts : bPayouts;
    }
    const tPayouts = allTicketsCombined.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
    const bPayouts = (agentUser?.bets || []).reduce((sum, b) => sum + (b.payout || 0), 0);
    return tPayouts > 0 ? tPayouts : bPayouts;
  }, [shiftPeriod, todayTickets, yesterdayTickets, allTicketsCombined, categorizedBets, agentUser]);

  const shiftCommission10 = Math.round(shiftSales * 0.10);
  const shiftCashSurplus = Math.max(0, shiftSales - shiftPayouts);

  // Deposits for selected period
  const shiftDeposits = useMemo(() => {
    const deps = agentUser?.deposits || [];
    if (shiftPeriod === "today") {
      return deps.filter((d) => d.dateStr === todayStr).reduce((s, d) => s + d.amount, 0);
    }
    if (shiftPeriod === "yesterday") {
      return deps.filter((d) => d.dateStr === yesterdayStr).reduce((s, d) => s + d.amount, 0);
    }
    return deps.reduce((s, d) => s + d.amount, 0);
  }, [agentUser?.deposits, shiftPeriod, todayStr, yesterdayStr]);

  // History Tab Filtered Bets
  const historyBets = useMemo(() => {
    if (historyPeriod === "today") return categorizedBets.today;
    if (historyPeriod === "yesterday") return categorizedBets.yesterday;
    return categorizedBets.all;
  }, [historyPeriod, categorizedBets]);

  const historyBetsTotalStake = useMemo(() => {
    return historyBets.reduce((s, b) => s + b.stake, 0);
  }, [historyBets]);

  const historyBetsTotalWon = useMemo(() => {
    return historyBets.reduce((s, b) => s + (b.payout || 0), 0);
  }, [historyBets]);

  const historyCommission10 = Math.round(historyBetsTotalStake * 0.10);

  // =========================================================================
  // IF NOT LOGGED IN: DISPLAY AGENT ID & PIN LOGIN SCREEN
  // =========================================================================
  if (!loggedInAgent) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-4 max-w-md mx-auto select-none">
        <div className="w-full bg-card/95 border border-primary/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md space-y-5">
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

          {syncNotice && (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-2.5 text-xs text-emerald-400 font-bold text-center animate-in fade-in">
              {syncNotice}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Agent ID / Mobile Number / Username
              </label>
              <input
                type="text"
                required
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value)}
                placeholder="Mobile No. (e.g. 9284893349) ya @ram"
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
                placeholder="•••• (e.g. 1111 ya 1234)"
                className="w-full bg-background border border-border focus:border-primary rounded-xl px-4 py-3 text-sm font-bold text-foreground tracking-widest placeholder:tracking-normal placeholder:text-muted-foreground/50 outline-none transition"
              />
            </div>

            {loginError && (
              <div className="rounded-xl bg-destructive/15 border border-destructive/40 p-3 text-xs text-destructive font-bold text-center space-y-1.5">
                <div>⚠️ {loginError}</div>
                <button
                  type="button"
                  onClick={handleManualSyncAccounts}
                  className="text-[11px] underline text-primary hover:text-primary/80 font-bold block mx-auto cursor-pointer"
                >
                  🔄 Admin se naya account abhi sync karein
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3.5 rounded-xl bg-gradient-gold text-primary-foreground font-display text-base font-black tracking-wide shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{isLoggingIn ? "⏳" : "🔐"}</span>
              <span>{isLoggingIn ? "CHECKING CREDENTIALS..." : "LOGIN & OPEN COUNTER"}</span>
            </button>
          </form>

          {/* Cloud Sync & Available Accounts List */}
          <div className="border-t border-border/80 pt-4 space-y-2.5 text-center">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Select Agent / 1-Tap Login ({availableUsers.length})
              </span>
              <button
                type="button"
                onClick={handleManualSyncAccounts}
                disabled={isSyncingAccounts}
                className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{isSyncingAccounts ? "⏳ Syncing..." : "🔄 Refresh Cloud"}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {availableUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    const identifier = u.phone || u.username;
                    const pin = u.pin || "1234";
                    setLoginIdInput(identifier);
                    setLoginPinInput(pin);
                    const res = authenticateAgent(identifier, pin);
                    if (res.success && res.user) {
                      setLoggedInAgentState(res.user);
                      setAgentUser(res.user);
                      setAgentBalance(res.user.balance);
                      setTicketsList(getTickets(res.user.id || res.user.username));
                    }
                  }}
                  className="p-2.5 rounded-xl bg-muted/60 hover:bg-muted border border-border text-left transition hover:border-primary/50 cursor-pointer active:scale-95"
                >
                  <div className="text-[11px] font-black text-foreground truncate flex items-center justify-between">
                    <span>{u.displayName}</span>
                    <span className="text-[9px] text-emerald-400 font-mono">₹{u.balance}</span>
                  </div>
                  <div className="text-[9px] text-primary font-mono font-bold truncate">
                    {u.phone ? `📱 ${u.phone}` : `@${u.username}`}
                  </div>
                  <div className="text-[9px] text-muted-foreground font-mono">
                    PIN: <strong className="text-foreground">{u.pin || "1234"}</strong>
                  </div>
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
              href="/tv"
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs"
              title="Open TV Arena"
            >
              📺
            </a>

            <PrinterStatusBadge showTextOnMobile={true} />
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

        {/* App Install & APK Download Banner (Hidden inside Native Android APK) */}
        {!isStandalone && !isNativeApp && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-amber-500/20 via-primary/15 to-amber-500/10 border border-primary/30 p-2.5 shadow-sm text-xs">
            <div className="flex items-center gap-2">
              <span className="text-xl">📲</span>
              <div>
                <span className="font-bold text-foreground block text-[11px] leading-tight">
                  Sorat Agent App (Android & Mobile)
                </span>
                <span className="text-[9px] text-muted-foreground block leading-tight">
                  Direct .APK download karein ya Home Screen par install karein
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <a
                href="/Sorat_Agent_POS.apk"
                download="Sorat_Agent_POS.apk"
                className="flex-1 sm:flex-none text-center px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase shadow active:scale-95 transition flex items-center justify-center gap-1"
              >
                <span>📥</span> Download .APK
              </a>
              <button
                type="button"
                onClick={async () => {
                  if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === "accepted") setDeferredPrompt(null);
                  } else {
                    alert("Chrome ke 3-dots (⋮) par click karein aur 'Install app' ya 'Add to Home screen' dabayein!");
                  }
                }}
                className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-primary hover:brightness-110 text-primary-foreground font-black text-[10px] uppercase shadow active:scale-95 transition"
              >
                Install Web App
              </button>
            </div>
          </div>
        )}

        {/* App Sub-Navigation Tabs */}
        <div className="grid grid-cols-5 gap-1 bg-muted/80 p-1 rounded-xl border border-border text-xs">
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
            <span className="text-[9px] leading-tight font-bold">Bet Book</span>
          </button>

          <button
            type="button"
            onClick={() => {
              refreshAgentTickets();
              setActiveTab("tickets");
            }}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "tickets"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">🎟️</span>
            <span className="text-[9px] leading-tight font-bold">Tickets ({allTicketsCombined.length})</span>
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
            <span className="text-[9px] leading-tight font-bold">Hisaab</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRecentWinners(getPastRoundsHistory(35));
              setActiveTab("history");
            }}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "history"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">📜</span>
            <span className="text-[9px] leading-tight font-bold">History</span>
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
            <span className="text-[9px] leading-tight font-black">Printer</span>
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
            {/* Live Winner Result Pop Banner */}
            {phase === "result" && declaredWinner !== null && (
              <div className="rounded-2xl border-2 border-emerald-400 bg-gradient-to-r from-emerald-950 via-zinc-900 to-emerald-950 p-3.5 text-center space-y-1.5 shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-[10px] font-mono font-bold tracking-wider uppercase">
                  <span>⚡</span> ROUND {roundId} WINNER RESULT <span>⚡</span>
                </div>
                <div className="flex items-center justify-center gap-2 pt-0.5">
                  <span className="text-3xl animate-bounce">🏆</span>
                  <span className="font-display text-xl font-black text-amber-300 tracking-wide drop-shadow-md">
                    {CARDS[declaredWinner]?.name}
                  </span>
                  <span className="text-3xl animate-bounce">🏆</span>
                </div>
                <div className="text-[11px] font-black text-emerald-400">
                  🎉 WINNING CARD: {CARDS[declaredWinner]?.englishName} (9X PAYOUT)
                </div>
              </div>
            )}

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

            {/* Recent Winners Horizontal Preview Strip */}
            {recentWinners.length > 0 && (
              <div className="rounded-2xl border border-border/70 bg-card/70 p-2 space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <span>🏆</span> Recent Winners (मागील निकाल)
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("history")}
                    className="text-[10px] text-primary hover:underline font-bold cursor-pointer"
                  >
                    View All →
                  </button>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                  {recentWinners.slice(0, 10).map((r) => (
                    <div
                      key={r.roundNumber}
                      onClick={() => setActiveTab("history")}
                      className="flex flex-col items-center shrink-0 w-14 p-1 rounded-xl border border-border/80 bg-background/90 text-center shadow-xs cursor-pointer hover:border-primary/50 transition active:scale-95"
                    >
                      <span className="text-[9px] font-mono font-bold text-muted-foreground leading-none">
                        {r.roundId}
                      </span>
                      <img
                        src={r.card.img}
                        alt={r.card.name}
                        className="h-8 w-8 object-contain my-1 rounded-lg"
                      />
                      <span className="text-[10px] font-black text-foreground leading-tight truncate w-full">
                        {r.card.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 12-Card Fast Touch Grid */}
            <div className="grid grid-cols-3 gap-2">
              {CARDS.map((card, i) => {
                const staked = selectedCards[i] || 0;
                return (
                  <div
                    key={i}
                    onClick={() => handleCardClick(i)}
                    className={`relative rounded-2xl border p-2 cursor-pointer transition active:scale-95 flex flex-col items-center justify-between text-center select-none ${
                      phase === "result" && declaredWinner === i
                        ? "border-emerald-400 bg-emerald-500/30 ring-4 ring-emerald-400 shadow-2xl scale-[1.03] animate-pulse"
                        : staked > 0
                        ? "border-primary bg-primary/20 ring-2 ring-primary shadow-gold"
                        : "border-border/80 bg-card hover:border-primary/50"
                    }`}
                  >
                    {/* Winner Badge on declared card */}
                    {phase === "result" && declaredWinner === i && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-zinc-950 font-black text-[9px] px-2 py-0.5 rounded-full shadow-lg border border-emerald-300 uppercase tracking-wider whitespace-nowrap animate-bounce z-10">
                        🏆 WINNER 9X
                      </div>
                    )}
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

            {/* Date Period Filter Selector (आज / काल / सर्व) */}
            <div className="grid grid-cols-3 gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("today")}
                className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "today"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📅</span> आज ({todayTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("yesterday")}
                className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "yesterday"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⏪</span> काल ({yesterdaySynthesizedTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("all")}
                className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "all"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📊</span> सर्व ({allTicketsCombined.length})
              </button>
            </div>

            {/* Period Status Badge */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-muted-foreground">
                {ticketFilterPeriod === "today"
                  ? `आजच्या पावत्या (${todayTickets.length}) • ${todayStr}`
                  : ticketFilterPeriod === "yesterday"
                  ? `कालच्या पावत्या (${yesterdaySynthesizedTickets.length}) • ${yesterdayStr}`
                  : `एकूण सर्व पावत्या (${allTicketsCombined.length})`}
              </span>
              <div className="flex items-center gap-2">
                {ticketFilterPeriod === "today" && todayTickets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Kya aap counter slip history clear karke fresh shift shuru karna chahte hain?")) {
                        clearTickets(agentUser?.id || agentUser?.username);
                        setTicketsList([]);
                      }
                    }}
                    className="text-[10px] text-destructive hover:underline font-bold cursor-pointer"
                  >
                    🗑️ Clear Slips
                  </button>
                )}
                <span className="text-[10px] text-muted-foreground">
                  Inam aane par "Pay Out" karein
                </span>
              </div>
            </div>

            {filteredTickets.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs space-y-1">
                <p className="font-bold">
                  {ticketFilterPeriod === "yesterday"
                    ? `कालच्या तारखेसाठी (${yesterdayStr}) कोणतीही पावती सापडली नाही.`
                    : ticketFilterPeriod === "today"
                    ? "आज अद्याप कोणतीही पावती फाडली नाही. नवीन दाव लावा!"
                    : "कोणतीही पावती उपलब्ध नाही."}
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  {ticketFilterPeriod === "yesterday"
                    ? "काल या काऊंटरवरून कोणतेही दाव नोंदवले गेले नव्हते."
                    : "Thermal slip print karne ke liye card select karke daav lagayein."}
                </p>
              </div>
            ) : (
              filteredTickets.map((t) => (
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-black text-xs text-foreground">
                        #{t.ticketId}
                      </span>
                      {t.dateStr === yesterdayStr && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold">
                          काल
                        </span>
                      )}
                    </div>
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
                    <span className="text-[10px] text-muted-foreground font-mono">
                      🕒 {t.timeStr} • {t.dateStr}
                    </span>
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

        {/* TAB 3: SHIFT REPORT & KAL KA HISAB */}
        {activeTab === "shift" && (
          <div className="space-y-3">
            {/* Period Switcher: आज (Today) / काल (Yesterday) / एकूण (All) */}
            <div className="grid grid-cols-3 gap-1 bg-muted/70 p-1 rounded-2xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setShiftPeriod("today")}
                className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                  shiftPeriod === "today"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📅</span> आज (Today)
              </button>
              <button
                type="button"
                onClick={() => setShiftPeriod("yesterday")}
                className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                  shiftPeriod === "yesterday"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⏪</span> काल (Yesterday)
              </button>
              <button
                type="button"
                onClick={() => setShiftPeriod("all")}
                className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                  shiftPeriod === "all"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📊</span> एकूण (All)
              </button>
            </div>

            {/* Shift Summary Box */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-sm font-black text-foreground flex items-center gap-1.5">
                    <span>{shiftPeriod === "today" ? "🟢" : shiftPeriod === "yesterday" ? "🟡" : "🔵"}</span>
                    {shiftPeriod === "today"
                      ? "आजचा हिशोब (Today's Shift)"
                      : shiftPeriod === "yesterday"
                      ? "कालचा हिशोब (Yesterday's Ledger)"
                      : "एकूण हिशोब (All Time Summary)"}
                  </h3>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {shiftPeriod === "today"
                      ? `तारीख: ${todayStr}`
                      : shiftPeriod === "yesterday"
                      ? `तारीख: ${yesterdayStr}`
                      : "सर्व रेकॉर्ड केलेला कालावधी"}
                  </span>
                </div>

                {shiftPeriod === "today" && todayTickets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Kya aap naya shift shuru karke shift sales 0 se start karna chahte hain?")) {
                        clearTickets(agentUser?.id || agentUser?.username);
                        setTicketsList([]);
                      }
                    }}
                    className="text-[10px] text-primary hover:underline font-bold cursor-pointer"
                  >
                    🔄 Start New Shift
                  </button>
                )}
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Total Bets Punched (विक्री):</span>
                  <span className="font-bold text-foreground">₹{shiftSales.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Payouts Given (वाटप):</span>
                  <span className="font-bold text-emerald-400">₹{shiftPayouts.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Cash Surplus in Drawer (गल्ल्यात शिल्लक):</span>
                  <span className="font-bold text-foreground">
                    ₹{shiftCashSurplus.toLocaleString("en-IN")}
                  </span>
                </div>

                {shiftDeposits > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-border/50">
                    <span className="text-muted-foreground">Counter Recharge / Deposit (जमा):</span>
                    <span className="font-bold text-foreground">₹{shiftDeposits.toLocaleString("en-IN")}</span>
                  </div>
                )}

                <div className="flex justify-between py-2 bg-primary/10 px-2 rounded-xl border border-primary/30">
                  <span className="font-sans font-bold text-primary">Your 10% Commission (१०% कमिशन):</span>
                  <span className="font-display font-black text-sm text-primary">
                    +₹{shiftCommission10.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>

            {/* Shift Breakdown List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-muted-foreground">
                  {shiftPeriod === "today"
                    ? `आजच्या पावत्या व नोंदी (${shiftTickets.length})`
                    : shiftPeriod === "yesterday"
                    ? `कालच्या पावत्या व नोंदी (${shiftTickets.length})`
                    : `सर्व पावत्या व नोंदी (${shiftTickets.length})`}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {shiftPeriod === "yesterday" ? "कालचा संपूर्ण हिशोब" : "तपशीलवार पावती यादी"}
                </span>
              </div>

              {shiftTickets.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs space-y-1">
                  <p className="font-bold">
                    {shiftPeriod === "yesterday"
                      ? `कालच्या तारखेसाठी (${yesterdayStr}) कोणतीही नोंद आढळली नाही.`
                      : "या कालावधीत कोणतीही पावती आढळली नाही."}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80">
                    {shiftPeriod === "yesterday"
                      ? "काल या काऊंटरवरून कोणतेही दाव लावले गेले नव्हते."
                      : "दाव लावल्यानंतर येथे पावती तपशील दिसेल."}
                  </p>
                </div>
              ) : (
                shiftTickets.map((t) => (
                  <div
                    key={t.ticketId}
                    className={`p-3 rounded-2xl border transition flex flex-col justify-between gap-2 ${
                      t.status === "WON"
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : t.status === "CLAIMED"
                        ? "border-zinc-500/30 bg-muted/30"
                        : t.status === "LOST"
                        ? "border-border/60 bg-card/60"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-black text-xs text-foreground">
                          #{t.ticketId}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-[10px] font-mono font-bold text-primary">
                          Round {t.roundId}
                        </span>
                      </div>
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

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {t.items.map((item, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-background border border-border"
                        >
                          {item.cardName}: ₹{item.amount}
                        </span>
                      ))}
                      <span className="text-[10px] font-mono font-black text-primary ml-auto">
                        Total: ₹{t.totalAmount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
                      <span>🕒 {t.timeStr} • {t.dateStr}</span>
                      {t.winningPayout && t.winningPayout > 0 && (
                        <span className="text-emerald-400 font-bold">
                          बक्षीस: ₹{t.winningPayout}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ROUND RESULTS & WINNERS HISTORY + MY BETS HISTORY */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {/* Mode Switcher: Round Results vs Agent My Bets History */}
            <div className="grid grid-cols-2 gap-1 bg-muted/70 p-1 rounded-2xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setHistoryTabMode("rounds")}
                className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                  historyTabMode === "rounds"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>🎰</span> फेऱ्यांचे निकाल (Rounds)
              </button>
              <button
                type="button"
                onClick={() => setHistoryTabMode("mybets")}
                className={`py-2 px-3 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                  historyTabMode === "mybets"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📜</span> माझे दाव (My Bets)
              </button>
            </div>

            {/* SUB-VIEW 1: ROUND RESULTS */}
            {historyTabMode === "rounds" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">📜</span>
                    <h3 className="font-display text-sm font-black text-foreground">
                      Round Results History (मागील निकाल)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground font-bold">
                    Last {recentWinners.length} Rounds
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {recentWinners.map((r) => {
                    const roundTickets = ticketsList.filter(
                      (t) => t.roundNumber === r.roundNumber || t.roundId === r.roundId
                    );
                    const hasWonTicket = roundTickets.some((t) => t.status === "WON" || t.status === "CLAIMED");

                    return (
                      <div
                        key={r.roundNumber}
                        className={`rounded-2xl border p-2.5 flex items-center justify-between gap-3 transition shadow-xs ${
                          hasWonTicket
                            ? "border-emerald-500/50 bg-emerald-500/10"
                            : "border-border bg-card/90"
                        }`}
                      >
                        {/* Left: Winning Card Picture + Name + Symbol */}
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-xl overflow-hidden border border-border/80 shrink-0 bg-background flex items-center justify-center p-1 shadow-inner">
                            <img
                              src={r.card.img}
                              alt={r.card.name}
                              className="w-full h-full object-contain filter drop-shadow"
                            />
                          </div>

                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-display text-base font-black text-foreground leading-none">
                                {r.card.name}
                              </span>
                              <span className="text-sm">{r.card.symbol}</span>
                              <span className="text-[10px] font-mono text-muted-foreground font-bold">
                                ({r.card.englishName})
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                              <span className="px-2 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-mono font-black">
                                {r.roundId}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {r.timeStr}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: 9X Payout Badge + Counter Ticket Indicator */}
                        <div className="text-right shrink-0">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-gradient-gold text-zinc-950 font-black text-[10px] uppercase shadow-sm">
                            🏆 WINNER 9X
                          </span>

                          {roundTickets.length > 0 && (
                            <span
                              className={`block mt-1 text-[10px] font-bold font-mono ${
                                hasWonTicket ? "text-emerald-400 font-black" : "text-muted-foreground"
                              }`}
                            >
                              {hasWonTicket
                                ? "🎉 Counter Won!"
                                : `${roundTickets.length} Slip(s) Booked`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SUB-VIEW 2: AGENT MY BETS HISTORY (TODAY / YESTERDAY / ALL) */}
            {historyTabMode === "mybets" && (
              <div className="space-y-3">
                {/* Period Pills */}
                <div className="grid grid-cols-3 gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => setHistoryPeriod("today")}
                    className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                      historyPeriod === "today"
                        ? "bg-primary text-primary-foreground font-black shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>📅</span> आज ({categorizedBets.today.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryPeriod("yesterday")}
                    className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                      historyPeriod === "yesterday"
                        ? "bg-primary text-primary-foreground font-black shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>⏪</span> काल ({categorizedBets.yesterday.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryPeriod("all")}
                    className={`py-1.5 px-2 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                      historyPeriod === "all"
                        ? "bg-primary text-primary-foreground font-black shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>📊</span> सर्व ({categorizedBets.all.length})
                  </button>
                </div>

                {/* Bets Summary Header Banner */}
                <div className="rounded-2xl border border-border bg-card p-3 shadow-sm flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">
                      {historyPeriod === "today"
                        ? `आजचे दाव • ${todayStr}`
                        : historyPeriod === "yesterday"
                        ? `कालचे दाव • ${yesterdayStr}`
                        : "सर्व दाव इतिहास"}
                    </span>
                    <span className="font-bold text-foreground">
                      {historyBets.length} दाव लावले
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">
                      एकूण दाव: ₹{historyBetsTotalStake}
                    </span>
                    <span className="font-bold text-emerald-400">
                      बक्षीस: ₹{historyBetsTotalWon}
                    </span>
                  </div>
                </div>

                {/* Bets List */}
                {historyBets.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs space-y-1">
                    <p className="font-bold">
                      {historyPeriod === "yesterday"
                        ? `कालच्या तारखेसाठी (${yesterdayStr}) कोणतेही दाव आढळले नाहीत.`
                        : "या कालावधीत कोणतेही दाव नाहीत."}
                    </p>
                    <p className="text-[10px] text-muted-foreground/80">
                      काऊंटरवरून दाव लावल्यानंतर येथे नोंद दिसेल.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyBets.map((b) => (
                      <div
                        key={b.id}
                        className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                          b.isWin || (b.payout && b.payout > 0)
                            ? "border-emerald-500/50 bg-emerald-500/10 shadow-xs"
                            : "border-border bg-card/80"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-background border border-border flex items-center justify-center font-display font-black text-sm">
                            {CARDS[b.cardIndex]?.symbol || "🃏"}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-display text-sm font-black text-foreground">
                                {b.cardName}
                              </span>
                              <span className="text-[10px] font-mono font-bold text-primary px-1.5 py-0.2 rounded bg-primary/10 border border-primary/20">
                                {b.roundId}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">
                              🕒 {b.timeStr} • {b.dateStr}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-black text-foreground block">
                            दाव: ₹{b.stake}
                          </span>
                          {b.isWin || (b.payout && b.payout > 0) ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black uppercase">
                              🏆 जिंकले ₹{b.payout}
                            </span>
                          ) : b.status === "SETTLED" ? (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Settled
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-400 font-mono">
                              In Play
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: DEDICATED THERMAL PRINTER SETTINGS & BLUETOOTH CONNECT */}
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


