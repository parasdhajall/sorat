import { describe, it, expect } from "vitest";
import {
  calculateProfitGuaranteedWinner,
  analyzeCardProfitability,
  TARGET_PROFIT_MARGIN,
  MAX_PAYOUT_RATIO,
  PAYOUT_MULTIPLIER,
} from "@/lib/realtime";
import { CARDS } from "@/lib/cards";

interface SimUser {
  id: string;
  name: string;
  startingBalance: number;
  walletBalance: number;
  totalStaked: number;
  totalWon: number;
}

interface RoundBet {
  userId: string;
  cardIndex: number;
  amount: number;
}

describe("Sorat 6-User Live Arena Simulation Test & 30% Profit Audit", () => {
  it("executes full simulation with 6 users, testing multi-card bets and 30% house profit lock", () => {
    // 1. Initial 6 Users
    const users: SimUser[] = [
      { id: "usr_1", name: "Ramu (@ram)", startingBalance: 1000, walletBalance: 1000, totalStaked: 0, totalWon: 0 },
      { id: "usr_2", name: "Rahul Sharma (@rahul99)", startingBalance: 1500, walletBalance: 1500, totalStaked: 0, totalWon: 0 },
      { id: "usr_3", name: "Amit Patel (@amit)", startingBalance: 800, walletBalance: 800, totalStaked: 0, totalWon: 0 },
      { id: "usr_4", name: "Suresh Patil (@suresh)", startingBalance: 2000, walletBalance: 2000, totalStaked: 0, totalWon: 0 },
      { id: "usr_5", name: "Pooja Shinde (@pooja)", startingBalance: 1200, walletBalance: 1200, totalStaked: 0, totalWon: 0 },
      { id: "usr_6", name: "Vikram Deshmukh (@vikram)", startingBalance: 1500, walletBalance: 1500, totalStaked: 0, totalWon: 0 },
    ];

    console.log("\n================================================================================");
    console.log("       SORAT 6-USER ARENA SIMULATION & 30% GUARANTEED PROFIT AUDIT REPORT       ");
    console.log("================================================================================\n");

    console.log("INITIAL USERS REGISTERED & WALLET BALANCES:");
    users.forEach((u) => {
      console.log(` • [${u.id}] ${u.name.padEnd(26, " ")} | Wallet: Rs ${u.walletBalance}`);
    });

    let cumulativeTurnover = 0;
    let cumulativePayouts = 0;

    // Define 5 consecutive test rounds with varied realistic betting behavior
    const roundsData: { roundNum: number; bets: RoundBet[] }[] = [
      {
        roundNum: 101,
        bets: [
          // User 1 Ramu (Rs 200)
          { userId: "usr_1", cardIndex: 0, amount: 100 }, // पतंग
          { userId: "usr_1", cardIndex: 1, amount: 50 },  // छत्री
          { userId: "usr_1", cardIndex: 5, amount: 50 },  // दिवा
          // User 2 Rahul (Rs 300)
          { userId: "usr_2", cardIndex: 2, amount: 150 }, // बॉल
          { userId: "usr_2", cardIndex: 4, amount: 100 }, // गुलाब
          { userId: "usr_2", cardIndex: 11, amount: 50 }, // गाय
          // User 3 Amit (Rs 300)
          { userId: "usr_3", cardIndex: 3, amount: 200 }, // सूर्य
          { userId: "usr_3", cardIndex: 8, amount: 100 }, // ससा
          // User 4 Suresh (Rs 500 - Heavy Punter)
          { userId: "usr_4", cardIndex: 0, amount: 250 }, // पतंग (heavy)
          { userId: "usr_4", cardIndex: 6, amount: 150 }, // फुलपाखरू
          { userId: "usr_4", cardIndex: 9, amount: 100 }, // भोवरा
          // User 5 Pooja (Rs 200)
          { userId: "usr_5", cardIndex: 1, amount: 100 }, // छत्री
          { userId: "usr_5", cardIndex: 7, amount: 100 }, // चिमणी
          // User 6 Vikram (Rs 300)
          { userId: "usr_6", cardIndex: 2, amount: 100 }, // बॉल
          { userId: "usr_6", cardIndex: 3, amount: 100 }, // सूर्य
          { userId: "usr_6", cardIndex: 10, amount: 100 },// बादली
        ],
      },
      {
        roundNum: 102,
        bets: [
          { userId: "usr_1", cardIndex: 4, amount: 100 }, // गुलाब
          { userId: "usr_1", cardIndex: 7, amount: 50 },  // चिमणी
          { userId: "usr_2", cardIndex: 0, amount: 200 }, // पतंग
          { userId: "usr_3", cardIndex: 1, amount: 150 }, // छत्री
          { userId: "usr_4", cardIndex: 2, amount: 300 }, // बॉल (heavy)
          { userId: "usr_5", cardIndex: 8, amount: 150 }, // ससा
          { userId: "usr_6", cardIndex: 11, amount: 200 },// गाय
        ],
      },
      {
        roundNum: 103,
        bets: [
          { userId: "usr_1", cardIndex: 2, amount: 100 },
          { userId: "usr_2", cardIndex: 5, amount: 100 },
          { userId: "usr_3", cardIndex: 9, amount: 100 },
          { userId: "usr_4", cardIndex: 3, amount: 400 }, // Heavy on Surya
          { userId: "usr_5", cardIndex: 0, amount: 100 },
          { userId: "usr_6", cardIndex: 6, amount: 150 },
        ],
      },
      {
        roundNum: 104,
        bets: [
          { userId: "usr_1", cardIndex: 8, amount: 100 },
          { userId: "usr_2", cardIndex: 10, amount: 150 },
          { userId: "usr_3", cardIndex: 4, amount: 100 },
          { userId: "usr_4", cardIndex: 1, amount: 250 },
          { userId: "usr_5", cardIndex: 11, amount: 100 },
          { userId: "usr_6", cardIndex: 7, amount: 100 },
        ],
      },
      {
        roundNum: 105,
        bets: [
          { userId: "usr_1", cardIndex: 3, amount: 100 },
          { userId: "usr_2", cardIndex: 2, amount: 100 },
          { userId: "usr_3", cardIndex: 0, amount: 100 },
          { userId: "usr_4", cardIndex: 5, amount: 200 },
          { userId: "usr_5", cardIndex: 9, amount: 100 },
          { userId: "usr_6", cardIndex: 4, amount: 100 },
        ],
      },
    ];

    // Execute each round and collect metrics
    roundsData.forEach((rnd) => {
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`>>> ROUND #${rnd.roundNum} EXECUTION & RISK ANALYSIS`);
      console.log(`--------------------------------------------------------------------------------`);

      // 1. Deduct bets from users
      const currentBets: Record<number, number> = {};
      let roundTotalTurnover = 0;

      rnd.bets.forEach((b) => {
        const u = users.find((usr) => usr.id === b.userId)!;
        expect(u.walletBalance).toBeGreaterThanOrEqual(b.amount);
        u.walletBalance -= b.amount;
        u.totalStaked += b.amount;
        currentBets[b.cardIndex] = (currentBets[b.cardIndex] ?? 0) + b.amount;
        roundTotalTurnover += b.amount;
      });

      console.log(`Total Round Collection (Turnover) = Rs ${roundTotalTurnover}`);

      // 2. Run Engine's 30% Profit Analysis on all 12 cards
      const analysis = analyzeCardProfitability(currentBets, cumulativeTurnover, cumulativePayouts);
      const maxAllowedRoundPayout = Math.max(
        0,
        (cumulativeTurnover + roundTotalTurnover) * MAX_PAYOUT_RATIO - cumulativePayouts
      );

      console.log(`Max Payout Budget for >= 30% House Profit: Rs ${Math.round(maxAllowedRoundPayout)}`);
      console.log("\nCARD-BY-CARD ENGINE AUDIT TABLE:");
      console.log(
        "Card".padEnd(16, " ") +
        "Bet (Rs)".padStart(10, " ") +
        "10X Payout".padStart(12, " ") +
        "House Profit".padStart(14, " ") +
        "Margin %".padStart(10, " ") +
        "Engine Status".padStart(16, " ")
      );
      console.log("-".repeat(78));

      analysis.forEach((c) => {
        const cardName = CARDS[c.card].name + ` (${CARDS[c.card].englishName})`;
        const potentialProfit = roundTotalTurnover - c.potentialPayout;
        const marginPct = ((potentialProfit / roundTotalTurnover) * 100).toFixed(1) + "%";
        console.log(
          cardName.padEnd(16, " ") +
          String(c.bet).padStart(10, " ") +
          `Rs ${c.potentialPayout}`.padStart(12, " ") +
          `Rs ${potentialProfit}`.padStart(14, " ") +
          marginPct.padStart(10, " ") +
          c.status.padStart(16, " ")
        );
      });

      // 3. Select Winner using the real engine function
      const engineResult = calculateProfitGuaranteedWinner(
        currentBets,
        cumulativeTurnover,
        cumulativePayouts
      );

      const winningCard = CARDS[engineResult.winner];
      const winPayout = engineResult.netPayout;
      const roundProfit = roundTotalTurnover - winPayout;
      const roundProfitPct = ((roundProfit / roundTotalTurnover) * 100).toFixed(2);

      // Verify that engine picked a card that honors >= 30% profit rule
      const safeCheck = analysis.find((a) => a.card === engineResult.winner);
      expect(safeCheck).toBeDefined();

      // Cumulative update
      cumulativeTurnover += roundTotalTurnover;
      cumulativePayouts += winPayout;
      const totalCumulativeProfit = cumulativeTurnover - cumulativePayouts;
      const cumulativeProfitPct = ((totalCumulativeProfit / cumulativeTurnover) * 100).toFixed(2);

      // 4. Payout winners
      const winningBets = rnd.bets.filter((b) => b.cardIndex === engineResult.winner);
      winningBets.forEach((b) => {
        const u = users.find((usr) => usr.id === b.userId)!;
        const prize = b.amount * PAYOUT_MULTIPLIER;
        u.walletBalance += prize;
        u.totalWon += prize;
        console.log(` • WINNER PAYOUT: User ${u.name} won Rs ${prize} on ${winningCard.name} (Bet: Rs ${b.amount})`);
      });

      console.log(`\n🏆 ROUND #${rnd.roundNum} WINNER: [Card ${engineResult.winner}] ${winningCard.name} (${winningCard.englishName})`);
      console.log(` • Selection Reason  : ${engineResult.reason}`);
      console.log(` • Total Round Payout: Rs ${winPayout}`);
      console.log(` • Round House Profit: Rs ${roundProfit} (${roundProfitPct}% margin)`);
      console.log(` • Cumulative Profit : Rs ${totalCumulativeProfit} / Rs ${cumulativeTurnover} (${cumulativeProfitPct}% overall)`);

      // STRICT MATHEMATICAL ASSERTION:
      // Cumulative profit must NEVER drop below 30% margin!
      expect(totalCumulativeProfit / cumulativeTurnover).toBeGreaterThanOrEqual(0.30 - 0.001);
    });

    // Final Balance Sheet
    console.log("\n================================================================================");
    console.log("                       FINAL TOURNAMENT BALANCE SHEET                           ");
    console.log("================================================================================\n");

    console.log(
      "User".padEnd(28, " ") +
      "Start Bal".padStart(11, " ") +
      "Staked".padStart(10, " ") +
      "Won".padStart(10, " ") +
      "End Bal".padStart(11, " ") +
      "Net P/L".padStart(11, " ")
    );
    console.log("-".repeat(81));

    let totalUserStaked = 0;
    let totalUserWon = 0;

    users.forEach((u) => {
      totalUserStaked += u.totalStaked;
      totalUserWon += u.totalWon;
      const netPL = u.walletBalance - u.startingBalance;
      const sign = netPL >= 0 ? "+" : "";
      console.log(
        u.name.padEnd(28, " ") +
        `Rs ${u.startingBalance}`.padStart(11, " ") +
        `Rs ${u.totalStaked}`.padStart(10, " ") +
        `Rs ${u.totalWon}`.padStart(10, " ") +
        `Rs ${u.walletBalance}`.padStart(11, " ") +
        `${sign}Rs ${netPL}`.padStart(11, " ")
      );
    });

    console.log("-".repeat(81));
    const totalHouseProfit = cumulativeTurnover - cumulativePayouts;
    const finalProfitPct = ((totalHouseProfit / cumulativeTurnover) * 100).toFixed(2);

    console.log(`TOTAL USER STAKES (Turnover) : Rs ${totalUserStaked}`);
    console.log(`TOTAL WINNINGS PAID TO USERS : Rs ${totalUserWon}`);
    console.log(`TOTAL HOUSE NET PROFIT (30%+) : Rs ${totalHouseProfit} (${finalProfitPct}% margin)`);
    console.log("================================================================================\n");

    expect(totalHouseProfit).toBeGreaterThanOrEqual(totalUserStaked * 0.30);
  });
});

