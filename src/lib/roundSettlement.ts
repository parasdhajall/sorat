import { CARDS } from "./cards";
import { calculateProfitGuaranteedWinner, getDeterministicRoundWinner, sanitizeRoomId } from "./realtime";
import { getTickets } from "./ticketStore";
import { getUsers } from "./userStore";
import { declareSoratRoundRpc } from "./supabase";

const ROUND_WINNERS_STORAGE_KEY = "sorat_round_winners_history";
const ROUND_RESULT_BROADCAST_CHANNEL = "sorat_round_result_sync_channel";

const channelMap = new Map<string, BroadcastChannel>();
function getResultBroadcastChannel(roomId?: string): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  const channelName = roomId
    ? `${ROUND_RESULT_BROADCAST_CHANNEL}_${sanitizeRoomId(roomId)}`
    : ROUND_RESULT_BROADCAST_CHANNEL;
  if (!channelMap.has(channelName)) {
    try {
      channelMap.set(channelName, new BroadcastChannel(channelName));
    } catch {}
  }
  return channelMap.get(channelName) || null;
}

/**
 * Returns recorded winner for a past round if available (scoped to room if provided)
 */
export function getRecordedRoundWinner(roundNumber: number, roomId?: string): number | null {
  if (typeof window === "undefined") return null;
  const cleanRoom = roomId ? sanitizeRoomId(roomId) : null;
  try {
    if (cleanRoom) {
      const roomRaw = localStorage.getItem(`sorat_round_winners_${cleanRoom}`);
      if (roomRaw) {
        const map = JSON.parse(roomRaw);
        if (typeof map[roundNumber] === "number") {
          return map[roundNumber];
        }
      }
      return null;
    }
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
export function saveRecordedRoundWinner(
  roundNumber: number,
  winnerCardIndex: number,
  roomId?: string
): void {
  if (typeof window === "undefined") return;
  const cleanRoom = roomId ? sanitizeRoomId(roomId) : null;
  try {
    if (cleanRoom) {
      const roomKey = `sorat_round_winners_${cleanRoom}`;
      const roomRaw = localStorage.getItem(roomKey);
      const roomMap = roomRaw ? JSON.parse(roomRaw) : {};
      roomMap[roundNumber] = winnerCardIndex;
      localStorage.setItem(roomKey, JSON.stringify(roomMap));
      getResultBroadcastChannel(cleanRoom)?.postMessage({
        type: "ROUND_WINNER_RESOLVED",
        roundNumber,
        winner: winnerCardIndex,
        roomId: cleanRoom,
        timestamp: Date.now(),
      });
    }

    const raw = localStorage.getItem(ROUND_WINNERS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[roundNumber] = winnerCardIndex;
    localStorage.setItem(ROUND_WINNERS_STORAGE_KEY, JSON.stringify(map));
    getResultBroadcastChannel()?.postMessage({
      type: "ROUND_WINNER_RESOLVED",
      roundNumber,
      winner: winnerCardIndex,
      roomId: cleanRoom,
      timestamp: Date.now(),
    });
  } catch {}
}

/**
 * Universally resolves the winning card for a round ensuring >= 30% House Margin is maintained.
 * Counter-isolated: Strictly analyzes bets and turnover for THAT specific room/counter!
 */
export function resolveProfitGuaranteedWinnerForRound(
  roundNumber: number,
  roundId: string,
  forcedWinner: number | null = null,
  activeBets?: Record<number, number>,
  roomId?: string
): number {
  const cleanRoom = roomId ? sanitizeRoomId(roomId) : "sorat_main";

  // 1. If winner was already declared and saved for this counter/room, return it immediately
  const existing = getRecordedRoundWinner(roundNumber, cleanRoom);
  if (existing !== null && existing >= 0 && existing < 12) {
    return existing;
  }

  // 2. Aggregate all bets placed on this round strictly filtered by roomId/agent
  const cardBets: Record<number, number> = activeBets ? { ...activeBets } : {};
  let totalTurnover = 0;

  // Aggregate from thermal tickets strictly for this room
  try {
    const tickets = getTickets(cleanRoom);
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

  // Aggregate from user store bets (if scoped to this room/agent)
  try {
    const users = getUsers();
    const cleanRoundId = (roundId || "").replace(/^#/, "").trim();
    for (const u of users) {
      const isUserMatch =
        u.id.toLowerCase() === cleanRoom ||
        u.username.toLowerCase().replace(/^@/, "") === cleanRoom ||
        cleanRoom === "sorat_main";
      if (isUserMatch && Array.isArray(u.bets)) {
        for (const b of u.bets) {
          const bRoundNum = b.roundNumber || parseInt((b.roundId || "").replace(/\D/g, ""), 10);
          const bRoundClean = (b.roundId || "").replace(/^#/, "").trim();
          if (bRoundNum === roundNumber || bRoundClean === cleanRoundId) {
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

  // Cumulative room turnover and payouts from localStorage for 30%-35% margin lock
  let cumulativeTurnover = totalTurnover;
  let cumulativePayouts = 0;
  if (typeof window !== "undefined") {
    try {
      const savedTurnover = Number(localStorage.getItem(`sorat_total_turnover_${cleanRoom}`) || 0);
      const savedPayouts = Number(localStorage.getItem(`sorat_total_payouts_${cleanRoom}`) || 0);
      cumulativeTurnover = savedTurnover + totalTurnover;
      cumulativePayouts = savedPayouts;
    } catch {}
  }

  // 3. If bets exist OR admin forced a winner, run the Counter-Isolated Profit Engine
  if (totalTurnover > 0 || (forcedWinner !== null && forcedWinner >= 0)) {
    const decision = calculateProfitGuaranteedWinner(
      cardBets,
      cumulativeTurnover,
      cumulativePayouts,
      forcedWinner
    );
    winner = decision.winner;
    reason = decision.reason;
  } else {
    // Zero bets on this round: use timestamp hash
    winner = getDeterministicRoundWinner(roundNumber);
  }

  // 4. Save and broadcast decided winner for this room
  saveRecordedRoundWinner(roundNumber, winner, cleanRoom);

  // 5. Direct Supabase Stored Procedure Settlement (DigitJodi pattern)
  try {
    declareSoratRoundRpc({
      roundId,
      winningCard: winner,
      winningCardName: CARDS[winner]?.name || `Card ${winner}`,
      selectionReason: `${reason} [Room: ${cleanRoom}]`,
    }).catch(() => {});
  } catch {}

  return winner;
}
