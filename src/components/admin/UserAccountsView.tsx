import React, { useState } from "react";
import {
  UserAccount,
  UserProfitStats,
  depositToUser,
  withdrawFromUser,
  setUserBalance,
  createUser,
  deleteUser,
  getUserProfitStats,
  getCategorizedUserBets,
  setActiveUserId,
  getActiveUserId,
} from "@/lib/userStore";
import { CARDS, getCardByIndex } from "@/lib/cards";

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
  const [newInitialDeposit, setNewInitialDeposit] = useState("1000");
  const [newNotes, setNewNotes] = useState("");

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 3500);
  };

  // Selected user resolution
  const selectedUser = users.find((u) => u.id === selectedUserId) || users[0];

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
      ? categorizedBets.today
      : betPeriodFilter === "yesterday"
      ? categorizedBets.yesterday
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
      showNotification(`₹${amount.toLocaleString("en-IN")} deposited to ${selectedUser.displayName}!`);
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
      showNotification(`₹${amt.toLocaleString("en-IN")} deposited successfully!`);
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
      showNotification(`₹${amt.toLocaleString("en-IN")} payout processed for ${selectedUser.displayName}`);
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
      showNotification(`Balance set to ₹${bal.toLocaleString("en-IN")}`);
    } catch (e: any) {
      alert(e.message || "Failed to update balance");
    }
  };

  const handleSetActiveForTV = (userId: string) => {
    setActiveUserId(userId);
    const u = users.find((x) => x.id === userId);
    if (u) {
      onActiveUserSync?.(userId, u.balance);
      showNotification(`${u.displayName} is now active on the Game Board / TV!`);
    }
    onUsersChange();
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
        initialDeposit: Number(newInitialDeposit) || 0,
        notes: newNotes.trim(),
      });

      onUsersChange();
      setSelectedUserId(created.id);
      setIsAddUserOpen(false);
      setNewDisplayName("");
      setNewUsername("");
      setNewPhone("");
      setNewInitialDeposit("1000");
      setNewNotes("");
      showNotification(`Account created for ${created.displayName}!`);
    } catch (e: any) {
      alert(e.message || "Failed to create user");
    }
  };

  const handleDeleteUser = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete user account "${name}"? All deposit and bet history will be removed.`)) {
      deleteUser(id);
      onUsersChange();
      const remaining = users.filter((u) => u.id !== id);
      if (remaining.length > 0) {
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
            ₹{users.reduce((acc, u) => acc + (u.totalDeposited || 0), 0).toLocaleString("en-IN")}
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card p-2.5">
          <span className="text-[9px] uppercase font-bold text-muted-foreground block">Total In Balances</span>
          <span className="text-base font-display font-black text-primary">
            ₹{users.reduce((acc, u) => acc + (u.balance || 0), 0).toLocaleString("en-IN")}
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

        <button
          type="button"
          onClick={() => setIsAddUserOpen(true)}
          className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-primary text-primary-foreground font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95 shrink-0"
        >
          <span>➕</span>
          <span>ADD NEW USER ACCOUNT</span>
        </button>
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
            {filteredUsers.length === 0 ? (
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
                          ₹{u.balance.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Deposited & Profit Badges */}
                    <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[10px]">
                      <div>
                        <span className="text-muted-foreground">Deposited: </span>
                        <span className="font-mono font-bold text-foreground">
                          ₹{(u.totalDeposited || 0).toLocaleString("en-IN")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Profit:</span>
                        <span
                          className={`font-mono font-black px-1.5 py-0.5 rounded ${
                            stats.netBetProfit > 0
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : stats.netBetProfit < 0
                              ? "bg-destructive/20 text-destructive border border-destructive/30"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {stats.netBetProfit >= 0 ? `+₹${stats.netBetProfit}` : `-₹${Math.abs(stats.netBetProfit)}`}
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
                      <span className="rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5 text-[9px] font-black text-primary uppercase">
                        {selectedUser.status}
                      </span>
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

                <div className="flex items-center gap-2 self-stretch sm:self-auto">
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
                  ₹{profitStats.totalDeposited.toLocaleString("en-IN")}
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
                  ₹{profitStats.currentBalance.toLocaleString("en-IN")}
                </div>
                <span className="text-[9px] text-muted-foreground block mt-0.5">
                  Available to wager on cards
                </span>
              </div>

              {/* Card 3: USER'S PROFIT & LOSS */}
              <div
                className={`rounded-xl border p-3 ${
                  profitStats.netBetProfit >= 0
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-destructive/40 bg-destructive/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      profitStats.netBetProfit >= 0 ? "text-emerald-400" : "text-destructive"
                    }`}
                  >
                    📈 Player Net Profit
                  </span>
                  <span className="text-xs">🏆</span>
                </div>
                <div
                  className={`mt-1 text-xl font-display font-black ${
                    profitStats.netBetProfit >= 0 ? "text-emerald-400" : "text-destructive"
                  }`}
                >
                  {profitStats.netBetProfit >= 0 ? `+₹${profitStats.netBetProfit}` : `-₹${Math.abs(profitStats.netBetProfit)}`}
                </div>
                <span className="text-[9px] text-muted-foreground block mt-0.5 font-mono">
                  Won ₹{profitStats.totalWonAmount} • Staked ₹{profitStats.totalBetAmount}
                </span>
              </div>

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
                    Deposit Money into {selectedUser.displayName}'s Account
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground">
                  Live Balance: ₹{selectedUser.balance.toLocaleString("en-IN")}
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
                      +₹{amt.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Deposit Form */}
              <form onSubmit={handleCustomDeposit} className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
                <div className="sm:col-span-5 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                    ₹
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
                    placeholder="Withdraw amount ₹"
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
                    placeholder="Exact balance ₹"
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
                              +₹{dep.amount.toLocaleString("en-IN")}
                            </td>
                            <td className="py-1.5 px-2 text-muted-foreground text-[10px]">
                              {dep.note || "Counter Cash"}
                            </td>
                            <td className="py-1.5 px-2 text-right text-foreground">
                              ₹{dep.balanceAfter?.toLocaleString("en-IN") || "-"}
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
                      ₹
                      {betPeriodFilter === "today"
                        ? profitStats.todayBetAmount
                        : betPeriodFilter === "yesterday"
                        ? profitStats.yesterdayBetAmount
                        : profitStats.totalBetAmount}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground">Total Won: </span>
                    <span className="font-bold text-emerald-400">
                      ₹
                      {betPeriodFilter === "today"
                        ? profitStats.todayWonAmount
                        : betPeriodFilter === "yesterday"
                        ? profitStats.yesterdayWonAmount
                        : profitStats.totalWonAmount}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground">Net Period Profit: </span>
                    <span
                      className={`font-black ${
                        (betPeriodFilter === "today"
                          ? profitStats.todayNetProfit
                          : betPeriodFilter === "yesterday"
                          ? profitStats.yesterdayNetProfit
                          : profitStats.netBetProfit) >= 0
                          ? "text-emerald-400"
                          : "text-destructive"
                      }`}
                    >
                      {(betPeriodFilter === "today"
                        ? profitStats.todayNetProfit
                        : betPeriodFilter === "yesterday"
                        ? profitStats.yesterdayNetProfit
                        : profitStats.netBetProfit) >= 0
                        ? `+₹${
                            betPeriodFilter === "today"
                              ? profitStats.todayNetProfit
                              : betPeriodFilter === "yesterday"
                              ? profitStats.yesterdayNetProfit
                              : profitStats.netBetProfit
                          }`
                        : `-₹${Math.abs(
                            betPeriodFilter === "today"
                              ? profitStats.todayNetProfit
                              : betPeriodFilter === "yesterday"
                              ? profitStats.yesterdayNetProfit
                              : profitStats.netBetProfit
                          )}`}
                    </span>
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
                            <span className="font-bold text-foreground">₹{bet.stake}</span>
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
                              ₹{bet.payout}
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
                                🏆 WON (+₹{netBetPL})
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span className="rounded-full bg-destructive/15 border border-destructive/30 px-2 py-0.5 text-[10px] font-black text-destructive">
                                ❌ LOST (-₹{bet.stake})
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
          <div className="lg:col-span-8 rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
            Please select a user account to manage details.
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
                  Initial Deposit Amount (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">₹</span>
                  <input
                    type="number"
                    min="0"
                    value={newInitialDeposit}
                    onChange={(e) => setNewInitialDeposit(e.target.value)}
                    placeholder="1000"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-input bg-background text-foreground font-mono font-bold focus:border-primary focus:outline-none"
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

