import { describe, expect, it } from "vitest";
import {
  getUsers,
  createUser,
  depositToUser,
  withdrawFromUser,
  recordUserBet,
  settleRoundBets,
  getUserProfitStats,
  getCategorizedUserBets,
  getTodayDateStr,
  getYesterdayDateStr,
  deductAgentBalance,
  authenticateAgent,
} from "@/lib/userStore";

describe("User Store & Financial Profit Engine", () => {
  it("initializes seed users with realistic deposits and bets", () => {
    const users = getUsers();
    expect(users.length).toBeGreaterThan(0);
    const rahul = users.find((u) => u.displayName.includes("Rahul"));
    expect(rahul).toBeDefined();
    expect(rahul?.deposits.length).toBeGreaterThan(0);
    expect(rahul?.bets.length).toBeGreaterThan(0);
  });

  it("deposits money into user account, updates balance, and logs deposit ledger", () => {
    const newUser = createUser({
      displayName: "Test Player",
      username: "testplayer",
      phone: "9999999999",
      initialDeposit: 500,
      notes: "Unit test account",
    });

    expect(newUser.balance).toBe(500);
    expect(newUser.totalDeposited).toBe(500);
    expect(newUser.deposits.length).toBe(1);

    const updated = depositToUser(newUser.id, 1000, "Cash Counter Test");
    expect(updated.balance).toBe(1500);
    expect(updated.totalDeposited).toBe(1500);
    expect(updated.deposits.length).toBe(2);
    expect(updated.deposits[0].amount).toBe(1000);
    expect(updated.deposits[0].balanceAfter).toBe(1500);
  });

  it("records user bets and properly calculates profit and loss", () => {
    const user = createUser({
      displayName: "Gambler Test",
      username: "gamblertest",
      initialDeposit: 1000,
    });

    // Place bet of 100
    const bet = recordUserBet(user.id, {
      roundId: "#9999",
      roundNumber: 9999,
      cardIndex: 0,
      cardName: "पतंग",
      stake: 100,
    });

    expect(bet.status).toBe("PENDING");
    expect(bet.stake).toBe(100);

    // Settle as WIN (card 0 wins => 10x = 1000 payout)
    settleRoundBets("#9999", 0, "पतंग");

    const users = getUsers();
    const updated = users.find((u) => u.id === user.id)!;
    const settledBet = updated.bets.find((b) => b.id === bet.id)!;

    expect(settledBet.status).toBe("SETTLED");
    expect(settledBet.isWin).toBe(true);
    expect(settledBet.payout).toBe(1000);
    // In Prepaid Burn model, user's wagering balance is consumed from 1000 down to 900 (not re-inflated)
    expect(updated.balance).toBe(900);

    const stats = getUserProfitStats(updated);
    // Net profit from bets: 1000 won - 100 staked = +900
    expect(stats.netBetProfit).toBe(900);
    expect(stats.totalWonAmount).toBe(1000);
    expect(stats.totalBetAmount).toBe(100);
    expect(stats.winCount).toBe(1);
    expect(stats.lossCount).toBe(0);
    expect(stats.winRate).toBe(100);
  });

  it("filters today's and yesterday's bets accurately", () => {
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();
    expect(today).not.toBe(yesterday);

    const users = getUsers();
    const rahul = users.find((u) => u.displayName.includes("Rahul"))!;
    const categorized = getCategorizedUserBets(rahul);

    expect(categorized.today.length).toBeGreaterThan(0);
    expect(categorized.yesterday.length).toBeGreaterThan(0);
    expect(categorized.today.every((b) => b.dateStr === today)).toBe(true);
    expect(categorized.yesterday.every((b) => b.dateStr === yesterday)).toBe(true);
  });

  it("atomically deducts agent balance, stamps balanceUpdatedAt, and prevents negative balance", () => {
    const ramu = authenticateAgent("@ram", "1212");
    expect(ramu.success).toBe(true);
    expect(ramu.user).toBeDefined();

    const startBalance = ramu.user!.balance;
    const res = deductAgentBalance(
      "@ram",
      startBalance,
      "#1234",
      1234,
      [{ cardIndex: 0, cardName: "पतंग", amount: startBalance }]
    );

    expect(res.success).toBe(true);
    expect(res.newBalance).toBe(0);

    const reloaded = authenticateAgent("@ram", "1212");
    expect(reloaded.user!.balance).toBe(0);
    expect(reloaded.user!.balanceUpdatedAt).toBeGreaterThan(0);

    // Over-draft fails
    const failRes = deductAgentBalance(
      "@ram",
      10,
      "#1234",
      1234,
      [{ cardIndex: 0, cardName: "पतंग", amount: 10 }]
    );
    expect(failRes.success).toBe(false);
  });
});

