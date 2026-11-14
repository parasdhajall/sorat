import React, { useState, useEffect } from "react";
import {
  UserAccount,
  UserProfitStats,
  depositToUser,
  withdrawFromUser,
  setUserBalance,
  createUser,
  deleteUser,
  updateUserPin,
  toggleCounterKillSwitch,
  getUserProfitStats,
  getCategorizedUserBets,
  setActiveUserId,
  getActiveUserId,
  broadcastUsersToCloud,
  autoSettleAllPendingBets,
  resetAllPlatformData,
  purgeAllSupabaseData,
} from "@/lib/userStore";
import { getSynchronizedRoundState, sanitizeRoomId } from "@/lib/realtime";
import { CARDS, getCardByIndex } from "@/lib/cards";
import { getTickets, saveTickets, ThermalTicket } from "@/lib/ticketStore";
import { executeDirectPrint, isDirectPrinterConnected } from "@/lib/thermalPrinter";
import {
  fetchAgentDailyTicketsAndBets,
  subscribeToSoratBetsRealtime,
  subscribeToPlayerBalanceRealtime,
  AgentDailyCloudSummary,
} from "@/lib/supabase";

interface UserAccountsViewProps {
  users: UserAccount[];
  onUsersChange: () => void;
  onActiveUserSync?: (userId: string, balance: number) => void;
}

