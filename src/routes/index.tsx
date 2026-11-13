import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import {
  AdminClientSync,
  DEFAULT_ROOM_ID,
  sanitizeRoomId,
  GameMessage,
  getSynchronizedRoundState,
  getDeterministicRoundWinner,
} from "@/lib/realtime";
import {
  CARDS,
  recordRoundWinnerHistory,
} from "@/lib/cards";
import { resolveProfitGuaranteedWinnerForRound } from "@/lib/roundSettlement";
import {
  createTicket,
  getTickets,
  saveTickets,
  clearTickets,
  claimTicket,
  findTicketByIdOrBarcode,
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
  setUserBalance,
} from "@/lib/userStore";
import { ThermalSlipModal } from "@/components/pos/ThermalSlipModal";
import { PrinterSettingsModal } from "@/components/pos/PrinterSettingsModal";
import { PrinterStatusBadge } from "@/components/pos/PrinterStatusBadge";
import {
  executeDirectPrint,
  isDirectPrinterConnected,
} from "@/lib/thermalPrinter";
import {
  placeSoratBetsRpc,
  fetchAgentDailyTicketsAndBets,
  subscribeToPlayerBalanceRealtime,
  subscribeToSoratBetsRealtime,
  AgentDailyCloudSummary,
  getSupabaseClient,
} from "@/lib/supabase";

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

  // Room / Counter ID (Isolated profit and TV channel)
  const [activeRoomId, setActiveRoomId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const r = sp.get("room") || sp.get("counter");
      if (r) return sanitizeRoomId(r);
    }
    const agent = getLoggedInAgent();
    if (agent?.agentCode || agent?.username || agent?.id) {
      return sanitizeRoomId(agent.agentCode || agent.username || agent.id);
    }
    return DEFAULT_ROOM_ID;
  });

  // Keep activeRoomId in sync when agent logs in/changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const r = sp.get("room") || sp.get("counter");
      if (r) {
        setActiveRoomId(sanitizeRoomId(r));
        return;
      }
    }
    if (agentUser?.agentCode || agentUser?.username || agentUser?.id) {
      setActiveRoomId(sanitizeRoomId(agentUser.agentCode || agentUser.username || agentUser.id));
    }
  }, [agentUser?.id, agentUser?.username, agentUser?.agentCode]);

  // POS Booking State
  const [customerName, setCustomerName] = useState("");
  const [activeChip, setActiveChip] = useState<number>(10);
  const [selectedCards, setSelectedCards] = useState<Record<number, number>>({});
  const [ticketsList, setTicketsList] = useState<ThermalTicket[]>(() => {
    const u = getLoggedInAgent();
    return u ? getTickets(u.id || u.username) : [];
  });

  // Persist Active Tab so page updates/reloads never reset the agent from Tickets/Shift/History back to Bet Book
  const [activeTab, setActiveTabState] = useState<"punch" | "claim" | "tickets" | "shift" | "history" | "printer">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("sorat_active_agent_tab");
        if (saved === "punch" || saved === "claim" || saved === "tickets" || saved === "shift" || saved === "history" || saved === "printer") {
          return saved;
        }
      } catch {}
    }
    return "punch";
  });

  const setActiveTab = (tab: "punch" | "claim" | "tickets" | "shift" | "history" | "printer") => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("sorat_active_agent_tab", tab);
      } catch {}
    }
  };

  // Dedicated Ticket Claiming & Verification State
  const [claimSearchInput, setClaimSearchInput] = useState("");
  const [claimVerifiedTicket, setClaimVerifiedTicket] = useState<ThermalTicket | null>(null);
  const [claimJustPaidTicket, setClaimJustPaidTicket] = useState<ThermalTicket | null>(null);
  const [claimHasSearched, setClaimHasSearched] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);

  // Cloud Live Daily Summary from Supabase `sorat_bets` (Exact sync with Admin Panel)
  const [cloudDailySummary, setCloudDailySummary] = useState<AgentDailyCloudSummary | null>(null);

  // Period filter states for Shift, Tickets, and History tabs ("today" | "yesterday" | "custom" | "all")
  const [shiftPeriod, setShiftPeriod] = useState<"today" | "yesterday" | "custom" | "all">("today");
  const [ticketFilterPeriod, setTicketFilterPeriod] = useState<"today" | "yesterday" | "custom" | "all">("today");
  const [historyPeriod, setHistoryPeriod] = useState<"today" | "yesterday" | "custom" | "all">("today");
  const [customDate, setCustomDate] = useState<string>(() => getTodayDateStr());

  const agentUserRef = useRef(agentUser);
  useEffect(() => {
    agentUserRef.current = agentUser;
  }, [agentUser]);

  // Helper to always fetch tickets strictly scoped to the active/logged-in agent (Local + Cloud Supabase)
  const refreshAgentTickets = () => {
    const currentAgent = loggedInAgent || agentUserRef.current || getLoggedInAgent();
    const id = currentAgent?.id || currentAgent?.username;
    if (id) {
      setTicketsList(getTickets(id));

      // Asynchronously sync cloud tickets from Supabase `sorat_bets` across devices
      const today = getTodayDateStr();
      fetchAgentDailyTicketsAndBets(id, today)
        .then((res) => {
          if (res.success && res.data) {
            setCloudDailySummary(res.data);
            if (res.data.tickets && res.data.tickets.length > 0) {
              const current = getTickets("all");
              const currentMap = new Map(current.map((t) => [t.ticketId, t]));

              // Update existing tickets with cloud settlement info, add new cloud tickets
              for (const cloudTkt of res.data.tickets as ThermalTicket[]) {
                if (currentMap.has(cloudTkt.ticketId)) {
                  const existing = currentMap.get(cloudTkt.ticketId)!;
                  const finalStatus =
                    existing.status === "CLAIMED" || cloudTkt.status === "CLAIMED"
                      ? "CLAIMED"
                      : cloudTkt.status;
                  currentMap.set(cloudTkt.ticketId, {
                    ...existing,
                    status: finalStatus,
                    winningPayout: cloudTkt.winningPayout ?? existing.winningPayout ?? 0,
                    claimedAt: existing.claimedAt ?? cloudTkt.claimedAt,
                    claimedBy: existing.claimedBy ?? cloudTkt.claimedBy,
                  });
                } else {
                  currentMap.set(cloudTkt.ticketId, cloudTkt);
                }
              }

              const merged = Array.from(currentMap.values());
              saveTickets(merged);
              setTicketsList(getTickets(id));
            }
          }
        })
        .catch(() => {});
    } else {
      setTicketsList([]);
      setCloudDailySummary(null);
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
    if (typeof window === "undefined") return;
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
  }, []);

  // Sync Timer & Clock Rollover
  useEffect(() => {
    const id = setInterval(() => {
      const sync = getSynchronizedRoundState();
      setRoundNumber(sync.roundNumber);
      setRoundId(sync.roundId);
      setPhase(sync.phase);
      setTimer(sync.timeLeft);

      // New round rollover: clear old winner
      if (sync.phase === "bet" && declaredWinner !== null) {
        setDeclaredWinner(null);
      }

      // If in result phase and winner has not been declared yet from TV:
      if (sync.phase === "result" && lastSettledRoundRef.current !== sync.roundNumber) {
        lastSettledRoundRef.current = sync.roundNumber;
        const fallbackWinner =
          declaredWinner ?? resolveProfitGuaranteedWinnerForRound(sync.roundNumber, sync.roundId, null, undefined, activeRoomId);
        if (declaredWinner === null) {
          setDeclaredWinner(fallbackWinner);
        }
        recordRoundWinnerHistory(sync.roundNumber, fallbackWinner);
        settleTicketsForRound(sync.roundId, fallbackWinner, CARDS[fallbackWinner]?.name || "", activeRoomId);
        settleRoundBets(sync.roundId, fallbackWinner, CARDS[fallbackWinner]?.name || "", true);
        autoSettleAllPendingBets(sync.roundNumber, sync.phase, fallbackWinner, true);
        refreshAgentTickets();

        // Instant Counter Balance update (No refresh needed!)
        const u = getLoggedInAgent() || getActiveUser();
        if (u) {
          setAgentUser(u);
          setAgentBalance(u.balance);
        }
        const sb = getSupabaseClient();
        const curAgent = loggedInAgent || agentUserRef.current;
        const targetId = curAgent?.id || curAgent?.username;
        if (sb && targetId) {
          sb.from("players")
            .select("balance")
            .or(`id.eq.${targetId},username.eq.${targetId}`)
            .maybeSingle()
            .then(({ data }) => {
              if (data && typeof data.balance === "number") {
                setAgentBalance(data.balance);
                setAgentUser((prev) => ({ ...prev, balance: data.balance }));
                setUserBalance(targetId, data.balance);
              }
            });
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [declaredWinner, activeRoomId]);

  // Realtime Supabase Subscription for Instant Counter Live Balance Updates (Zero-Refresh)
  useEffect(() => {
    const currentAgent = loggedInAgent || agentUser || getLoggedInAgent();
    const id = currentAgent?.id || currentAgent?.username;
    if (!id) return;

    const unsubBalance = subscribeToPlayerBalanceRealtime(id, (newBalance) => {
      setAgentBalance(newBalance);
      setAgentUser((prev) => ({ ...prev, balance: newBalance }));
      setUserBalance(id, newBalance);
    });

    return () => unsubBalance();
  }, [loggedInAgent?.id, loggedInAgent?.username, agentUser?.id, agentUser?.username]);

  // Realtime Supabase Subscription for Bets and Tickets Sync across all devices
  useEffect(() => {
    const unsubBets = subscribeToSoratBetsRealtime(() => {
      refreshAgentTickets();
    });

    const pollId = setInterval(() => {
      refreshAgentTickets();
    }, 4000);

    return () => {
      unsubBets();
      clearInterval(pollId);
    };
  }, [loggedInAgent?.id, loggedInAgent?.username]);

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

  // Realtime Sync with TV Screen (Counter-Isolated via activeRoomId)
  useEffect(() => {
    const client = new AdminClientSync(activeRoomId);
    clientSyncRef.current = client;

    client.onMessage = (msg: GameMessage) => {
      if (msg.type === "WINNER_DECLARED") {
        setDeclaredWinner(msg.winner);
        recordRoundWinnerHistory(msg.roundNumber, msg.winner);
        settleTicketsForRound(msg.roundId, msg.winner, msg.winnerName, activeRoomId);
        settleRoundBets(msg.roundId, msg.winner, msg.winnerName, true);
        autoSettleAllPendingBets(msg.roundNumber, "select", msg.winner, true);
        refreshAgentTickets();

        // Instant Counter Balance update (No refresh needed!)
        const u = getLoggedInAgent() || getActiveUser();
        if (u) {
          setAgentUser(u);
          setAgentBalance(u.balance);
        }
        const sb = getSupabaseClient();
        const curAgent = loggedInAgent || agentUserRef.current;
        const targetId = curAgent?.id || curAgent?.username;
        if (sb && targetId) {
          sb.from("players")
            .select("balance")
            .or(`id.eq.${targetId},username.eq.${targetId}`)
            .maybeSingle()
            .then(({ data }) => {
              if (data && typeof data.balance === "number") {
                setAgentBalance(data.balance);
                setAgentUser((prev) => ({ ...prev, balance: data.balance }));
                setUserBalance(targetId, data.balance);
              }
            });
        }
      } else if (msg.type === "SYNC_FROM_TV") {
        setRoundNumber(msg.roundNumber);
        setRoundId(msg.roundId);
        setPhase(msg.phase);
        setTimer(msg.t);
        // Accept winner immediately whether in select or result phase
        if (msg.winner !== null && msg.winner >= 0 && msg.winner < 12) {
          setDeclaredWinner(msg.winner);
          recordRoundWinnerHistory(msg.roundNumber, msg.winner);
          settleTicketsForRound(msg.roundId, msg.winner, CARDS[msg.winner]?.name || "", activeRoomId);
          settleRoundBets(msg.roundId, msg.winner, CARDS[msg.winner]?.name || "", true);
          autoSettleAllPendingBets(msg.roundNumber, msg.phase, msg.winner, true);
          refreshAgentTickets();

          // Instant Counter Balance update (No refresh needed!)
          const u = getLoggedInAgent() || getActiveUser();
          if (u) {
            setAgentUser(u);
            setAgentBalance(u.balance);
          }
          const sb = getSupabaseClient();
          const curAgent = loggedInAgent || agentUserRef.current;
          const targetId = curAgent?.id || curAgent?.username;
          if (sb && targetId) {
            sb.from("players")
              .select("balance")
              .or(`id.eq.${targetId},username.eq.${targetId}`)
              .maybeSingle()
              .then(({ data }) => {
                if (data && typeof data.balance === "number") {
                  setAgentBalance(data.balance);
                  setAgentUser((prev) => ({ ...prev, balance: data.balance }));
                  setUserBalance(targetId, data.balance);
                }
              });
          }
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
  }, [activeRoomId]);

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
    if (agentUser.status === "PAUSED") {
      alert("🛑 Ye counter Admin dwara PAUSE kar diya gaya hai! Betting filhaal band hai.");
      return;
    }

    if (phase !== "bet") {
      alert("Betting is currently closed for this round!");
      return;
    }

    if (totalTicketStake <= 0) {
      alert("Kripya kam se kam ek card par daav chunein!");
      return;
    }

    if (!isBalanceEnough) {
      alert(`Balance kam hai! Needed: ${totalTicketStake} PTS, Available: ${agentBalance} PTS. Kripya counter recharge karein!`);
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

    // 4. Create Ticket (Isolated to Counter Room)
    const newTicket = createTicket({
      roundId,
      roundNumber,
      customerName: customerName.trim() || undefined,
      agentName: agentUser.displayName || "Counter Kiosk",
      agentId: agentUser.id,
      username: agentUser.username,
      roomId: activeRoomId,
      items,
    });

    // 5. Send single ATOMIC bet packet to TV Screen for this Counter Room
    clientSyncRef.current?.send({
      type: "ADD_TICKET_BETS",
      bets: { ...selectedCards },
      totalAmount: totalTicketStake,
      agentName: agentUser.displayName,
      roundId,
      roomId: activeRoomId,
    });

    // 6. Direct Supabase Bet Persistence (Async Cloud Audit)
    placeSoratBetsRpc({
      userId: agentUser.id || agentUser.username,
      roundId,
      roundNumber,
      ticketId: newTicket.ticketId,
      customerName: customerName.trim() || undefined,
      dateStr: newTicket.dateStr,
      timeStr: newTicket.timeStr,
      bets: items,
    }).catch(() => {});

    // Refresh tickets & clear staged selection (scoped to current agent)
    setTicketsList(getTickets(agentUser.id || agentUser.username));
    setSelectedCards({});
    setCustomerName("");

    // 7. Direct Thermal Print or Preview Slip
    setPrintTicket(newTicket);
    const paperWidth = ((typeof window !== "undefined" && localStorage.getItem("sorat_printer_width")) as any) || "58mm";
    const autoPrint = typeof window !== "undefined" && localStorage.getItem("sorat_auto_print") !== "false";

    if (autoPrint && isDirectPrinterConnected()) {
      executeDirectPrint(newTicket, paperWidth).then((res) => {
        if (!res.success) {
          setShowSlipModal(true);
        }
      });
    } else {
      setShowSlipModal(true);
    }
  };

  const handleVerifyTicketForClaim = (q?: string) => {
    const query = (q ?? claimSearchInput).trim();
    if (!query) {
      setClaimVerifiedTicket(null);
      setClaimJustPaidTicket(null);
      setClaimHasSearched(false);
      setClaimNotice("Kripya Ticket ID ya 4-digit code daalein.");
      return;
    }
    setClaimJustPaidTicket(null);
    setClaimHasSearched(true);
    setClaimNotice(null);

    let found = findTicketByIdOrBarcode(query);
    if (!found) {
      const cleanQ = query.toLowerCase().replace(/^#/, "");
      const allPool = [
        ...(ticketsList || []),
        ...((cloudDailySummary?.tickets as ThermalTicket[]) || []),
      ];
      found =
        allPool.find(
          (t) =>
            t.ticketId.toLowerCase() === cleanQ ||
            t.ticketId.toLowerCase().replace(/^#/, "") === cleanQ ||
            t.barcode.toLowerCase() === cleanQ ||
            t.ticketId.toLowerCase().endsWith(cleanQ) ||
            t.barcode.endsWith(cleanQ)
        ) || null;
    }

    setClaimVerifiedTicket(found);
    if (!found) {
      setClaimNotice(`Slip #${query} system me nahi mili. Kripya barcode ya ticket number check karein.`);
    }
  };

  const handleDisburseClaimCash = (ticketId: string) => {
    const updated = claimTicket(ticketId, agentUser.displayName || agentUser.username);
    if (updated) {
      setClaimJustPaidTicket(updated);
      setClaimVerifiedTicket(null);
      setClaimSearchInput("");
      setClaimHasSearched(false);
      setClaimNotice(null);
      setTicketsList(getTickets(agentUser?.id || agentUser?.username));
      refreshAgentTickets();
    }
  };

  const handleClaimPrize = (ticketId: string) => {
    const updated = claimTicket(ticketId, agentUser.displayName || agentUser.username);
    if (updated) {
      setTicketsList(getTickets(agentUser?.id || agentUser?.username));
      refreshAgentTickets();
      alert(`Ticket #${ticketId} prize of ${updated.winningPayout} PTS marked as PAID! Customer ko prize de dijiye.`);
    }
  };

  const handleTestPrint = () => {
    const testId = "TEST-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    const testTkt: ThermalTicket = {
      ticketId: testId,
      barcode: "9999111",
      timestamp: Date.now(),
      dateStr: new Date().toISOString().split("T")[0] || todayStr,
      timeStr: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      roundId,
      roundNumber,
      agentId: agentUser.id,
      agentName: agentUser.displayName,
      customerName: "PRINTER TEST SLIP",
      items: [
        { cardIndex: 0, cardName: "पतंग (TEST OK)", amount: 10 },
        { cardIndex: 11, cardName: "गाय (TEST OK)", amount: 10 },
      ],
      totalAmount: 20,
      winningPayout: 0,
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

  // Helper to get direct or synthesized tickets for ANY date string (YYYY-MM-DD)
  const getTicketsForDate = (dateStr: string): ThermalTicket[] => {
    if (!dateStr) return [];
    const directTickets = ticketsList.filter((t) => t.dateStr === dateStr);
    if (directTickets.length > 0) return directTickets;

    // Fallback: Check agentUser.bets for that date and synthesize tickets
    const dateBets = (agentUser?.bets || []).filter((b) => b.dateStr === dateStr);
    if (dateBets.length === 0) return [];

    const roundMap = new Map<string, typeof dateBets>();
    dateBets.forEach((b) => {
      const arr = roundMap.get(b.roundId) || [];
      arr.push(b);
      roundMap.set(b.roundId, arr);
    });

    return Array.from(roundMap.entries())
      .filter(([_, bets]) => bets.length > 0 && bets[0] !== undefined)
      .map(([rId, bets], idx) => {
        const totalAmount = bets.reduce((s, b) => s + b.stake, 0);
        const winningPayout = bets.reduce((s, b) => s + (b.payout || 0), 0);
        const isWin = bets.some((b) => b.isWin || (b.payout && b.payout > 0));
        const firstBet = bets[0]!;
        return {
          ticketId: firstBet.ticketId || `TKT-${dateStr.replace(/-/g, "")}-${idx + 1}`,
          barcode: `${dateStr.replace(/-/g, "").slice(-4)}${idx + 1}`,
          roundId: rId,
          roundNumber: firstBet.roundNumber || 0,
          timestamp: firstBet.timestamp,
          dateStr: firstBet.dateStr || dateStr,
          timeStr: firstBet.timeStr || "12:00 PM",
          customerName: "Counter Customer",
          agentName: agentUser?.displayName || "Kiosk Agent",
          agentId: agentUser?.id,
          username: agentUser?.username,
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
  };

  // Precomputed tickets per date
  const todayTickets = useMemo(() => getTicketsForDate(todayStr), [ticketsList, agentUser?.bets, todayStr]);
  const yesterdayTickets = useMemo(() => getTicketsForDate(yesterdayStr), [ticketsList, agentUser?.bets, yesterdayStr]);
  const customDateTickets = useMemo(() => getTicketsForDate(customDate), [ticketsList, agentUser?.bets, customDate]);

  // All tickets combined (ticketsList + any dates in agentUser.bets)
  const allTicketsCombined = useMemo(() => {
    const map = new Map<string, ThermalTicket>();
    ticketsList.forEach((t) => map.set(t.ticketId, t));
    const allDateBets = agentUser?.bets || [];
    const uniqueDates = Array.from(new Set(allDateBets.map((b) => b.dateStr).filter(Boolean)));
    uniqueDates.forEach((d) => {
      const dTickets = getTicketsForDate(d);
      dTickets.forEach((t) => {
        if (!map.has(t.ticketId)) {
          map.set(t.ticketId, t);
        }
      });
    });
    return Array.from(map.values());
  }, [ticketsList, agentUser?.bets]);

  // Filtered tickets for Tickets Tab
  const filteredTickets = useMemo(() => {
    if (ticketFilterPeriod === "today") return todayTickets;
    if (ticketFilterPeriod === "yesterday") return yesterdayTickets;
    if (ticketFilterPeriod === "custom") return customDateTickets;
    return allTicketsCombined;
  }, [ticketFilterPeriod, todayTickets, yesterdayTickets, customDateTickets, allTicketsCombined]);

  // Shift Tickets for selected period ("today" | "yesterday" | "custom" | "all")
  const shiftTickets = useMemo(() => {
    if (shiftPeriod === "today") return todayTickets;
    if (shiftPeriod === "yesterday") return yesterdayTickets;
    if (shiftPeriod === "custom") return customDateTickets;
    return allTicketsCombined;
  }, [shiftPeriod, todayTickets, yesterdayTickets, customDateTickets, allTicketsCombined]);

  const shiftSales = useMemo(() => {
    if (shiftPeriod === "today" && cloudDailySummary && (cloudDailySummary.sales > 0 || cloudDailySummary.ticketsCount > 0)) {
      return cloudDailySummary.sales;
    }
    const calcDateSales = (dateStr: string) => {
      const tkts = getTicketsForDate(dateStr);
      const tSales = tkts.reduce((sum, t) => sum + t.totalAmount, 0);
      const bSales = (agentUser?.bets || []).filter((b) => b.dateStr === dateStr).reduce((s, b) => s + b.stake, 0);
      return tSales > 0 ? tSales : bSales;
    };

    if (shiftPeriod === "today") return calcDateSales(todayStr);
    if (shiftPeriod === "yesterday") return calcDateSales(yesterdayStr);
    if (shiftPeriod === "custom") return calcDateSales(customDate);
    const tSales = allTicketsCombined.reduce((sum, t) => sum + t.totalAmount, 0);
    const bSales = (agentUser?.bets || []).reduce((sum, b) => sum + b.stake, 0);
    return tSales > 0 ? tSales : bSales;
  }, [shiftPeriod, todayStr, yesterdayStr, customDate, allTicketsCombined, agentUser, ticketsList, cloudDailySummary]);

  const shiftPayouts = useMemo(() => {
    if (shiftPeriod === "today" && cloudDailySummary && (cloudDailySummary.sales > 0 || cloudDailySummary.ticketsCount > 0)) {
      return cloudDailySummary.claimsPaid;
    }
    const calcDatePayouts = (dateStr: string) => {
      const tkts = getTicketsForDate(dateStr);
      const tPayouts = tkts.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
      const bPayouts = (agentUser?.bets || []).filter((b) => b.dateStr === dateStr).reduce((s, b) => s + (b.payout || 0), 0);
      return tPayouts > 0 ? tPayouts : bPayouts;
    };

    if (shiftPeriod === "today") return calcDatePayouts(todayStr);
    if (shiftPeriod === "yesterday") return calcDatePayouts(yesterdayStr);
    if (shiftPeriod === "custom") return calcDatePayouts(customDate);
    const tPayouts = allTicketsCombined.reduce((sum, t) => sum + (t.winningPayout || 0), 0);
    const bPayouts = (agentUser?.bets || []).reduce((sum, b) => sum + (b.payout || 0), 0);
    return tPayouts > 0 ? tPayouts : bPayouts;
  }, [shiftPeriod, todayStr, yesterdayStr, customDate, allTicketsCombined, agentUser, ticketsList, cloudDailySummary]);

  const shiftGrossProfit = shiftSales - shiftPayouts;
  const shiftCommission10 = shiftGrossProfit > 0 ? Math.round(shiftGrossProfit * 0.10) : 0;
  const shiftCashSurplus = Math.max(0, shiftGrossProfit);
  const shiftNetCashToCollect = shiftSales - shiftPayouts - shiftCommission10;

  const handlePrintDailyHisabSlip = () => {
    const curAgent = loggedInAgent || agentUser || getLoggedInAgent();
    if (!curAgent) return;

    const paperWidth = ((typeof window !== "undefined" && localStorage.getItem("sorat_printer_width")) as any) || "58mm";
    const hisabTicket: ThermalTicket = {
      ticketId: `HISAB-${(curAgent.username || "AGENT").toUpperCase()}-${todayStr.replace(/-/g, "")}`,
      barcode: `${todayStr.replace(/-/g, "")}99`,
      roundId: `DAILY-${todayStr}`,
      roundNumber: 0,
      timestamp: Date.now(),
      dateStr: todayStr,
      timeStr: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      customerName: "DAILY CASH SETTLEMENT",
      agentName: curAgent.displayName || curAgent.username,
      agentId: curAgent.id,
      username: curAgent.username,
      items: [
        { cardIndex: 0, cardName: "1. TOTAL SALES (विक्री)", amount: shiftSales },
        { cardIndex: 1, cardName: "2. CLAIMS PAID (वाटप)", amount: -shiftPayouts },
        { cardIndex: 2, cardName: "3. 10% COMM (PROFIT)", amount: -shiftCommission10 },
        { cardIndex: 3, cardName: "4. NET CASH TO COLLECT", amount: shiftNetCashToCollect },
      ],
      totalAmount: shiftSales,
      winningPayout: shiftPayouts,
      status: "SETTLED",
    };

    setPrintTicket(hisabTicket);
    if (isDirectPrinterConnected()) {
      executeDirectPrint(hisabTicket, paperWidth).then((res) => {
        if (!res.success) {
          setShowSlipModal(true);
        }
      });
    } else {
      setShowSlipModal(true);
    }
  };

  // Deposits for selected period
  const shiftDeposits = useMemo(() => {
    const deps = agentUser?.deposits || [];
    if (shiftPeriod === "today") {
      return deps.filter((d) => d.dateStr === todayStr).reduce((s, d) => s + d.amount, 0);
    }
    if (shiftPeriod === "yesterday") {
      return deps.filter((d) => d.dateStr === yesterdayStr).reduce((s, d) => s + d.amount, 0);
    }
    if (shiftPeriod === "custom") {
      return deps.filter((d) => d.dateStr === customDate).reduce((s, d) => s + d.amount, 0);
    }
    return deps.reduce((s, d) => s + d.amount, 0);
  }, [agentUser?.deposits, shiftPeriod, todayStr, yesterdayStr, customDate]);

  // History Tab Filtered Bets
  const historyBets = useMemo(() => {
    const allBets = agentUser?.bets || [];
    if (historyPeriod === "today") return allBets.filter((b) => b.dateStr === todayStr);
    if (historyPeriod === "yesterday") return allBets.filter((b) => b.dateStr === yesterdayStr);
    if (historyPeriod === "custom") return allBets.filter((b) => b.dateStr === customDate);
    return allBets;
  }, [historyPeriod, todayStr, yesterdayStr, customDate, agentUser?.bets]);

  const historyBetsTotalStake = useMemo(() => {
    return historyBets.reduce((s, b) => s + b.stake, 0);
  }, [historyBets]);

  const historyBetsTotalWon = useMemo(() => {
    return historyBets.reduce((s, b) => s + (b.payout || 0), 0);
  }, [historyBets]);

  const historyGrossProfit = historyBetsTotalStake - historyBetsTotalWon;
  const historyCommission10 = historyGrossProfit > 0 ? Math.round(historyGrossProfit * 0.10) : 0;

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
                    <span className="text-[9px] text-emerald-400 font-mono">{u.balance} PTS</span>
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
              href={`/tv?room=${activeRoomId}`}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground text-xs font-bold flex items-center gap-1"
              title={`Open TV Arena Display for Room ${activeRoomId}`}
            >
              <span>📺</span>
              <span className="text-[10px] hidden sm:inline">TV</span>
            </a>

            <PrinterStatusBadge showTextOnMobile={true} />
          </div>
        </div>

        {/* Room / Counter Live Sync Status Bar */}
        <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border/60 px-2.5 py-1 text-[10px]">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-muted-foreground uppercase font-bold">Room:</span>
            <span className="text-primary font-black uppercase tracking-wider">{activeRoomId}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const tvUrl = `${window.location.origin}/tv?room=${activeRoomId}`;
                if (navigator?.clipboard?.writeText) {
                  navigator.clipboard.writeText(tvUrl);
                }
                alert(`TV Screen Link Copied!\n\n${tvUrl}\n\nIs link ko TV browser me open karein.`);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground font-bold flex items-center gap-0.5 cursor-pointer"
              title="Copy link to open on TV"
            >
              📋 Copy TV Link
            </button>
            <a
              href={`/tv?room=${activeRoomId}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-primary hover:underline font-bold flex items-center gap-1"
            >
              <span>📺 Open Room TV ↗</span>
            </a>
          </div>
        </div>

        {/* Counter Balance & 10% Commission Status Card */}
        <div className="flex items-center justify-between rounded-xl bg-background/80 border border-border/80 px-3 py-2 shadow-inner">
          <div>
            <span className="text-[9px] uppercase font-bold text-muted-foreground block">
              Counter Points Balance
            </span>
            <div className="text-xl font-display font-black text-primary leading-none mt-0.5 flex items-center gap-1">
              <span>🪙</span> {agentBalance.toLocaleString("en-IN")} PTS
            </div>
          </div>

          {/* Live 10% Agent Commission Badge (Always visible on Agent POS screen) */}
          <div className="text-center px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/35 shadow-xs">
            <span className="text-[8px] uppercase font-black text-amber-400 block tracking-wider">
              10% Comm. (नफा)
            </span>
            <div className="text-sm font-display font-black text-amber-300 leading-none mt-0.5">
              +{shiftCommission10.toLocaleString("en-IN")} PTS
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
        <div className="grid grid-cols-6 gap-1 bg-muted/80 p-1 rounded-xl border border-border text-xs">
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
            <span className="text-[9px] leading-tight font-bold">Daav</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("claim");
              setClaimSearchInput("");
              setClaimJustPaidTicket(null);
              setClaimVerifiedTicket(null);
              setClaimHasSearched(false);
            }}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 border ${
              activeTab === "claim"
                ? "bg-emerald-500 text-black border-emerald-400 shadow-md font-black"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
            }`}
            title="Claim Winning Ticket"
          >
            <span className="text-sm">💰</span>
            <span className="text-[9px] leading-tight font-black">Claim</span>
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
            <span className="text-[9px] leading-tight font-bold">Slips ({allTicketsCombined.length})</span>
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
            onClick={() => setActiveTab("history")}
            className={`py-2 text-center rounded-lg font-bold transition flex flex-col items-center justify-center gap-0.5 ${
              activeTab === "history"
                ? "bg-primary text-primary-foreground shadow-sm font-black"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-sm">📜</span>
            <span className="text-[9px] leading-tight font-bold">Log</span>
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
            <span className="text-[9px] leading-tight font-black">Print</span>
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
            {/* Emergency Counter Kill-Switch Alert */}
            {agentUser.status === "PAUSED" && (
              <div className="rounded-2xl border-2 border-destructive bg-destructive/20 p-3.5 text-center space-y-1.5 shadow-lg animate-pulse">
                <span className="text-2xl block">🛑</span>
                <h3 className="font-display text-sm font-black text-destructive uppercase">
                  COUNTER BETTING PAUSED BY ADMIN
                </h3>
                <p className="text-xs text-destructive-foreground font-medium">
                  Aapka counter Admin dwara temporarily pause kar diya gaya hai. Kripya main office se sampark karein.
                </p>
              </div>
            )}

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
                    {chip} PTS
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
                      {staked > 0 ? `${staked} PTS` : "+ Add"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB: CLAIM TICKET & ANTI-FRAUD VERIFICATION                   */}
        {/* ============================================================== */}
        {activeTab === "claim" && (
          <div className="space-y-3.5">
            {/* Header Description */}
            <div className="rounded-2xl border border-primary/40 bg-gradient-to-r from-amber-500/15 via-primary/10 to-amber-500/5 p-3.5 shadow-sm space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-gradient-gold grid place-items-center font-display text-lg text-primary-foreground shadow-gold shrink-0">
                  💰
                </div>
                <div>
                  <h2 className="font-display text-sm font-black text-foreground">
                    CLAIM TICKET / तिकीट क्लेम
                  </h2>
                  <p className="text-[10px] text-muted-foreground font-medium">
                    Grahak ki winning slip verify karein aur cash disburse karein. Ek parchi sirf ek baar claim hogi.
                  </p>
                </div>
              </div>

              {/* Fast Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyTicketForClaim();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🎟️</span>
                  <input
                    type="text"
                    autoFocus
                    value={claimSearchInput}
                    onChange={(e) => setClaimSearchInput(e.target.value)}
                    placeholder="Ticket ID / 4-Digit Code (उदा. 9281 किंवा TKT-0845-9281)..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono font-bold focus:border-primary outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-gradient-gold text-primary-foreground font-display text-xs font-black shadow-gold hover:brightness-110 active:scale-95 transition flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <span>🔍</span>
                  <span>VERIFY</span>
                </button>
              </form>
            </div>

            {/* Notification / Error banner */}
            {claimNotice && (
              <div className="rounded-xl border border-primary/40 bg-primary/15 p-2.5 text-center text-xs font-bold text-primary animate-in fade-in">
                {claimNotice}
              </div>
            )}

            {/* JUST PAID SUCCESS CONFIRMATION BANNER */}
            {claimJustPaidTicket && (
              <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-500/20 p-4 shadow-xl text-center space-y-3 animate-in fade-in zoom-in-95">
                <span className="text-4xl block animate-bounce">🎉</span>
                <div>
                  <h3 className="font-display text-base font-black text-emerald-300">
                    CASH DISBURSED SUCCESSFULLY! (रक्कम दिली गेली)
                  </h3>
                  <p className="text-xs text-foreground font-medium mt-1">
                    Slip <strong className="text-primary font-mono">#{claimJustPaidTicket.ticketId}</strong> prize of{" "}
                    <strong className="text-emerald-300 font-mono text-sm font-black">
                      {claimJustPaidTicket.winningPayout?.toLocaleString("en-IN")} PTS
                    </strong>{" "}
                    has been paid to customer.
                  </p>
                  <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase">
                    CLAIMED & CLOSED
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClaimJustPaidTicket(null);
                    setClaimVerifiedTicket(null);
                    setClaimSearchInput("");
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-gold text-primary-foreground font-display text-xs font-black shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>🔍</span>
                  <span>VERIFY NEXT TICKET (पुढील तिकीट तपासा)</span>
                </button>
              </div>
            )}

            {/* VERIFICATION CARD */}
            {claimVerifiedTicket ? (
              <div className="space-y-3 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-mono font-bold text-muted-foreground">
                    Slip #{claimVerifiedTicket.ticketId} • Round {claimVerifiedTicket.roundId}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setClaimVerifiedTicket(null);
                      setClaimSearchInput("");
                      setClaimHasSearched(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>✕</span>
                    <span>Clear (रद्द करा)</span>
                  </button>
                </div>
                {/* CASE 1: WON & UNCLAIMED (BIG GREEN BANNER) */}
                {claimVerifiedTicket.status === "WON" && (
                  <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-500/15 p-4 shadow-xl space-y-3.5">
                    <div className="flex items-center justify-between border-b border-emerald-500/40 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl animate-bounce">🏆</span>
                        <div>
                          <span className="text-xs font-black uppercase text-emerald-400 tracking-wider block">
                            WINNER: Card [{claimVerifiedTicket.winningCardName}] • Payout: {claimVerifiedTicket.winningPayout?.toLocaleString("en-IN")} PTS
                          </span>
                          <span className="font-mono text-xs font-bold text-foreground">
                            Slip #{claimVerifiedTicket.ticketId} • Round {claimVerifiedTicket.roundId}
                          </span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500 text-black text-[10px] font-black uppercase shadow">
                        READY TO PAY
                      </span>
                    </div>

                    {/* Big Payout Amount Callout */}
                    <div className="text-center py-2.5 bg-emerald-500/20 rounded-xl border border-emerald-500/40">
                      <span className="text-[10px] font-bold uppercase text-emerald-300 tracking-widest block">
                        PRIZE PAYOUT TO CUSTOMER (द्यावयाची बक्षीस रक्कम)
                      </span>
                      <div className="text-3xl font-display font-black text-emerald-300 mt-0.5">
                        {claimVerifiedTicket.winningPayout?.toLocaleString("en-IN")} PTS
                      </div>
                      <span className="text-[10px] text-foreground font-medium block mt-0.5">
                        Winning Card: <strong className="text-primary">{claimVerifiedTicket.winningCardName}</strong> (9X Payout)
                      </span>
                    </div>

                    {/* Action Button: Disburse Cash & Mark Claimed */}
                    <button
                      type="button"
                      onClick={() => handleDisburseClaimCash(claimVerifiedTicket.ticketId)}
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-black font-display text-sm font-black shadow-lg hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>💵</span>
                      <span>PAY PRIZE & MARK CLAIMED</span>
                    </button>
                  </div>
                )}

                {/* CASE 2: ALREADY CLAIMED (BIG RED WARNING BANNER) */}
                {claimVerifiedTicket.status === "CLAIMED" && (
                  <div className="rounded-2xl border-2 border-destructive bg-destructive/15 p-4 shadow-xl space-y-3">
                    <div className="flex items-center gap-2.5 border-b border-destructive/40 pb-2">
                      <span className="text-3xl">⚠️</span>
                      <div>
                        <h3 className="font-display text-sm font-black text-destructive uppercase tracking-wide">
                          ALREADY PAID! Do NOT pay again! (पैसे आधीच दिले आहेत)
                        </h3>
                        <p className="text-[11px] text-destructive-foreground font-medium">
                          Claimed at {claimVerifiedTicket.claimedAt ? new Date(claimVerifiedTicket.claimedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "earlier"} by {claimVerifiedTicket.claimedBy || "Counter Agent"}. Do NOT pay again!
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-background/80 border border-border space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount Paid:</span>
                        <strong className="text-destructive font-mono">{claimVerifiedTicket.winningPayout} PTS</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Paid By Agent:</span>
                        <strong className="text-foreground">{claimVerifiedTicket.claimedBy || "Counter Agent"}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Claimed Date & Time:</span>
                        <strong className="text-foreground">
                          {claimVerifiedTicket.claimedAt ? new Date(claimVerifiedTicket.claimedAt).toLocaleString("en-IN") : "Recorded"}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setClaimVerifiedTicket(null);
                        setClaimSearchInput("");
                        setClaimHasSearched(false);
                      }}
                      className="w-full py-2.5 rounded-xl bg-destructive/30 hover:bg-destructive/40 text-destructive-foreground font-display text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span>🔍</span>
                      <span>VERIFY ANOTHER TICKET (दुसरे तिकीट तपासा)</span>
                    </button>
                  </div>
                )}

                {/* CASE 3: LOST TICKET */}
                {claimVerifiedTicket.status === "LOST" && (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 space-y-2.5 text-center">
                    <span className="text-3xl block">❌</span>
                    <h3 className="font-display text-sm font-black text-destructive">
                      Not a Winning Ticket (विजेता नाही)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Round {claimVerifiedTicket.roundId} result: <strong>{claimVerifiedTicket.winningCardName}</strong>. Is ticket par koi jeet nahi hui hai.
                    </p>
                  </div>
                )}

                {/* CASE 4: PENDING / ACTIVE ROUND */}
                {claimVerifiedTicket.status === "ACTIVE" && (
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2.5 text-center">
                    <span className="text-3xl block animate-pulse">⏳</span>
                    <h3 className="font-display text-sm font-black text-amber-300">
                      Round Still Active (खेळ चालू आहे)
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Round {claimVerifiedTicket.roundId} result abhi declare nahi hua hai. Kripya round khatam hone tak wait karein.
                    </p>
                  </div>
                )}

                {/* Ticket Details Receipt View */}
                <div className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-1.5 font-bold">
                    <span>Grahak: {claimVerifiedTicket.customerName}</span>
                    <span className="font-mono text-primary">#{claimVerifiedTicket.ticketId}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Counter: {claimVerifiedTicket.agentName}</span>
                    <span>Date: {claimVerifiedTicket.dateStr} {claimVerifiedTicket.timeStr}</span>
                  </div>
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Bets on Slip:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {claimVerifiedTicket.items.map((it, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
                            claimVerifiedTicket.winningCardIndex === it.cardIndex
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-black"
                              : "bg-muted text-foreground border-border"
                          }`}
                        >
                          {it.cardName}: {it.amount} PTS
                          {claimVerifiedTicket.winningCardIndex === it.cardIndex ? ` 🏆 (WON ${it.amount * 9} PTS)` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : claimHasSearched ? (
              <div className="p-6 text-center space-y-2 border border-dashed border-border rounded-2xl bg-card/40">
                <span className="text-3xl block">🔍</span>
                <span className="text-sm font-black text-muted-foreground block">TICKET NOT FOUND</span>
                <p className="text-xs text-muted-foreground">
                  Ticket ID check karein ya slip par cha number verify karein.
                </p>
              </div>
            ) : (
              /* Quick list of unclaimed winning tickets for this agent */
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                    Unclaimed Winning Tickets ({ticketsList.filter((t) => t.status === "WON").length})
                  </span>
                  <span className="text-[10px] text-primary font-bold">Click to Claim</span>
                </div>

                {ticketsList.filter((t) => t.status === "WON").length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-border bg-card/40 text-center text-xs text-muted-foreground">
                    Koi pending winning ticket nahi hai.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {ticketsList
                      .filter((t) => t.status === "WON")
                      .slice(0, 5)
                      .map((t) => (
                        <div
                          key={t.ticketId}
                          onClick={() => {
                            setClaimJustPaidTicket(null);
                            setClaimSearchInput(t.ticketId);
                            setClaimVerifiedTicket(t);
                            setClaimHasSearched(true);
                          }}
                          className="p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 cursor-pointer transition flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-mono font-black text-emerald-400 block">
                              #{t.ticketId} • Round {t.roundId}
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              {t.customerName} • Card: <strong>{t.winningCardName}</strong>
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-mono font-black text-emerald-400 block">
                              {t.winningPayout} PTS
                            </span>
                            <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500 text-black font-black uppercase">
                              CLAIM PRIZE
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TICKETS LIST & CLAIM INAM */}
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

            {/* Date Period Filter Selector (आज / काल / तारीख / सर्व) */}
            <div className="grid grid-cols-4 gap-1 bg-muted/60 p-1 rounded-xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("today")}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
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
                className={`py-1.5 px-1.5 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "yesterday"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⏪</span> काल ({yesterdayTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("custom")}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "custom"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📆</span> तारीख ({customDateTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setTicketFilterPeriod("all")}
                className={`py-1.5 px-1.5 rounded-lg font-bold text-center transition flex items-center justify-center gap-1 ${
                  ticketFilterPeriod === "all"
                    ? "bg-primary text-primary-foreground font-black shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📊</span> सर्व ({allTicketsCombined.length})
              </button>
            </div>

            {/* Date Picker Input when "custom" is active */}
            {ticketFilterPeriod === "custom" && (
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-card border-2 border-primary/50 shadow-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-base">📅</span>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-primary block leading-none mb-1">
                      पावती तारीख निवडा (Select Ticket Date)
                    </label>
                    <input
                      type="date"
                      value={customDate}
                      max={todayStr}
                      onChange={(e) => {
                        if (e.target.value) setCustomDate(e.target.value);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-2 py-1 font-mono text-xs font-bold text-foreground outline-none focus:border-primary cursor-pointer"
                    />
                  </div>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-primary/15 text-primary border border-primary/30">
                  {customDate}
                </span>
              </div>
            )}

            {/* Period Status Badge */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-muted-foreground">
                {ticketFilterPeriod === "today"
                  ? `आजच्या पावत्या (${todayTickets.length}) • ${todayStr}`
                  : ticketFilterPeriod === "yesterday"
                  ? `कालच्या पावत्या (${yesterdayTickets.length}) • ${yesterdayStr}`
                  : ticketFilterPeriod === "custom"
                  ? `तारीख ${customDate} च्या पावत्या (${customDateTickets.length})`
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
                    : ticketFilterPeriod === "custom"
                    ? `तारीख (${customDate}) साठी कोणतीही पावती सापडली नाही.`
                    : ticketFilterPeriod === "today"
                    ? "आज अद्याप कोणतीही पावती फाडली नाही. नवीन दाव लावा!"
                    : "कोणतीही पावती उपलब्ध नाही."}
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  {ticketFilterPeriod === "yesterday" || ticketFilterPeriod === "custom"
                    ? "निवडलेल्या तारखेला या काऊंटरवरून कोणतेही दाव नोंदवले गेले नव्हते."
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
                        ? `🏆 WON ${t.winningPayout} PTS`
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
                        {item.cardName}: {item.amount} PTS
                      </span>
                    ))}
                    <span className="text-[10px] font-mono font-black text-primary">
                      Total: {t.totalAmount} PTS
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
                          💵 Pay Out {t.winningPayout} PTS
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

        {/* TAB 3: SHIFT REPORT & DATE-WISE HISAB */}
        {activeTab === "shift" && (
          <div className="space-y-3">
            {/* Period Switcher: आज (Today) / काल (Yesterday) / तारीख (Date) / एकूण (All) */}
            <div className="grid grid-cols-4 gap-1 bg-muted/70 p-1 rounded-2xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setShiftPeriod("today")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  shiftPeriod === "today"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📅</span> आज
              </button>
              <button
                type="button"
                onClick={() => setShiftPeriod("yesterday")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  shiftPeriod === "yesterday"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⏪</span> काल
              </button>
              <button
                type="button"
                onClick={() => setShiftPeriod("custom")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  shiftPeriod === "custom"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📆</span> तारीख
              </button>
              <button
                type="button"
                onClick={() => setShiftPeriod("all")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  shiftPeriod === "all"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📊</span> एकूण
              </button>
            </div>

            {/* Date Picker Input when "custom" is active */}
            {shiftPeriod === "custom" && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-card border-2 border-primary/50 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-lg">📆</span>
                  <div className="flex-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-primary block leading-none mb-1">
                      हिशोबाची तारीख निवडा (Select Date)
                    </label>
                    <input
                      type="date"
                      value={customDate}
                      max={todayStr}
                      onChange={(e) => {
                        if (e.target.value) setCustomDate(e.target.value);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1 font-mono text-xs font-black text-foreground outline-none focus:border-primary cursor-pointer"
                    />
                  </div>
                </div>
                <span className="text-[11px] font-mono font-black px-2.5 py-1.5 rounded-xl bg-primary/15 text-primary border border-primary/30">
                  {customDate}
                </span>
              </div>
            )}

            {/* Shift Summary Box */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-sm font-black text-foreground flex items-center gap-1.5">
                    <span>
                      {shiftPeriod === "today"
                        ? "🟢"
                        : shiftPeriod === "yesterday"
                        ? "🟡"
                        : shiftPeriod === "custom"
                        ? "📆"
                        : "🔵"}
                    </span>
                    {shiftPeriod === "today"
                      ? "आजचा हिशोब (Today's Shift)"
                      : shiftPeriod === "yesterday"
                      ? "कालचा हिशोब (Yesterday's Ledger)"
                      : shiftPeriod === "custom"
                      ? `तारीख ${customDate} चा हिशोब (Date Ledger)`
                      : "एकूण हिशोब (All Time Summary)"}
                  </h3>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {shiftPeriod === "today"
                      ? `तारीख: ${todayStr}`
                      : shiftPeriod === "yesterday"
                      ? `तारीख: ${yesterdayStr}`
                      : shiftPeriod === "custom"
                      ? `निवडलेली तारीख: ${customDate}`
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
                  <span className="font-bold text-foreground">{shiftSales.toLocaleString("en-IN")} PTS</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Payouts Given (वाटप):</span>
                  <span className="font-bold text-emerald-400">{shiftPayouts.toLocaleString("en-IN")} PTS</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/50">
                  <span className="text-muted-foreground">Cash Surplus in Drawer (गल्ल्यात शिल्लक):</span>
                  <span className="font-bold text-foreground">
                    {shiftCashSurplus.toLocaleString("en-IN")} PTS
                  </span>
                </div>

                {shiftDeposits > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-border/50">
                    <span className="text-muted-foreground">Counter Recharge / Deposit (जमा):</span>
                    <span className="font-bold text-foreground">{shiftDeposits.toLocaleString("en-IN")} PTS</span>
                  </div>
                )}

                <div className="flex justify-between py-2 bg-primary/10 px-2 rounded-xl border border-primary/30">
                  <div>
                    <span className="font-sans font-bold text-primary block">Your 10% Commission (१०% कमिशन):</span>
                    <span className="text-[9px] text-muted-foreground block font-sans font-medium">10% on Gross Profit (नफ्यावर १०%)</span>
                  </div>
                  <span className="font-display font-black text-sm text-primary">
                    +{shiftCommission10.toLocaleString("en-IN")} PTS
                  </span>
                </div>

                <div className="flex justify-between py-2 bg-emerald-500/10 px-2.5 rounded-xl border border-emerald-500/30">
                  <span className="font-sans font-bold text-emerald-400">Net Cash to Collect (निव्वळ जमा रोकड):</span>
                  <span className="font-display font-black text-sm text-emerald-400">
                    {shiftNetCashToCollect.toLocaleString("en-IN")} PTS
                  </span>
                </div>

                <div className="pt-2 flex items-center justify-between gap-2 border-t border-border/40">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    <span>Cloud Synced with Admin</span>
                  </span>

                  <button
                    type="button"
                    onClick={handlePrintDailyHisabSlip}
                    className="px-3 py-1.5 rounded-xl bg-gradient-gold text-primary-foreground font-display text-[11px] font-black shadow hover:brightness-110 active:scale-95 transition flex items-center gap-1.5 cursor-pointer"
                    title="Print 58mm Thermal Daily Hisab Slip"
                  >
                    <span>🖨️</span>
                    <span>PRINT HISAB SLIP</span>
                  </button>
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
                    : shiftPeriod === "custom"
                    ? `तारीख ${customDate} च्या पावत्या व नोंदी (${shiftTickets.length})`
                    : `सर्व पावत्या व नोंदी (${shiftTickets.length})`}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {shiftPeriod === "custom"
                    ? `तारीख ${customDate} चा तपशील`
                    : shiftPeriod === "yesterday"
                    ? "कालचा संपूर्ण हिशोब"
                    : "तपशीलवार पावती यादी"}
                </span>
              </div>

              {shiftTickets.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs space-y-1">
                  <p className="font-bold">
                    {shiftPeriod === "yesterday"
                      ? `कालच्या तारखेसाठी (${yesterdayStr}) कोणतीही नोंद आढळली नाही.`
                      : shiftPeriod === "custom"
                      ? `तारीख (${customDate}) साठी कोणतीही नोंद आढळली नाही.`
                      : "या कालावधीत कोणतीही पावती आढळली नाही."}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80">
                    {shiftPeriod === "yesterday" || shiftPeriod === "custom"
                      ? "निवडलेल्या तारखेला या काऊंटरवरून कोणतेही दाव लावले गेले नव्हते."
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
                          ? `🏆 WON ${t.winningPayout} PTS`
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
                          {item.cardName}: {item.amount} PTS
                        </span>
                      ))}
                      <span className="text-[10px] font-mono font-black text-primary ml-auto">
                        Total: {t.totalAmount} PTS
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
                      <span>🕒 {t.timeStr} • {t.dateStr}</span>
                      {t.winningPayout && t.winningPayout > 0 && (
                        <span className="text-emerald-400 font-bold">
                          बक्षीस: {t.winningPayout} PTS
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: AGENT MY BETS LOG (TODAY / YESTERDAY / PARTICULAR DATE / ALL) */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {/* Period Switcher: आज / काल / तारीख / सर्व */}
            <div className="grid grid-cols-4 gap-1 bg-muted/70 p-1 rounded-2xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setHistoryPeriod("today")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  historyPeriod === "today"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📅</span> आज ({(agentUser?.bets || []).filter((b) => b.dateStr === todayStr).length})
              </button>
              <button
                type="button"
                onClick={() => setHistoryPeriod("yesterday")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  historyPeriod === "yesterday"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⏪</span> काल ({(agentUser?.bets || []).filter((b) => b.dateStr === yesterdayStr).length})
              </button>
              <button
                type="button"
                onClick={() => setHistoryPeriod("custom")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  historyPeriod === "custom"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📆</span> तारीख ({(agentUser?.bets || []).filter((b) => b.dateStr === customDate).length})
              </button>
              <button
                type="button"
                onClick={() => setHistoryPeriod("all")}
                className={`py-2 px-1.5 rounded-xl font-bold transition flex items-center justify-center gap-1 ${
                  historyPeriod === "all"
                    ? "bg-primary text-primary-foreground font-black shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>📊</span> सर्व ({(agentUser?.bets || []).length})
              </button>
            </div>

            {/* Date Picker Input when "custom" is active */}
            {historyPeriod === "custom" && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-card border-2 border-primary/50 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-lg">📆</span>
                  <div className="flex-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-primary block leading-none mb-1">
                      दाव तारीख निवडा (Select Bet Date)
                    </label>
                    <input
                      type="date"
                      value={customDate}
                      max={todayStr}
                      onChange={(e) => {
                        if (e.target.value) setCustomDate(e.target.value);
                      }}
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1 font-mono text-xs font-black text-foreground outline-none focus:border-primary cursor-pointer"
                    />
                  </div>
                </div>
                <span className="text-[11px] font-mono font-black px-2.5 py-1.5 rounded-xl bg-primary/15 text-primary border border-primary/30">
                  {customDate}
                </span>
              </div>
            )}

            {/* Bets Summary Header Banner */}
            <div className="rounded-2xl border border-border bg-card p-3 shadow-sm flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-[10px] text-muted-foreground block">
                  {historyPeriod === "today"
                    ? `आजचे दाव • ${todayStr}`
                    : historyPeriod === "yesterday"
                    ? `कालचे दाव • ${yesterdayStr}`
                    : historyPeriod === "custom"
                    ? `तारीख ${customDate} चे दाव`
                    : "सर्व दाव इतिहास"}
                </span>
                <span className="font-bold text-foreground">
                  {historyBets.length} दाव लावले
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground block">
                  एकूण दाव: {historyBetsTotalStake} PTS
                </span>
                <span className="font-bold text-emerald-400">
                  बक्षीस: {historyBetsTotalWon} PTS
                </span>
              </div>
            </div>

            {/* Bets List */}
            {historyBets.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs space-y-1">
                <p className="font-bold">
                  {historyPeriod === "yesterday"
                    ? `कालच्या तारखेसाठी (${yesterdayStr}) कोणतेही दाव आढळले नाहीत.`
                    : historyPeriod === "custom"
                    ? `तारीख (${customDate}) साठी कोणतेही दाव आढळले नाहीत.`
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
                        दाव: {b.stake} PTS
                      </span>
                      {b.isWin || (b.payout && b.payout > 0) ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black uppercase">
                          🏆 जिंकले {b.payout} PTS
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
                {totalTicketStake} PTS
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
                  : `PUNCH BET & PRINT SLIP (${totalTicketStake} PTS)`}
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


