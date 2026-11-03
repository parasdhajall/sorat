import React, { useMemo, useState } from "react";
import { UserAccount, UserBetRecord, getTodayDateStr } from "@/lib/userStore";
import { CARDS } from "@/lib/cards";
import { executeDirectPrint, isDirectPrinterConnected } from "@/lib/thermalPrinter";
import { ThermalTicket } from "@/lib/ticketStore";

interface LiveBetsRiskAuditProps {
  users: UserAccount[];
  totalTurnover: number;
  totalPayouts: number;
  houseProfit: number;
  profitPercentage: number;
}

export function LiveBetsRiskAudit({
  users,
  totalTurnover,
  totalPayouts,
  houseProfit,
  profitPercentage,
}: LiveBetsRiskAuditProps) {
  // 1. Date Filter: "today" | "yesterday" | "custom" | "all"
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "custom" | "all">("today");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // IST Dates
  const todayStr = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  }, []);

  const yesterdayStr = useMemo(() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  }, []);

  const [customDate, setCustomDate] = useState<string>(todayStr);

  const activeTargetDate =
    dateFilter === "today"
      ? todayStr
      : dateFilter === "yesterday"
      ? yesterdayStr
      : dateFilter === "custom"
      ? customDate
      : "";

  // 2. Aggregate all bets from all user accounts
  const allBetsWithUser = useMemo(() => {
    const list: (UserBetRecord & {
      agentName: string;
      agentId: string;
      agentPhone?: string;
    })[] = [];

    users.forEach((u) => {
      (u.bets || []).forEach((b) => {
        list.push({
          ...b,
          agentName: u.displayName || u.username,
          agentId: u.id,
          agentPhone: u.phone,
        });
      });
    });

    // Sort by timestamp descending
    return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [users]);

  // 3. Filtered Bets
  const filteredBets = useMemo(() => {
    return allBetsWithUser.filter((b) => {
      // Date filter
      if (dateFilter !== "all" && activeTargetDate) {
        if (b.dateStr !== activeTargetDate) return false;
      }

      // Agent filter
      if (selectedAgentId !== "all") {
        if (b.agentId !== selectedAgentId && b.userId !== selectedAgentId) return false;
      }

      // Search filter (Ticket, Player, or Card)
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesPlayer = (b.agentName || "").toLowerCase().includes(q);
        const matchesCard = (b.cardName || "").toLowerCase().includes(q);
        const matchesRound = (b.roundId || "").toLowerCase().includes(q);
        const matchesTicket = (b.ticketId || b.id || "").toLowerCase().includes(q);
        if (!matchesPlayer && !matchesCard && !matchesRound && !matchesTicket) return false;
      }

      return true;
    });
  }, [allBetsWithUser, dateFilter, activeTargetDate, selectedAgentId, search]);

  // 4. Financial Totals for Filtered Dataset
  const stats = useMemo(() => {
    const turnover = filteredBets.reduce((acc, b) => acc + (b.stake || 0), 0);
    const payouts = filteredBets.reduce((acc, b) => acc + (b.payout || 0), 0);
    const netProfit = turnover - payouts;
    const margin = turnover > 0 ? ((netProfit / turnover) * 100).toFixed(1) : "100.0";
    const uniquePlayers = new Set(filteredBets.map((b) => b.agentId)).size;

    return {
      turnover,
      payouts,
      netProfit,
      margin,
      uniquePlayers,
      totalPlays: filteredBets.length,
    };
  }, [filteredBets]);

  // 5. 12-Card Liability & Risk Analysis Matrix (DigitJodi High-Volume Pattern)
  const cardExposureMatrix = useMemo(() => {
    return CARDS.map((card, idx) => {
      const cardBets = filteredBets.filter((b) => b.cardIndex === idx);
      const totalStaked = cardBets.reduce((acc, b) => acc + (b.stake || 0), 0);
      const liability = totalStaked * 10; // Sorat 10X Payout
      const houseNetIfWins = stats.turnover - liability;
      const marginIfWins = stats.turnover > 0 ? (houseNetIfWins / stats.turnover) * 100 : 100;

      let status: "ZERO_BET" | "SAFE" | "HIGH_EXPOSURE" = "ZERO_BET";
      if (totalStaked === 0) {
        status = "ZERO_BET";
      } else if (marginIfWins >= 30) {
        status = "SAFE";
      } else {
        status = "HIGH_EXPOSURE";
      }

      return {
        cardIndex: idx,
        cardName: card.name,
        cardEnglish: card.englishName,
        cardImg: card.img,
        count: cardBets.length,
        totalStaked,
        liability,
        houseNetIfWins,
        marginIfWins,
        status,
      };
    });
  }, [filteredBets, stats.turnover]);

  // 6. Handle Reprint Thermal Slip
  const handleReprintSlip = (bet: any) => {
    const tkt: ThermalTicket = {
      id: bet.ticketId || bet.id,
      ticketId: bet.ticketId || bet.id,
      dateStr: bet.dateStr || todayStr,
      timeStr: bet.timeStr || "",
      roundId: bet.roundId || "#001",
      roundNumber: bet.roundNumber || 1,
      agentId: bet.agentId || bet.userId,
      agentName: bet.agentName || "Agent",
      customerName: "Counter Slip",
      items: [
        {
          cardIndex: bet.cardIndex,
          cardName: bet.cardName,
          amount: bet.stake,
          stake: bet.stake,
          potentialPayout: bet.stake * 10,
        },
      ],
      totalStake: bet.stake,
      totalAmount: bet.stake,
      maxPotentialPayout: bet.stake * 10,
      isWinner: bet.isWin || false,
      isClaimed: false,
      status: bet.isWin ? "WON" : "SETTLED",
      winningPayout: bet.payout || 0,
    };

    if (isDirectPrinterConnected()) {
      executeDirectPrint(tkt, "58mm");
      alert(`Thermal ticket #${tkt.ticketId} sent to Bluetooth printer!`);
    } else {
      alert(
        `Ticket Details:\nSlip #${tkt.ticketId}\nCard: ${bet.cardName}\nStake: ₹${bet.stake}\nPayout: ₹${
          bet.payout || 0
        }\n\n(Bluetooth printer connect karne ke liye Agent POS app mein 'Printer' tab open karein)`
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. TOP OVERVIEW STATS (DigitJodi Inspired) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
            🎟️ Total Bets Recorded
          </span>
          <div className="text-2xl font-display font-black text-foreground mt-0.5">
            {stats.totalPlays.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block">
            Across {stats.uniquePlayers} active player wallets
          </span>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
            🪙 Total Turnover Staked
          </span>
          <div className="text-2xl font-display font-black text-amber-400 mt-0.5">
            ₹{stats.turnover.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block">
            Lifetime wagers: ₹{totalTurnover.toLocaleString("en-IN")}
          </span>
        </div>

        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 block">
            🏆 Total Payouts Won
          </span>
          <div className="text-2xl font-display font-black text-purple-300 mt-0.5">
            ₹{stats.payouts.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block">
            10X winnings paid to users
          </span>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
            🛡️ House Net Margin
          </span>
          <div className="text-2xl font-display font-black text-emerald-400 mt-0.5">
            {stats.margin}%
          </div>
          <span className="text-[10px] text-emerald-300/80 font-bold block">
            Net Profit: ₹{stats.netProfit.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* 2. FILTER TOOLBAR */}
      <div className="rounded-2xl border border-border bg-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Date Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-muted-foreground">📅 Date:</span>
            <button
              onClick={() => setDateFilter("today")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                dateFilter === "today"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter("yesterday")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                dateFilter === "yesterday"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateFilter("all")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                dateFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              All Time
            </button>

            {/* Custom Date Input */}
            <div
              className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs ${
                dateFilter === "custom"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setDateFilter("custom");
                }}
                className="bg-transparent text-foreground outline-none font-mono text-xs cursor-pointer"
              />
            </div>
          </div>

          {/* Agent Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-muted-foreground">👤 Agent:</span>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-input bg-background text-xs font-bold text-foreground focus:border-primary outline-none"
            >
              <option value="all">All Agents ({users.length})</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.username})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Ticket ID (#TKT-...), Player Name, or Card (e.g. Patang, Ramu)..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-input bg-background text-xs font-medium text-foreground focus:border-primary outline-none"
          />
        </div>
      </div>

      {/* 3. CARD-BY-CARD 10X LIABILITY & RISK AUDIT MATRIX (DigitJodi High-Volume Pattern) */}
      <div className="rounded-2xl border border-primary/30 bg-card p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🔥</span>
            <div>
              <h3 className="font-display text-sm font-black text-foreground">
                12 Cards 10X Risk & Exposure Audit Matrix
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Agla card kaun sa safe hai jisse house ko guaranteed 30%+ profit mile
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 rounded-full">
            10X Multiplier
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
          {cardExposureMatrix.map((item) => (
            <div
              key={item.cardIndex}
              className={`rounded-xl border p-2 flex flex-col justify-between transition ${
                item.status === "ZERO_BET"
                  ? "border-blue-500/30 bg-blue-500/5"
                  : item.status === "SAFE"
                  ? "border-emerald-500/40 bg-emerald-500/5 shadow-sm"
                  : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <img
                  src={item.cardImg}
                  alt={item.cardName}
                  className="h-8 w-8 rounded-lg object-cover border border-border shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-display font-black text-foreground truncate block">
                    {item.cardName}
                  </span>
                  <span className="text-[9px] text-muted-foreground truncate block">
                    {item.cardEnglish}
                  </span>
                </div>
              </div>

              <div className="mt-2 space-y-0.5 text-[10px] font-mono border-t border-border/40 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Staked:</span>
                  <span className="font-bold text-foreground">₹{item.totalStaked}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">10X Liability:</span>
                  <span className="font-bold text-amber-400">₹{item.liability}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">House Profit:</span>
                  <span
                    className={`font-black ${
                      item.houseNetIfWins >= 0 ? "text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {item.houseNetIfWins >= 0 ? `+₹${item.houseNetIfWins}` : `-₹${Math.abs(item.houseNetIfWins)}`}
                  </span>
                </div>
              </div>

              <div className="mt-2 text-center">
                {item.status === "ZERO_BET" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 block">
                    💎 100% PROFIT (₹0)
                  </span>
                )}
                {item.status === "SAFE" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 block">
                    ✅ SAFE ({item.marginIfWins.toFixed(0)}%)
                  </span>
                )}
                {item.status === "HIGH_EXPOSURE" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-destructive/20 text-destructive border border-destructive/30 block">
                    🚫 BLOCKED (&lt;30%)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. LIVE BETS STREAM & TICKETS AUDIT TABLE */}
      <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">📋</span>
            <h3 className="font-display text-sm font-black text-foreground">
              Live Bets Ledger ({filteredBets.length} entries)
            </h3>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {activeTargetDate ? `Date: ${activeTargetDate}` : "All Records"}
          </span>
        </div>

        {filteredBets.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
            Iss filter ke liye koi bets record nahi mila.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto pr-1">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm border-b border-border text-[10px] font-bold uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 px-2.5">Time & Date</th>
                  <th className="py-2 px-2.5">Ticket / Slip</th>
                  <th className="py-2 px-2.5">Agent / Player</th>
                  <th className="py-2 px-2.5">Card Name</th>
                  <th className="py-2 px-2.5 text-right">Stake</th>
                  <th className="py-2 px-2.5 text-right">10X Payout</th>
                  <th className="py-2 px-2.5 text-center">Result</th>
                  <th className="py-2 px-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {filteredBets.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/40 transition">
                    <td className="py-2 px-2.5 text-[10px] text-muted-foreground whitespace-nowrap">
                      {b.timeStr} • {b.dateStr}
                    </td>
                    <td className="py-2 px-2.5 font-bold text-foreground whitespace-nowrap">
                      #{b.ticketId || b.id.substring(0, 8)}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span className="font-bold text-primary block text-xs">
                        {b.agentName}
                      </span>
                      {b.agentPhone && (
                        <span className="text-[9px] text-muted-foreground block">
                          📱 {b.agentPhone}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span className="font-sans font-bold text-foreground block">
                        {b.cardName}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-amber-400 whitespace-nowrap">
                      ₹{b.stake}
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-purple-300 whitespace-nowrap">
                      ₹{b.payout || b.stake * 10}
                    </td>
                    <td className="py-2 px-2.5 text-center whitespace-nowrap">
                      {b.status === "won" || b.isWin ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                          🏆 WON
                        </span>
                      ) : b.status === "lost" ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-muted text-muted-foreground">
                          LOST
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          ⏳ PENDING
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleReprintSlip(b)}
                        className="px-2 py-1 rounded bg-muted hover:bg-primary hover:text-primary-foreground border border-border text-[10px] font-bold transition cursor-pointer"
                        title="Reprint Thermal Slip"
                      >
                        🖨️ Slip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