export function UserAccountsView({
  users,
  onUsersChange,
  onActiveUserSync,
}: UserAccountsViewProps) {
  const activeTvUserId = getActiveUserId();
  const [selectedUserId, setSelectedUserId] = useState<string>(() => {
    return activeTvUserId || users[0]?.id || "";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [betPeriodFilter, setBetPeriodFilter] = useState<"today" | "yesterday" | "all">("today");

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositNote, setDepositNote] = useState<string>("Counter Cash Deposit");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [exactBalanceInput, setExactBalanceInput] = useState<string>("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // New User Modal State
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPin, setNewPin] = useState("1234");
  const [newInitialDeposit, setNewInitialDeposit] = useState("1000");
  const [newNotes, setNewNotes] = useState("");

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 3500);
  };

  const [isResetting, setIsResetting] = useState(false);

  const handleFactoryReset = async () => {
    const confirmed = window.confirm(
      "⚠️ DHYAN DEIN (FACTORY RESET):\n\nKya aap sabhi test bets, rounds, tickets aur user accounts ko permanently delete karna chahte hain?\n\nIske baad platform bilkul FRESH clean slate ho jayega aur aap REAL AGENTS add kar sakenge.\n\nProceed?"
    );
    if (!confirmed) return;

    setIsResetting(true);
    try {
      await purgeAllSupabaseData();
      resetAllPlatformData();
      onUsersChange();
      setSelectedUserId(null);
      showNotification("✅ Platform 100% reset: Ready for real agents!");
    } catch (e: any) {
      alert(e?.message || "Failed to reset");
    } finally {
      setIsResetting(false);
    }
  };

  const handleManualCloudSync = () => {
    broadcastUsersToCloud(users);
    showNotification("☁️ All User Accounts Synced to Phone Apps & APK!");
  };

  // Selected user resolution (strictly matches by ID, username, agentCode or displayName)
  const selectedUser =
    users.find((u) => {
      if (!selectedUserId) return false;
      const cleanTarget = selectedUserId.toLowerCase().replace(/^@/, "");
      const uUser = (u.username || "").toLowerCase().replace(/^@/, "");
      const uCode = (u.agentCode || "").toLowerCase().replace(/^@/, "");

      return (
        u.id === selectedUserId ||
        uUser === cleanTarget ||
        uCode === cleanTarget ||
        u.displayName.toLowerCase() === cleanTarget
      );
    }) || users[0];

  useEffect(() => {
    if (selectedUser && selectedUser.id !== selectedUserId) {
      setSelectedUserId(selectedUser.id);
    }
  }, [selectedUser?.id]);

  // Periodic check to auto-settle any round bets that completed so "IN PLAY" never lags
  useEffect(() => {
    const checkSettlement = () => {
      const sync = getSynchronizedRoundState();
      const didSettle = autoSettleAllPendingBets(sync.roundNumber, sync.phase);
      if (didSettle) {
        onUsersChange();
      }
    };
    checkSettlement();
    const id = setInterval(checkSettlement, 1500);
    return () => clearInterval(id);
  }, [onUsersChange]);

  // Filtered users for search
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.phone && u.phone.includes(q))
    );
  });

  // Profit stats & categorized bets for selected user
  const profitStats: UserProfitStats | null = selectedUser
    ? getUserProfitStats(selectedUser)
    : null;

  const categorizedBets = selectedUser
    ? getCategorizedUserBets(selectedUser)
    : { today: [], yesterday: [], older: [], all: [] };

  const displayedBets =
    betPeriodFilter === "today"
      ? (categorizedBets.today.length > 0 ? categorizedBets.today : categorizedBets.all)
      : betPeriodFilter === "yesterday"
      ? (categorizedBets.yesterday.length > 0 ? categorizedBets.yesterday : categorizedBets.all)
      : categorizedBets.all;

  // Handle Deposit
  const handleQuickDeposit = (amount: number) => {
    if (!selectedUser) return;
    try {
      const updated = depositToUser(selectedUser.id, amount, "Quick Topup");
      onUsersChange();
      if (selectedUser.id === activeTvUserId) {
        onActiveUserSync?.(selectedUser.id, updated.balance);
      }
      showNotification(`${amount.toLocaleString("en-IN")} PTS deposited to ${selectedUser.displayName}!`);
    } catch (e: any) {
      alert(e.message || "Deposit failed");
    }
  };

  const handleCustomDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    const amt = Number(depositAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid deposit amount!");
      return;
    }

    try {
      const note = depositNote.trim() || "Admin Counter Deposit";
      const updated = depositToUser(selectedUser.id, amt, note);
      onUsersChange();
      if (selectedUser.id === activeTvUserId) {
        onActiveUserSync?.(selectedUser.id, updated.balance);
      }
      setDepositAmount("");
      showNotification(`${amt.toLocaleString("en-IN")} PTS deposited successfully!`);
    } catch (e: any) {
      alert(e.message || "Deposit failed");
    }
  };

  const handleWithdraw = () => {
    if (!selectedUser) return;
    const amt = Number(withdrawAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid withdrawal amount!");
      return;
    }
    if (amt > selectedUser.balance) {
      alert("Insufficient user balance!");
      return;
    }

    try {
      const updated = withdrawFromUser(selectedUser.id, amt, "Counter Payout");
      onUsersChange();
      if (selectedUser.id === activeTvUserId) {
        onActiveUserSync?.(selectedUser.id, updated.balance);
      }
      setWithdrawAmount("");
      showNotification(`${amt.toLocaleString("en-IN")} PTS payout processed for ${selectedUser.displayName}`);
    } catch (e: any) {
      alert(e.message || "Withdrawal failed");
    }
  };

  const handleSetExactBalance = () => {
    if (!selectedUser) return;
    const bal = Number(exactBalanceInput);
    if (isNaN(bal) || bal < 0) {
      alert("Please enter a valid balance!");
      return;
    }

    try {
      const updated = setUserBalance(selectedUser.id, bal);
      onUsersChange();
      if (selectedUser.id === activeTvUserId) {
        onActiveUserSync?.(selectedUser.id, updated.balance);
      }
      setExactBalanceInput("");
      showNotification(`Balance set to ${bal.toLocaleString("en-IN")} PTS`);
    } catch (e: any) {
      alert(e.message || "Failed to update balance");
    }
  };

  const handleSetActiveForTV = (userId: string) => {
    setActiveUserId(userId);
    const u = users.find((x) => x.id === userId);
    if (u) {
      onActiveUserSync?.(userId, u.balance);
      const room = sanitizeRoomId(u.agentCode || u.username || u.id);
      if (typeof window !== "undefined") {
        localStorage.setItem("sorat_tv_room", room);
      }
      showNotification(`${u.displayName} is now active on the Game Board / TV (Room: ${room.toUpperCase()})!`);
    }
    onUsersChange();
  };

  // Today's Date in IST
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  // Cloud Live Daily Summary from Supabase `sorat_bets`
  const [cloudDailySummary, setCloudDailySummary] = useState<AgentDailyCloudSummary | null>(null);
  const [isSyncingHisab, setIsSyncingHisab] = useState<boolean>(false);

  // Sync Supabase cloud tickets & bets for selectedUser across devices
  useEffect(() => {
    if (!selectedUser) {
      setCloudDailySummary(null);
      return;
    }

    let isMounted = true;
    const fetchHisab = async () => {
      try {
        setIsSyncingHisab(true);
        const res = await fetchAgentDailyTicketsAndBets(selectedUser.id || selectedUser.username, todayStr);
        if (isMounted && res.success && res.data) {
          setCloudDailySummary(res.data);
          // If tickets arrived from Supabase, merge and update in local ticketStore
          if (res.data.tickets && res.data.tickets.length > 0) {
            const current = getTickets("all");
            const currentMap = new Map(current.map((t) => [t.ticketId, t]));
            for (const cloudTkt of res.data.tickets as ThermalTicket[]) {
              if (currentMap.has(cloudTkt.ticketId)) {
                const existing = currentMap.get(cloudTkt.ticketId)!;
                currentMap.set(cloudTkt.ticketId, {
                  ...existing,
                  status: cloudTkt.status,
                  winningPayout: cloudTkt.winningPayout ?? existing.winningPayout ?? 0,
                  ...(cloudTkt.claimedAt ? { claimedAt: cloudTkt.claimedAt } : {}),
                  ...(cloudTkt.claimedBy ? { claimedBy: cloudTkt.claimedBy } : {}),
                });
              } else {
                currentMap.set(cloudTkt.ticketId, cloudTkt);
              }
            }
            saveTickets(Array.from(currentMap.values()));
          }
        }
      } catch {} finally {
        if (isMounted) setIsSyncingHisab(false);
      }
    };

    fetchHisab();

    // Realtime postgres changes listener on `sorat_bets`
    const unsubBets = subscribeToSoratBetsRealtime(() => {
      fetchHisab();
    });

    // Realtime postgres changes listener on `players` balance for instant wallet balance sync
    const selIdentifier = selectedUser.id || selectedUser.username;
    const unsubBalance = subscribeToPlayerBalanceRealtime(selIdentifier, () => {
      onUsersChange();
    });

    const intervalId = setInterval(fetchHisab, 4000);

    return () => {
      isMounted = false;
      unsubBets();
      unsubBalance();
      clearInterval(intervalId);
    };
  }, [selectedUser?.id, selectedUser?.username, todayStr]);

  // Calculate Live Daily Settlement for Selected Agent (Cloud-First with Local Fallback)
  const localAgentTickets = selectedUser
    ? getTickets(selectedUser.id || selectedUser.username).filter((t) => t.dateStr === todayStr)
    : [];

  const agentTicketsToday: ThermalTicket[] =
    cloudDailySummary?.tickets && cloudDailySummary.tickets.length > 0
      ? (cloudDailySummary.tickets as ThermalTicket[])
      : localAgentTickets;

  const ticketSalesToday = agentTicketsToday.reduce((sum, t) => sum + t.totalAmount, 0);
  const userBetsToday = selectedUser ? (selectedUser.bets || []).filter((b) => b.dateStr === todayStr) : [];
  const betsSalesToday = userBetsToday.reduce((sum, b) => sum + b.stake, 0);

  const liveSalesToday =
    cloudDailySummary && cloudDailySummary.sales > 0
      ? cloudDailySummary.sales
      : ticketSalesToday > 0
      ? ticketSalesToday
      : betsSalesToday;

  const ticketClaimsToday = agentTicketsToday
    .filter((t) => t.status === "CLAIMED" || t.status === "WON")
    .reduce((sum, t) => sum + (t.winningPayout || 0), 0);
  const betsPayoutsToday = userBetsToday.reduce((sum, b) => sum + (b.payout || 0), 0);

  const liveClaimsToday =
    cloudDailySummary && (cloudDailySummary.claimsPaid > 0 || cloudDailySummary.sales > 0)
      ? cloudDailySummary.claimsPaid
      : ticketClaimsToday > 0
      ? ticketClaimsToday
      : betsPayoutsToday;

  const liveGrossProfit = liveSalesToday - liveClaimsToday;
  const liveCommission10 = liveGrossProfit > 0 ? Math.round(liveGrossProfit * 0.10) : 0;
  const liveNetCashToCollect = liveSalesToday - liveClaimsToday - liveCommission10;

  const handlePrintDailyHisabSlip = () => {
    if (!selectedUser) return;
    const hisabTicket: ThermalTicket = {
      ticketId: `HISAB-${selectedUser.username.toUpperCase()}-${todayStr.replace(/-/g, "")}`,
      barcode: `${todayStr.replace(/-/g, "")}99`,
      roundId: `DAILY-${todayStr}`,
      roundNumber: 0,
      timestamp: Date.now(),
      dateStr: todayStr,
      timeStr: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      customerName: "DAILY CASH SETTLEMENT",
      agentName: selectedUser.displayName,
      agentId: selectedUser.id,
      username: selectedUser.username,
      items: [
        { cardIndex: 0, cardName: "Total Sales (विक्री)", amount: liveSalesToday },
        { cardIndex: 1, cardName: "Claims Paid (दावे वाटप)", amount: liveClaimsToday },
        { cardIndex: 2, cardName: "10% Comm (नफ्यावर १०%)", amount: liveCommission10 },
        { cardIndex: 3, cardName: "Net Cash (जमा रोकड)", amount: liveNetCashToCollect },
      ],
      totalAmount: liveSalesToday,
      status: "CLAIMED",
      winningPayout: liveClaimsToday,
    };

    if (isDirectPrinterConnected()) {
      executeDirectPrint(hisabTicket, "58mm");
      showNotification(`Daily Hisab Slip sent to 58mm printer for ${selectedUser.displayName}!`);
    } else {
      const hisabText = `=== SORAT DAILY HISAB SLIP ===\nDate: ${todayStr}\nAgent: ${selectedUser.displayName} (@${selectedUser.username})\n-------------------------------\nTotal Sales (विक्री): ${liveSalesToday} PTS\nClaims Paid (दावे): ${liveClaimsToday} PTS\nGross Profit (नफा): ${liveGrossProfit} PTS\n10% Commission (नफ्यावर): ${liveCommission10} PTS\n-------------------------------\nNET CASH TO COLLECT: ${liveNetCashToCollect} PTS\n===============================\n(Connect Bluetooth thermal printer in POS App to print)`;
      alert(hisabText);
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDisplayName.trim()) {
      alert("Please enter a user display name!");
      return;
    }

    try {
      const created = createUser({
        displayName: newDisplayName.trim(),
        username: newUsername.trim() || newDisplayName.trim().toLowerCase().replace(/\s+/g, "_"),
        phone: newPhone.trim(),
        pin: newPin.trim() || "1234",
        initialDeposit: Number(newInitialDeposit) || 0,
        notes: newNotes.trim(),
      });

      onUsersChange();
      setSelectedUserId(created.id);
      setIsAddUserOpen(false);
      setNewDisplayName("");
      setNewUsername("");
      setNewPhone("");
      setNewPin("1234");
      setNewInitialDeposit("1000");
      setNewNotes("");
      showNotification(`Account created for ${created.displayName}! Synced to mobile apps.`);
    } catch (e: any) {
      alert(e.message || "Failed to create user");
    }
  };

  const handleDeleteUser = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete user account "${name}"? All deposit and bet history will be removed.`)) {
      deleteUser(id);
      onUsersChange();
      const remaining = users.filter((u) => u.id !== id);
      if (remaining.length > 0 && remaining[0]) {
        setSelectedUserId(remaining[0].id);
      }
      showNotification(`Account ${name} removed.`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast banner */}
      {actionSuccessMsg && (
        <div className="rounded-xl bg-emerald-500/20 border border-emerald-500/50 p-2.5 text-center text-xs font-bold text-emerald-300 animate-in fade-in zoom-in-95 flex items-center justify-center gap-2">
          <span>✅</span>
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {/* Aggregate Platform Quick Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-border bg-card p-2.5">
          <span className="text-[9px] uppercase font-bold text-muted-foreground block">Registered Accounts</span>
          <span className="text-base font-display font-black text-foreground">{users.length} Players</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-2.5">
          <span className="text-[9px] uppercase font-bold text-muted-foreground block">Total Deposited</span>
          <span className="text-base font-display font-black text-foreground">
            {users.reduce((acc, u) => acc + (u.totalDeposited || 0), 0).toLocaleString("en-IN")} PTS
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card p-2.5">
          <span className="text-[9px] uppercase font-bold text-muted-foreground block">Total In Balances</span>
          <span className="text-base font-display font-black text-primary">
            {users.reduce((acc, u) => acc + (u.balance || 0), 0).toLocaleString("en-IN")} PTS
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card p-2.5">
          <span className="text-[9px] uppercase font-bold text-muted-foreground block">Total Bets Logged</span>
          <span className="text-base font-display font-black text-foreground">
            {users.reduce((acc, u) => acc + (u.bets?.length || 0), 0)} Bets
          </span>
        </div>
      </div>

      {/* Top Bar: Search, Stats, Add User */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search accounts by name, username, or phone..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-input bg-card text-foreground text-xs font-medium focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleFactoryReset}
            disabled={isResetting}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-destructive/40 bg-destructive/15 text-destructive font-display text-xs font-bold hover:bg-destructive/25 transition active:scale-95 disabled:opacity-50"
            title="Factory Reset: Purge all test data from Supabase & local storage"
          >
            <span>🔴</span>
            <span>{isResetting ? "Resetting..." : "Factory Reset / Clean Slate"}</span>
          </button>

          <button
            type="button"
            onClick={handleManualCloudSync}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-display text-xs font-bold hover:bg-emerald-500/25 transition active:scale-95"
            title="Force push accounts to all phone POS terminals"
          >
            <span>☁️</span>
            <span>Sync to Phone App</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddUserOpen(true)}
            className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95"
          >
            <span>➕</span>
            <span>ADD NEW USER ACCOUNT</span>
          </button>
        </div>
      </div>

      {/* Main Grid: User List (Left) + Selected User Management Dossier (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ============================================================== */}
        {/* LEFT COLUMN: USERS LIST DIRECTORY (4 cols)                     */}
        {/* ============================================================== */}
        <div className="lg:col-span-4 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              User Accounts ({filteredUsers.length})
            </span>
            <span className="text-[10px] text-muted-foreground">Click to manage</span>
          </div>

          <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
            {users.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center space-y-3">
                <div className="text-3xl">👥</div>
                <div className="space-y-1">
                  <h4 className="font-display text-sm font-black text-foreground">
                    Clean Slate: No Agent Accounts Yet
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    All test data has been cleared. Click below to register your first real counter / agent.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(true)}
                  className="inline-flex items-center gap-1.5 py-2 px-3.5 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95"
                >
                  <span>➕ ADD FIRST AGENT</span>
                </button>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground text-xs">
                No users found matching "{searchQuery}"
              </div>
            ) : (
              filteredUsers.map((u) => {
                const stats = getUserProfitStats(u);
                const isSelected = u.id === selectedUser?.id;
                const isTvActive = u.id === activeTvUserId;

                return (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className={`rounded-xl border p-3 cursor-pointer transition active:scale-[0.99] relative ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-gold"
                        : "border-border/80 bg-card hover:border-primary/50 hover:bg-card/90"
                    }`}
                  >
                    {/* Top Row: Avatar + Name + TV Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500/30 to-yellow-600/20 border border-primary/40 grid place-items-center font-display text-sm font-bold text-primary">
                          {u.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-display text-sm font-extrabold text-foreground leading-tight">
                              {u.displayName}
                            </span>
                            {isTvActive && (
                              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[8px] font-black text-emerald-400">
                                TV ACTIVE
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground block leading-tight">
                            @{u.username} {u.phone ? `• ${u.phone}` : ""}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] uppercase font-bold text-muted-foreground block leading-tight">
                          Balance
                        </span>
                        <span className="text-sm font-display font-black text-primary leading-tight">
                          {u.balance.toLocaleString("en-IN")} PTS
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Deposited & Profit Badges & 10% Agent Commission */}
                    <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] gap-1 flex-wrap">
                      <div>
                        <span className="text-muted-foreground">Dep: </span>
                        <span className="font-mono font-bold text-foreground">
                          {(u.totalDeposited || 0).toLocaleString("en-IN")} PTS
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 ml-auto">
                        <span
                          className={`font-mono font-black px-1.5 py-0.5 rounded text-[9px] ${
                            (stats.totalBetAmount - stats.totalWonAmount) >= 0
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-destructive/20 text-destructive border border-destructive/30"
                          }`}
                          title="House Net Profit"
                        >
                          {(stats.totalBetAmount - stats.totalWonAmount) >= 0
                            ? `+${(stats.totalBetAmount - stats.totalWonAmount).toLocaleString("en-IN")} PTS`
                            : `-${Math.abs(stats.totalBetAmount - stats.totalWonAmount).toLocaleString("en-IN")} PTS`}
                        </span>

                        <span
                          className="font-mono font-black px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/35"
                          title="10% Agent Commission on Net Profit"
                        >
                          Comm: +{Math.max(0, Math.round(((stats.totalBetAmount - stats.totalWonAmount) > 0 ? (stats.totalBetAmount - stats.totalWonAmount) * 0.10 : 0))).toLocaleString("en-IN")} PTS
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ============================================================== */}
        {/* RIGHT COLUMN: SELECTED USER FULL DOSSIER & ACTIONS (8 cols)    */}
        {/* ============================================================== */}
        {selectedUser && profitStats ? (
          <div className="lg:col-span-8 space-y-3.5">
            {/* Header: User Profile Banner */}
            <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-gold grid place-items-center font-display text-xl font-black text-primary-foreground shadow-gold">
                    {selectedUser.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-black text-foreground">
                        {selectedUser.displayName}
                      </h2>
                      {selectedUser.status === "PAUSED" ? (
                        <span className="rounded-full bg-destructive/20 border border-destructive/50 px-2 py-0.5 text-[9px] font-black text-destructive uppercase animate-pulse">
                          🛑 BETTING PAUSED
                        </span>
                      ) : (
                        <span className="rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5 text-[9px] font-black text-primary uppercase">
                          {selectedUser.status}
                        </span>
                      )}
                      {selectedUser.id === activeTvUserId && (
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-black text-emerald-400 uppercase">
                          🎮 TV Game Player
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      Username: <span className="text-foreground">@{selectedUser.username}</span> | Phone:{" "}
                      <span className="text-foreground">{selectedUser.phone || "N/A"}</span>
                      {selectedUser.notes ? ` • Note: ${selectedUser.notes}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
                  {/* Emergency Counter Kill-Switch Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const isCurrentlyPaused = selectedUser.status === "PAUSED";
                      const confirmMsg = isCurrentlyPaused
                        ? `Kya aap Counter "${selectedUser.displayName}" par betting RESUME karna chahte hain?`
                        : `🛑 DHYAN DEIN: Kya aap Counter "${selectedUser.displayName}" par betting PAUSE (Kill-Switch) karna chahte hain? Agent ticket nahi bana payega.`;
                      if (confirm(confirmMsg)) {
                        toggleCounterKillSwitch(selectedUser.id);
                        onUsersChange();
                        showNotification(
                          isCurrentlyPaused
                            ? `✅ Counter ${selectedUser.displayName} resumed (Active)!`
                            : `🛑 Counter ${selectedUser.displayName} PAUSED via Kill-Switch!`
                        );
                      }
                    }}
                    className={`py-1.5 px-3 rounded-xl text-xs font-black transition active:scale-95 flex items-center justify-center gap-1 border ${
                      selectedUser.status === "PAUSED"
                        ? "bg-amber-500 text-black border-amber-400 hover:bg-amber-400 animate-pulse font-mono shadow-gold"
                        : "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25"
                    }`}
                    title="Emergency Counter Betting Kill-Switch"
                  >
                    <span>{selectedUser.status === "PAUSED" ? "▶️" : "🛑"}</span>
                    <span>{selectedUser.status === "PAUSED" ? "RESUME COUNTER" : "KILL-SWITCH (PAUSE)"}</span>
                  </button>

                  {selectedUser.id !== activeTvUserId ? (
                    <button
                      type="button"
                      onClick={() => handleSetActiveForTV(selectedUser.id)}
                      className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition active:scale-95 flex items-center justify-center gap-1"
                    >
                      <span>🎮</span>
                      <span>Set as TV Active Player</span>
                    </button>
                  ) : (
                    <span className="py-1.5 px-3 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-bold flex items-center gap-1">
                      <span>✓</span>
                      <span>Currently Playing on TV</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeleteUser(selectedUser.id, selectedUser.displayName)}
                    className="p-1.5 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 text-xs font-bold transition"
                    title="Delete Account"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>

            {/* AGENT APP LOGIN CREDENTIALS BANNER */}
            <div className="rounded-2xl border border-primary/40 bg-gradient-to-r from-amber-500/15 via-primary/10 to-amber-500/5 p-3.5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/20 border border-primary/40 grid place-items-center text-lg">
                  📱
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-black text-foreground">
                      Agent App Login Credentials
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-[9px] font-mono font-black text-primary">
                      POS READY
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs">
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase font-bold block">Agent ID</span>
                      <span className="font-mono font-black text-primary text-sm">@{selectedUser.username}</span>
                    </div>
                    <div className="h-5 w-px bg-border hidden sm:block" />
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase font-bold block">Login PIN</span>
                      <span className="font-mono font-black text-emerald-400 text-sm">
                        {selectedUser.pin || "1234"}
                      </span>
                    </div>
                    <div className="h-5 w-px bg-border hidden sm:block" />
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase font-bold block">Prepaid Wallet</span>
                      <span className="font-mono font-black text-foreground text-sm">
                        {selectedUser.balance.toLocaleString("en-IN")} PTS
                      </span>
                    </div>
                    <div className="h-5 w-px bg-border hidden sm:block" />
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase font-bold block">Counter Room</span>
                      <span className="font-mono font-black text-amber-400 text-sm">
                        {(selectedUser.agentCode || selectedUser.username).toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
                <a
                  href={`/tv?room=${selectedUser.agentCode || selectedUser.username || selectedUser.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-black shadow transition flex items-center gap-1.5"
                  title="Open live TV Screen display for this counter"
                >
                  <span>📺</span>
                  <span>Open {selectedUser.displayName.split(" ")[0]}'s TV</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    const newPin = prompt(`Enter new 4-digit PIN for ${selectedUser.displayName}:`, selectedUser.pin || "1234");
                    if (newPin && newPin.trim()) {
                      updateUserPin(selectedUser.id, newPin.trim());
                      onUsersChange();
                      showNotification(`PIN updated to ${newPin.trim()} for ${selectedUser.displayName}`);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-muted text-xs font-bold text-foreground transition"
                >
                  🔑 Change PIN
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const text = `🎰 *SORAT AGENT POS LOGIN CREDENTIALS* 🎰\n\n👤 *Agent Name:* ${selectedUser.displayName}\n🆔 *Agent ID:* ${selectedUser.username}\n🔑 *Login PIN:* ${selectedUser.pin || "1234"}\n🪙 *Prepaid Balance:* ${selectedUser.balance.toLocaleString("en-IN")} PTS\n\n📲 *Agent POS App Link:* ${window.location.origin}/agent\n\n_Is link ko open karein aur apna Agent ID aur PIN daal kar counter shuru karein._`;
                    navigator.clipboard.writeText(text);
                    showNotification("WhatsApp login details copied to clipboard!");
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow transition flex items-center gap-1.5"
                >
                  <span>📲</span>
                  <span>Share on WhatsApp</span>
                </button>
              </div>
            </div>

            {/* DAILY CASH-IN-HAND SETTLEMENT (दैनिक रोकड हिशोब) */}
            <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 via-emerald-600/10 to-teal-900/20 p-4 shadow-md space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/30 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-emerald-500/25 border border-emerald-500/40 grid place-items-center text-lg">
                    💵
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-black text-foreground flex items-center gap-2">
                      <span>DAILY CASH-IN-HAND SETTLEMENT</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono">
                        {todayStr}
                      </span>
                    </h3>
                    <p className="text-[11px] text-muted-foreground font-medium">
                      आजचा रोकड हिशोब: विक्री (Bikri) - वाटप (Claims) - १०% कमिशन = निव्वळ जमा रोकड
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrintDailyHisabSlip}
                    className="px-3.5 py-2 rounded-xl bg-gradient-gold text-primary-foreground font-display text-xs font-black shadow-gold hover:brightness-110 active:scale-95 transition flex items-center gap-1.5 cursor-pointer"
                    title="Print 58mm Thermal Slip for Daily Hisab"
                  >
                    <span>🖨️</span>
                    <span>PRINT HISAB SLIP</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const hisabMsg = `📊 *SORAT DAILY CASH SETTLEMENT* 📊\n\n📅 *Date:* ${todayStr}\n👤 *Agent:* ${selectedUser.displayName} (@${selectedUser.username})\n\n💰 *Total Bikri (विक्री):* ${liveSalesToday.toLocaleString("en-IN")} PTS\n🏆 *Claims Paid (दावे वाटप):* ${liveClaimsToday.toLocaleString("en-IN")} PTS\n📈 *Gross Profit (नफा):* ${liveGrossProfit.toLocaleString("en-IN")} PTS\n🪙 *10% Commission (नफ्यावर १०%):* ${liveCommission10.toLocaleString("en-IN")} PTS\n\n━━━━━━━━━━━━━━━━━━━━\n💵 *NET CASH TO COLLECT (जमा रोकड):* ${liveNetCashToCollect.toLocaleString("en-IN")} PTS\n━━━━━━━━━━━━━━━━━━━━\n\n_Sorat Physical Counter Network System_`;
                      navigator.clipboard.writeText(hisabMsg);
                      showNotification("Daily Hisab copied to clipboard!");
                      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(hisabMsg)}`, "_blank");
                    }}
                    className="p-2 rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-bold transition"
                    title="Share Daily Settlement on WhatsApp"
                  >
                    📲
                  </button>
                </div>
              </div>

              {/* 4 Financial Columns: Sales | Claims Paid | 10% Comm | Net Cash to Collect */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="rounded-xl bg-background/60 border border-border/80 p-2.5">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">1. Total Sales (विक्री)</span>
                  <div className="text-base font-display font-black text-foreground mt-0.5">
                    {liveSalesToday.toLocaleString("en-IN")} PTS
                  </div>
                  <span className="text-[9px] text-muted-foreground block">{agentTicketsToday.length} ticket(s)</span>
                </div>

                <div className="rounded-xl bg-background/60 border border-border/80 p-2.5">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">2. Claims Paid (दावे)</span>
                  <div className="text-base font-display font-black text-destructive mt-0.5">
                    -{liveClaimsToday.toLocaleString("en-IN")} PTS
                  </div>
                  <span className="text-[9px] text-muted-foreground block">
                    {agentTicketsToday.filter((t) => t.status === "CLAIMED" || t.status === "WON").length} winning claim(s)
                  </span>
                </div>

                <div className="rounded-xl bg-background/60 border border-border/80 p-2.5">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block">3. 10% Agent Comm.</span>
                  <div className="text-base font-display font-black text-amber-400 mt-0.5">
                    -{liveCommission10.toLocaleString("en-IN")} PTS
                  </div>
                  <span className="text-[9px] text-muted-foreground block">10% on Net Profit</span>
                </div>

                <div className="rounded-xl bg-emerald-500/25 border border-emerald-500/50 p-2.5 shadow-sm">
                  <span className="text-[9px] uppercase font-bold text-emerald-300 block">4. Net Cash to Collect</span>
                  <div className={`text-lg font-display font-black mt-0.5 ${liveNetCashToCollect >= 0 ? "text-emerald-300" : "text-destructive"}`}>
                    {liveNetCashToCollect.toLocaleString("en-IN")} PTS
                  </div>
                  <span className="text-[9px] text-emerald-400 font-bold block">
                    {liveNetCashToCollect >= 0 ? "जमा करावयाची रोकड" : "Payable Deficit"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 HIGHLIGHT METRIC CARDS: DEPOSITED | PROFIT | BALANCE | STATS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {/* Card 1: HOW MUCH DEPOSITED */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                    📥 Total Deposited
                  </span>
                  <span className="text-xs">💳</span>
                </div>
                <div className="mt-1 text-xl font-display font-black text-foreground">
                  {profitStats.totalDeposited.toLocaleString("en-IN")} PTS
                </div>
                <span className="text-[9px] text-muted-foreground block mt-0.5">
                  {selectedUser.deposits?.length || 0} lifetime deposit(s)
                </span>
              </div>

              {/* Card 2: LIVE WALLET BALANCE */}
              <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    🪙 Current Balance
                  </span>
                  <span className="text-xs">💰</span>
                </div>
                <div className="mt-1 text-xl font-display font-black text-primary">
                  {profitStats.currentBalance.toLocaleString("en-IN")} PTS
                </div>
                <span className="text-[9px] text-muted-foreground block mt-0.5">
                  Available to wager on cards
                </span>
              </div>

              {/* Card 3: HOUSE GROSS PROFIT */}
              {(() => {
                const effectiveBetAmount =
                  cloudDailySummary && cloudDailySummary.sales > 0
                    ? cloudDailySummary.sales
                    : profitStats.totalBetAmount;
                const effectiveWonAmount =
                  cloudDailySummary && (cloudDailySummary.sales > 0 || cloudDailySummary.claimsPaid > 0)
                    ? cloudDailySummary.claimsPaid
                    : profitStats.totalWonAmount;
                const houseProfit = effectiveBetAmount - effectiveWonAmount;
                const isHouseGreen = houseProfit >= 0;
                return (
                  <div
                    className={`rounded-xl border p-3 ${
                      isHouseGreen
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          isHouseGreen ? "text-emerald-400" : "text-destructive"
                        }`}
                      >
                        🏛️ House Gross Profit
                      </span>
                      <span className="text-xs">💰</span>
                    </div>
                    <div
                      className={`mt-1 text-xl font-display font-black ${
                        isHouseGreen ? "text-emerald-400" : "text-destructive"
                      }`}
                    >
                      {isHouseGreen
                        ? `+${houseProfit.toLocaleString("en-IN")} PTS`
                        : `-${Math.abs(houseProfit).toLocaleString("en-IN")} PTS`}
                    </div>
                    <span className="text-[9px] text-muted-foreground block mt-0.5 font-mono">
                      Staked {effectiveBetAmount.toLocaleString("en-IN")} PTS • Won {effectiveWonAmount.toLocaleString("en-IN")} PTS
                    </span>
                  </div>
                );
              })()}

              {/* Card 4: BETTING WIN RATE */}
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                    🎯 Win Rate & Bets
                  </span>
                  <span className="text-xs">🎲</span>
                </div>
                <div className="mt-1 text-xl font-display font-black text-foreground">
                  {profitStats.winRate}%
                </div>
                <span className="text-[9px] text-muted-foreground block mt-0.5">
                  {profitStats.winCount} Won / {profitStats.lossCount} Lost ({profitStats.totalBetsPlaced} total)
                </span>
              </div>
            </div>

            {/* ============================================================== */}
            {/* DEPOSIT FUNDS PANEL: "HOW MUCH I DEPOSITED IN THEIR ACCOUNT"     */}
            {/* ============================================================== */}
            <div className="rounded-2xl border border-border bg-card p-3.5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">💳</span>
                  <h3 className="font-display text-sm font-extrabold text-foreground">
                    Deposit Points into {selectedUser.displayName}'s Account
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground">
                  Live Balance: {selectedUser.balance.toLocaleString("en-IN")} PTS
                </span>
              </div>

              {/* Quick Deposit Chips */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Quick Deposit Amounts:
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[100, 200, 500, 1000, 2000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => handleQuickDeposit(amt)}
                      className="py-1.5 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition active:scale-95 shadow-sm"
                    >
                      +{amt.toLocaleString("en-IN")} PTS
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Deposit Form */}
              <form onSubmit={handleCustomDeposit} className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
                <div className="sm:col-span-5 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-[10px] font-bold">
                    PTS
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="Enter deposit amount (e.g. 1500)"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-4">
                  <input
                    type="text"
                    value={depositNote}
                    onChange={(e) => setDepositNote(e.target.value)}
                    placeholder="Deposit note (Cash, UPI, etc.)"
                    className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground text-xs focus:border-primary focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    className="w-full py-2 px-3 rounded-xl bg-gradient-gold text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95"
                  >
                    📥 DEPOSIT NOW
                  </button>
                </div>
              </form>

              {/* Secondary Actions: Withdraw / Set Balance Accordion-style bar */}
              <div className="pt-2 border-t border-border/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                {/* Withdraw */}
                <div className="flex items-center gap-1.5 flex-1 min-w-[220px]">
                  <input
                    type="number"
                    min="1"
                    max={selectedUser.balance}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="Withdraw PTS"
                    className="w-32 px-2.5 py-1.5 rounded-lg border border-input bg-background font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleWithdraw}
                    className="py-1.5 px-3 rounded-lg bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25 text-xs font-bold transition"
                  >
                    📤 Withdraw
                  </button>
                </div>

                {/* Set Exact Balance */}
                <div className="flex items-center gap-1.5 flex-1 min-w-[220px] justify-end">
                  <input
                    type="number"
                    min="0"
                    value={exactBalanceInput}
                    onChange={(e) => setExactBalanceInput(e.target.value)}
                    placeholder="Exact PTS"
                    className="w-32 px-2.5 py-1.5 rounded-lg border border-input bg-background font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleSetExactBalance}
                    className="py-1.5 px-2.5 rounded-lg bg-muted border border-border text-foreground hover:bg-accent text-xs font-bold transition"
                  >
                    Set Balance
                  </button>
                </div>
              </div>

              {/* Collapsible Deposit History Ledger */}
              {selectedUser.deposits && selectedUser.deposits.length > 0 && (
                <details className="pt-1 text-xs group">
                  <summary className="cursor-pointer text-primary font-bold hover:underline select-none">
                    📜 View Deposit History Ledger ({selectedUser.deposits.length} deposits recorded)
                  </summary>
                  <div className="mt-2 overflow-x-auto max-h-48 border border-border/60 rounded-xl bg-background/60 p-2">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-border/60 text-muted-foreground font-mono">
                          <th className="py-1 px-2">Date & Time</th>
                          <th className="py-1 px-2">Deposit Amount</th>
                          <th className="py-1 px-2">Note / Source</th>
                          <th className="py-1 px-2 text-right">Balance After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 font-mono">
                        {selectedUser.deposits.map((dep) => (
                          <tr key={dep.id} className="hover:bg-card/60">
                            <td className="py-1.5 px-2 text-foreground font-medium">
                              {dep.dateStr} • {dep.timeStr}
                            </td>
                            <td className="py-1.5 px-2 text-emerald-400 font-bold">
                              +{dep.amount.toLocaleString("en-IN")} PTS
                            </td>
                            <td className="py-1.5 px-2 text-muted-foreground text-[10px]">
                              {dep.note || "Counter Cash"}
                            </td>
                            <td className="py-1.5 px-2 text-right text-foreground">
                              {dep.balanceAfter?.toLocaleString("en-IN") || "-"} PTS
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>

            {/* ============================================================== */}
            {/* BETS SECTION: "WHAT ARE THERE TODAY'S YESTERDAY'S BETS"         */}
            {/* ============================================================== */}
            <div className="rounded-2xl border border-border bg-card p-3.5 space-y-3 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎲</span>
                  <h3 className="font-display text-sm font-extrabold text-foreground">
                    Bets Activity Log: Today's & Yesterday's Bets
                  </h3>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const sync = getSynchronizedRoundState();
                      autoSettleAllPendingBets(sync.roundNumber, sync.phase);
                      onUsersChange();
                      showNotification("⚡ All live bets settled instantly!");
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-[11px] font-black uppercase transition active:scale-95 flex items-center gap-1 cursor-pointer"
                    title="Force instant settlement of finished rounds"
                  >
                    <span>⚡</span>
                    <span>Instant Settle</span>
                  </button>

                  {/* Period Filter Tabs */}
                  <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/60">
                  <button
                    type="button"
                    onClick={() => setBetPeriodFilter("today")}
                    className={`py-1 px-3 rounded-lg text-xs font-bold transition ${
                      betPeriodFilter === "today"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    📅 Today's Bets ({categorizedBets.today.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setBetPeriodFilter("yesterday")}
                    className={`py-1 px-3 rounded-lg text-xs font-bold transition ${
                      betPeriodFilter === "yesterday"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ⏮️ Yesterday's Bets ({categorizedBets.yesterday.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setBetPeriodFilter("all")}
                    className={`py-1 px-2.5 rounded-lg text-xs font-bold transition ${
                      betPeriodFilter === "all"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All ({categorizedBets.all.length})
                  </button>
                </div>
              </div>
            </div>

              {/* Period Performance Summary Strip */}
              <div className="rounded-xl border border-border/80 bg-background/80 p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground uppercase text-[10px] font-bold">
                    {betPeriodFilter === "today"
                      ? "Today's Performance:"
                      : betPeriodFilter === "yesterday"
                      ? "Yesterday's Performance:"
                      : "Total Career Performance:"}
                  </span>
                  <span className="font-bold text-foreground">
                    {displayedBets.length} bet(s) placed
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground">Total Bet: </span>
                    <span className="font-bold text-foreground">
                      {betPeriodFilter === "today"
                        ? (cloudDailySummary && cloudDailySummary.sales > 0 ? cloudDailySummary.sales : profitStats.todayBetAmount)
                        : betPeriodFilter === "yesterday"
                        ? profitStats.yesterdayBetAmount
                        : profitStats.totalBetAmount} PTS
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground">Total Won: </span>
                    <span className="font-bold text-emerald-400">
                      {betPeriodFilter === "today"
                        ? (cloudDailySummary && (cloudDailySummary.sales > 0 || cloudDailySummary.claimsPaid > 0) ? cloudDailySummary.claimsPaid : profitStats.todayWonAmount)
                        : betPeriodFilter === "yesterday"
                        ? profitStats.yesterdayWonAmount
                        : profitStats.totalWonAmount} PTS
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground">House Margin: </span>
                    {(() => {
                      const totalBet =
                        betPeriodFilter === "today"
                          ? (cloudDailySummary && cloudDailySummary.sales > 0 ? cloudDailySummary.sales : profitStats.todayBetAmount)
                          : betPeriodFilter === "yesterday"
                          ? profitStats.yesterdayBetAmount
                          : profitStats.totalBetAmount;
                      const totalWon =
                        betPeriodFilter === "today"
                          ? (cloudDailySummary && (cloudDailySummary.sales > 0 || cloudDailySummary.claimsPaid > 0) ? cloudDailySummary.claimsPaid : profitStats.todayWonAmount)
                          : betPeriodFilter === "yesterday"
                          ? profitStats.yesterdayWonAmount
                          : profitStats.totalWonAmount;
                      const houseMargin = totalBet - totalWon;
                      const isGreen = houseMargin >= 0;
                      return (
                        <span
                          className={`font-black ${
                            isGreen ? "text-emerald-400" : "text-destructive"
                          }`}
                        >
                          {isGreen ? `+${houseMargin.toLocaleString("en-IN")} PTS` : `-${Math.abs(houseMargin).toLocaleString("en-IN")} PTS`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Bets List Cards */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {displayedBets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground text-xs">
                    No bets recorded for this period ({betPeriodFilter}).
                  </div>
                ) : (
                  displayedBets.map((bet) => {
                    const card = getCardByIndex(bet.cardIndex);
                    const winningCard =
                      bet.winningCardIndex !== undefined
                        ? getCardByIndex(bet.winningCardIndex)
                        : null;
                    const netBetPL = (bet.payout || 0) - bet.stake;

                    return (
                      <div
                        key={bet.id}
                        className={`rounded-xl border p-2.5 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          bet.status === "PENDING"
                            ? "border-amber-500/40 bg-amber-500/5"
                            : bet.isWin
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-border/80 bg-card"
                        }`}
                      >
                        {/* Left: Card Thumbnail + Name + Round info */}
                        <div className="flex items-center gap-3">
                          <img
                            src={card.img}
                            alt={card.name}
                            className="h-11 w-11 rounded-xl object-cover border border-border shadow-sm shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-display text-sm font-extrabold text-foreground">
                                {card.name}
                              </span>
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border">
                                Round {bet.roundId}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">
                              {bet.dateStr} • {bet.timeStr}
                            </span>
                          </div>
                        </div>

                        {/* Middle: Bet Stake vs Winning Outcome */}
                        <div className="flex items-center gap-4 text-xs font-mono">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                              Bet Stake
                            </span>
                            <span className="font-bold text-foreground">{bet.stake} PTS</span>
                          </div>

                          {bet.status === "SETTLED" && winningCard && (
                            <div>
                              <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                                Winner Card
                              </span>
                              <span className="font-bold text-foreground flex items-center gap-1">
                                <img
                                  src={winningCard.img}
                                  alt={winningCard.name}
                                  className="h-4 w-4 rounded-sm object-cover"
                                />
                                {winningCard.name}
                              </span>
                            </div>
                          )}

                          <div>
                            <span className="text-[9px] uppercase font-bold text-muted-foreground block">
                              Payout
                            </span>
                            <span
                              className={`font-black ${
                                bet.isWin ? "text-emerald-400" : "text-muted-foreground"
                              }`}
                            >
                              {bet.payout} PTS
                            </span>
                          </div>
                        </div>

                        {/* Right: Won / Lost Badge + Profit */}
                        <div className="text-right self-end sm:self-auto min-w-[100px]">
                          {bet.status === "PENDING" ? (
                            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-black text-amber-300 animate-pulse">
                              ⏳ IN PLAY
                            </span>
                          ) : bet.isWin ? (
                            <div>
                              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                                🏆 WON (+{netBetPL} PTS)
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span className="rounded-full bg-destructive/15 border border-destructive/30 px-2 py-0.5 text-[10px] font-black text-destructive">
                                ❌ LOST (-{bet.stake} PTS)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-8 rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground space-y-2">
            <div className="text-3xl">👥</div>
            <div className="text-sm font-bold text-foreground">
              {users.length === 0 ? "Production Clean Slate" : "Select an Account"}
            </div>
            <div className="text-xs text-muted-foreground max-w-sm mx-auto">
              {users.length === 0
                ? "No agent accounts are registered yet. Click \"+ ADD NEW USER ACCOUNT\" above to onboard your first counter agent."
                : "Please select a user account from the left directory to view full dossier, manage deposits, and view bet history."}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* ADD NEW USER ACCOUNT MODAL                                     */}
      {/* ============================================================== */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">👤</span>
                <h3 className="font-display text-base font-black text-foreground">
                  Create New Player Account
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddUserOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                  Full Display Name *
                </label>
                <input
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. Ramesh Kulkarni"
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground font-medium focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. ramesh99"
                    className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                  4-Digit Login PIN (For Mobile POS Login) *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="1234"
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono font-bold focus:border-primary focus:outline-none"
                />
                <span className="text-[10px] text-muted-foreground block mt-1">
                  Agent will use this PIN to log in on their mobile phone app. Default is 1234.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                  Initial Deposit (PTS)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-[10px] font-bold">PTS</span>
                  <input
                    type="number"
                    min="0"
                    value={newInitialDeposit}
                    onChange={(e) => setNewInitialDeposit(e.target.value)}
                    placeholder="1000"
                    className="w-full pl-10 pr-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono font-bold focus:border-primary focus:outline-none"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground block mt-1">
                  This will be added as the first deposit record in their account ledger.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Counter player from Market branch"
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="py-2 px-3 rounded-xl border border-border bg-muted text-muted-foreground hover:text-foreground font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-primary text-primary-foreground font-display font-black shadow-gold hover:opacity-90 transition"
                >
                  Create Account & Deposit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

