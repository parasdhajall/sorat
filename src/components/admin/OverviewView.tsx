import {
  UserAccount,
  getUserProfitStats,
  getGlobalPlatformStats,
} from "@/lib/userStore";

interface OverviewViewProps {
  users: UserAccount[];
  totalTurnover: number;
  totalPayouts: number;
  houseProfit: number;
  profitPercentage: number;
  onSelectUser: (userId: string) => void;
}

export function OverviewView({
  users,
  totalTurnover,
  totalPayouts,
  houseProfit,
  profitPercentage,
  onSelectUser,
}: OverviewViewProps) {
  const globalStats = getGlobalPlatformStats(users);

  return (
    <div className="space-y-4">
      {/* Top Aggregate KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
            📥 Total User Deposits
          </span>
          <div className="text-2xl font-display font-black text-foreground mt-1">
            ₹{globalStats.totalDeposited.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block mt-0.5">
            Across {users.length} active player accounts
          </span>
        </div>

        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary block">
            🪙 Total Player Balances
          </span>
          <div className="text-2xl font-display font-black text-primary mt-1">
            ₹{globalStats.totalCurrentBalance.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block mt-0.5">
            Currently held in player wallets
          </span>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
            🛡️ House Profit Margin
          </span>
          <div className="text-2xl font-display font-black text-emerald-400 mt-1">
            {profitPercentage}% (₹{houseProfit.toLocaleString("en-IN")})
          </div>
          <span className="text-[10px] text-muted-foreground block mt-0.5">
            Guaranteed ≥ 30% business margin
          </span>
        </div>

        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 block">
            🎲 Total Game Turnover
          </span>
          <div className="text-2xl font-display font-black text-foreground mt-1">
            ₹{totalTurnover.toLocaleString("en-IN")}
          </div>
          <span className="text-[10px] text-muted-foreground block mt-0.5">
            Payouts: ₹{totalPayouts.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* Users Financial Ledger Table */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-foreground">
              User Accounts Profit & Deposits Ledger
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Comprehensive side-by-side audit of all deposits, profits, and bets across all players.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/80 text-[10px] uppercase font-bold text-muted-foreground">
                <th className="py-2.5 px-3">Player / Account</th>
                <th className="py-2.5 px-3">Current Balance</th>
                <th className="py-2.5 px-3">Total Deposited</th>
                <th className="py-2.5 px-3">Total Bets Placed</th>
                <th className="py-2.5 px-3">Total Won</th>
                <th className="py-2.5 px-3">Net Profit / Loss</th>
                <th className="py-2.5 px-3">Today's Profit</th>
                <th className="py-2.5 px-3">Yesterday's Profit</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {users.map((u) => {
                const stats = getUserProfitStats(u);
                return (
                  <tr key={u.id} className="hover:bg-muted/40 transition">
                    <td className="py-3 px-3">
                      <div className="font-sans font-bold text-foreground text-sm leading-tight">
                        {u.displayName}
                      </div>
                      <span className="text-[10px] text-muted-foreground block">
                        @{u.username} {u.phone ? `• ${u.phone}` : ""}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-bold text-primary">
                      ₹{u.balance.toLocaleString("en-IN")}
                    </td>

                    <td className="py-3 px-3 text-foreground font-medium">
                      ₹{u.totalDeposited.toLocaleString("en-IN")}
                    </td>

                    <td className="py-3 px-3 text-foreground">
                      {stats.totalBetsPlaced} bets (₹{stats.totalBetAmount.toLocaleString("en-IN")})
                    </td>

                    <td className="py-3 px-3 text-emerald-400 font-bold">
                      ₹{stats.totalWonAmount.toLocaleString("en-IN")}
                    </td>

                    <td className="py-3 px-3 font-black">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                          stats.netBetProfit > 0
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : stats.netBetProfit < 0
                            ? "bg-destructive/20 text-destructive border border-destructive/30"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {stats.netBetProfit >= 0 ? `+₹${stats.netBetProfit}` : `-₹${Math.abs(stats.netBetProfit)}`}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`font-bold text-[11px] ${
                          stats.todayNetProfit > 0
                            ? "text-emerald-400"
                            : stats.todayNetProfit < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {stats.todayNetProfit >= 0 ? `+₹${stats.todayNetProfit}` : `-₹${Math.abs(stats.todayNetProfit)}`}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`font-bold text-[11px] ${
                          stats.yesterdayNetProfit > 0
                            ? "text-emerald-400"
                            : stats.yesterdayNetProfit < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {stats.yesterdayNetProfit >= 0 ? `+₹${stats.yesterdayNetProfit}` : `-₹${Math.abs(stats.yesterdayNetProfit)}`}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right font-sans">
                      <button
                        type="button"
                        onClick={() => onSelectUser(u.id)}
                        className="py-1 px-2.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground text-xs font-bold transition"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

