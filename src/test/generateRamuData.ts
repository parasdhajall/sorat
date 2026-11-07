import { calculateProfitGuaranteedWinner } from "../lib/realtime";
import { CARD_NAMES } from "../lib/userStore";
import * as fs from "fs";
import * as path from "path";

// Deterministic seed for reproducible simulation
function pseudoRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

const PLAYERS = [
  { name: "Vikram", favCards: [0, 3, 11] }, // Patang, Surya, Gay
  { name: "Pooja", favCards: [1, 5, 7] },   // Chhatri, Diva, Chimani
  { name: "Sunil", favCards: [2, 4, 9] },   // Ball, Gulab, Bhovra
  { name: "Rahul", favCards: [8, 10] },     // Sasa, Badli
  { name: "Amit", favCards: [0, 1, 5] },    // Patang, Chhatri, Diva
  { name: "Suresh", favCards: [6, 7, 11] }, // Phulpaakhru, Chimani, Gay
];

const ROUND_TARGETS = [500, 600, 450, 550, 500, 400, 600, 450, 500, 450];
const START_ROUND = 703;

export function generateSimulationFile() {
  let rngSeed = 42;
  const rand = () => {
    rngSeed++;
    return pseudoRandom(rngSeed);
  };

  let runningBalance = 5000;
  let cumulativeTurnover = 0;
  let cumulativePayouts = 0;

  const roundsSummary: any[] = [];
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
    const roundMinutesAgo = (10 - roundIdx) * 3;
    const roundTs = now - roundMinutesAgo * 60 * 1000;
    const roundTime = new Date(roundTs).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const betsOnCards: Record<number, number> = {};
    const roundPlayerBets: any[] = [];

    let remaining = targetTotal;
    const availablePlayers = [...PLAYERS].sort(() => rand() - 0.5);

    while (remaining > 0) {
      for (const p of availablePlayers) {
        if (remaining <= 0) break;
        const favIdx = Math.floor(rand() * p.favCards.length);
        const card = p.favCards[favIdx] ?? 0;
        const stakeOptions = [20, 30, 40, 50];
        let stake = stakeOptions[Math.floor(rand() * 4)] ?? 20;
        if (stake > remaining) stake = remaining;
        if (remaining - stake > 0 && remaining - stake < 20) {
          stake = remaining;
        }

        betsOnCards[card] = (betsOnCards[card] || 0) + stake;
        remaining -= stake;
        roundPlayerBets.push({
          player: p.name,
          cardIndex: card,
          cardName: CARD_NAMES[card] ?? "पतंग",
          stake,
        });
      }
    }

    const decision = calculateProfitGuaranteedWinner(
      betsOnCards,
      cumulativeTurnover,
      cumulativePayouts,
      null
    );

    cumulativeTurnover += targetTotal;
    runningBalance -= targetTotal;

    const winningCardIndex = decision.winner;
    const winningCardName = CARD_NAMES[winningCardIndex];
    const payout = decision.netPayout;
    cumulativePayouts += payout;
    const roundProfit = targetTotal - payout;
    const houseMarginPct = ((targetTotal - payout) / targetTotal) * 100;

    roundPlayerBets.forEach((pb, bIdx) => {
      const isWin = pb.cardIndex === winningCardIndex;
      const betPayout = isWin ? pb.stake * 9 : 0;
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

    roundsSummary.push({
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

  const fileContent = `// Automatically generated simulation data for Ramu Agent 5000 exhaustion
import { UserBetRecord } from "./userStore";

export interface RoundSummary {
  roundNumber: number;
  roundId: string;
  timeStr: string;
  totalTurnover: number;
  winningCardIndex: number;
  winningCardName: string;
  payout: number;
  roundProfit: number;
  houseMarginPct: string;
  cumulativeTurnover: number;
  cumulativePayouts: number;
  cumulativeMarginPct: string;
  remainingWalletBalance: number;
  betsCount: number;
}

export const RAMU_SIMULATION_SUMMARY = {
  totalDeposited: 5000,
  finalBalance: ${runningBalance},
  totalStaked: ${cumulativeTurnover},
  totalPayouts: ${cumulativePayouts},
  netHouseProfit: ${cumulativeTurnover - cumulativePayouts},
  profitMarginPct: "${(((cumulativeTurnover - cumulativePayouts) / cumulativeTurnover) * 100).toFixed(1)}%",
  totalBetsCount: ${ramuBets.length},
  roundsCount: ${roundsSummary.length},
};

export const RAMU_ROUNDS_LOG: RoundSummary[] = ${JSON.stringify(roundsSummary, null, 2)};

export const RAMU_SIMULATED_BETS: UserBetRecord[] = ${JSON.stringify(ramuBets, null, 2)};
`;

  const outputPath = path.resolve(__dirname, "../lib/ramuSimulationData.ts");
  fs.writeFileSync(outputPath, fileContent, "utf-8");
  console.log(`Generated ${ramuBets.length} bets at ${outputPath}`);
  return { roundsSummary, ramuBets, cumulativeTurnover, cumulativePayouts, runningBalance };
}

