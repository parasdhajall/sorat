import { CARDS } from "./cards";
import { calculateProfitGuaranteedWinner, getDeterministicRoundWinner } from "./realtime";
import { getTickets } from "./ticketStore";
import { getUsers } from "./userStore";
import { declareSoratRoundRpc } from "./supabase";

const ROUND_WINNERS_STORAGE_KEY = "sorat_round_winners_history";
const ROUND_RESULT_BROADCAST_CHANNEL = "sorat_round_result_sync_channel";

let resultChannel: BroadcastChannel | null = null;
function getResultBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  if (!resultChannel) {
    try {
      resultChannel = new BroadcastChannel(ROUND_RESULT_BROADCAST_CHANNEL);
    } catch {}
  }
  return resultChannel;
}

/**
 * Returns recorded winner for a past round if available
 */
export function getRecordedRoundWinner(roundNumber: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROUND_WINNERS_STORAGE_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      if (typeof map[roundNumber] === "number") {
        return map[roundNumber];
      }
    }
  } catch {}
  return null;
}

/**
 * Persists winner into local storage and broadcasts to other open windows/terminals
 */
export function saveRecordedRoundWinner(roundNumber: number, winnerCardIndex: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(ROUND_WINNERS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[roundNumber] = winnerCardIndex;
    localStorage.setItem(ROUND_WINNERS_STORAGE_KEY, JSON.stringify(map));
    getResultBroadcastChannel()?.postMessage({
      type: "ROUND_WINNER_RESOLVED",
      roundNumber,
      winner: winnerCardIndex,
      timestamp: Date.now(),
    });
  } catch {}
}

/**
 * Universally resolves the winning card for a round ensuring >= 30% House Margin is maintained.
 * Works consistently across all terminals (Agent POS, Admin Panel, TV Screen) even when /tv is not open.
 */
export function resolveProfitGuaranteedWinnerForRound(
  roundNumber: number,
  roundId: string,
  forcedWinner: number | null = null,
  activeBets?: Record<number, number>
): number {
  // 1. If winner was already declared and saved, return it immediately for 100% determinism
  const existing = getRecordedRoundWinner(roundNumber);
  if (existing !== null && existing >= 0 && existing < 12) {
    return existing;
  }

  // 2. Aggregate all bets placed on this round across tickets, users, and staged bets
  const cardBets: Record<number, number> = activeBets ? { ...activeBets } : {};
  let totalTurnover = 0;

  // Aggregate from thermal tickets
  try {
    const tickets = getTickets();
    const cleanRoundId = (roundId || "").replace(/^#/, "").trim();
    for (const t of tickets) {
      const tRoundNum = t.roundNumber || parseInt((t.roundId || "").replace(/\D/g, ""), 10);
      const tRoundClean = (t.roundId || "").replace(/^#/, "").trim();
      if (tRoundNum === roundNumber || tRoundClean === cleanRoundId) {
        if (Array.isArray(t.items)) {
          for (const it of t.items) {
            cardBets[it.cardIndex] = (cardBets[it.cardIndex] || 0) + it.amount;
            totalTurnover += it.amount;
          }
        }
      }
    }
  } catch {}

  // Aggregate from user store bets (if any placed outside tickets)
  try {
    const users = getUsers();
    const cleanRoundId = (roundId || "").replace(/^#/, "").trim();
    for (const u of users) {
      if (Array.isArray(u.bets)) {
        for (const b of u.bets) {
          const bRoundNum = b.roundNumber || parseInt((b.roundId || "").replace(/\D/g, ""), 10);
          const bRoundClean = (b.roundId || "").replace(/^#/, "").trim();
          if (bRoundNum === roundNumber || bRoundClean === cleanRoundId) {
            // Include bet if not already counted
            if (cardBets[b.cardIndex] === undefined) {
              cardBets[b.cardIndex] = (cardBets[b.cardIndex] || 0) + b.stake;
              totalTurnover += b.stake;
            }
          }
        }
      }
    }
  } catch {}

  let winner: number;
  let reason = "ZERO_BET_ROUTER";

  // 3. If bets exist OR admin forced a winner, run the 30% Profit Engine
  if (totalTurnover > 0 || (forcedWinner !== null && forcedWinner >= 0)) {
    const decision = calculateProfitGuaranteedWinner(
      cardBets,
      totalTurnover,
      0,
      forcedWinner
    );
    winner = decision.winner;
    reason = decision.reason;
  } else {
    // Zero bets on this round: use timestamp hash
    winner = getDeterministicRoundWinner(roundNumber);
  }

  // 4. Save and broadcast decided winner
  saveRecordedRoundWinner(roundNumber, winner);

  // 5. Direct Supabase Stored Procedure Settlement (DigitJodi pattern)
  try {
    declareSoratRoundRpc({
      roundId,
      winningCard: winner,
      winningCardName: CARDS[winner]?.name || `Card ${winner}`,
      selectionReason: reason,
    }).catch(() => {});
  } catch {}

  return winner;
}
