import { calculateProfitGuaranteedWinner } from "../lib/realtime";
import { CARD_NAMES } from "../lib/userStore";

interface DemoPlayer {
  name: string;
  favCards: number[];
}

const PLAYERS: DemoPlayer[] = [
  { name: "Vikram", favCards: [0, 3, 11] }, // Patang, Surya, Gay
  { name: "Pooja", favCards: [1, 5, 7] },   // Chhatri, Diva, Chimani
  { name: "Sunil", favCards: [2, 4, 9] },   // Ball, Gulab, Bhovra
  { name: "Rahul", favCards: [8, 10] },     // Sasa, Badli
  { name: "Amit", favCards: [0, 1, 5] },    // Patang, Chhatri, Diva
  { name: "Suresh", favCards: [6, 7, 11] }, // Phulpaakhru, Chimani, Gay
];

// Target 10 rounds totaling exactly 5,000 stake:
// 500, 600, 450, 550, 500, 400, 600, 450, 500, 450 = 5000
const ROUND_TARGETS = [500, 600, 450, 550, 500, 400, 600, 450, 500, 450];
const START_ROUND = 703;

export function runRamuSimulation() {
  let runningBalance = 5000;
  let cumulativeTurnover = 0;
  let cumulativePayouts = 0;

  const roundsLog: any[] = [];
  const ramuBets: any[] = [];

  const now = Date.now();
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  ROUND_TARGETS.forEach((targetTotal, roundIdx) => {
    const roundNumber = START_ROUND + roundIdx;
    const roundId = `#${String(roundNumber).padStart(4, "0")}`;
    const roundMinutesAgo = (10 - roundIdx) * 3; // 3 min intervals
    const roundTs = now - roundMinutesAgo * 60 * 1000;
    const roundTime = new Date(roundTs).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // Distribute targetTotal across players and cards
    // To ensure fair game where players win, keep individual card bets between 20 and 50
    const betsOnCards: Record<number, number> = {};
    const roundPlayerBets: any[] = [];

    let remaining = targetTotal;
    const availablePlayers = [...PLAYERS].sort(() => Math.random() - 0.5);

    while (remaining > 0) {
      for (const p of availablePlayers) {
        if (remaining <= 0) break;
        const card = p.favCards[Math.floor(Math.random() * p.favCards.length)];
        // Bet size: 20, 30, 40, or 50 (or whatever remains if <= 50)
        let stake = [20, 30, 40, 50][Math.floor(Math.random() * 4)];
        if (stake > remaining) stake = remaining;
        if (remaining - stake > 0 && remaining - stake < 20) {
          stake = remaining; // consume all to not leave awkward <20 remainder
        }

        betsOnCards[card] = (betsOnCards[card] || 0) + stake;
        remaining -= stake;
        roundPlayerBets.push({
          player: p.name,
          cardIndex: card,
          cardName: CARD_NAMES[card],
          stake,
        });
      }
    }

    cumulativeTurnover += targetTotal;
    runningBalance -= targetTotal;

    // Use calculateProfitGuaranteedWinner to find winning card
    const decision = calculateProfitGuaranteedWinner(
      betsOnCards,
      cumulativeTurnover,
      cumulativePayouts,
      null
    );

    const winningCardIndex = decision.winner;
    const winningCardName = CARD_NAMES[winningCardIndex];
    const payout = decision.netPayout;
    cumulativePayouts += payout;
    const roundProfit = targetTotal - payout;
    const houseMarginPct = ((targetTotal - payout) / targetTotal) * 100;

    // Record each individual bet punched at Ramu's counter
    roundPlayerBets.forEach((pb, bIdx) => {
      const isWin = pb.cardIndex === winningCardIndex;
      const betPayout = isWin ? pb.stake * 10 : 0;
      ramuBets.push({
        id: `bet_ramu_${roundNumber}_${bIdx + 1}`,
        roundId,
        roundNumber,
        timestamp: roundTs,
        dateStr,
        timeStr: roundTime,
        cardIndex: pb.cardIndex,
        cardName: pb.cardName,
        stake: pb.stake,
        winningCardIndex,
        winningCardName,
        payout: betPayout,
        isWin,
        status: "SETTLED",
      });
    });

    roundsLog.push({
      roundNumber,
      roundId,
      timeStr: roundTime,
      totalTurnover: targetTotal,
      winningCardIndex,
      winningCardName,
      payout,
      roundProfit,
      houseMarginPct: houseMarginPct.toFixed(1) + "%",
      cumulativeTurnover,
      cumulativePayouts,
      cumulativeMarginPct: (((cumulativeTurnover - cumulativePayouts) / cumulativeTurnover) * 100).toFixed(1) + "%",
      remainingWalletBalance: runningBalance,
      betsCount: roundPlayerBets.length,
    });
  });

  return {
    ramuBets,
    roundsLog,
    finalBalance: runningBalance,
    totalStaked: cumulativeTurnover,
    totalPayouts: cumulativePayouts,
    netHouseProfit: cumulativeTurnover - cumulativePayouts,
    overallProfitPct: (((cumulativeTurnover - cumulativePayouts) / cumulativeTurnover) * 100).toFixed(2),
  };
}
