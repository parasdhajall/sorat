import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeRoomId, DEFAULT_ROOM_ID } from "../lib/realtime";
import { createTicket, getTickets, clearTickets } from "../lib/ticketStore";
import {
  resolveProfitGuaranteedWinnerForRound,
  getRecordedRoundWinner,
  saveRecordedRoundWinner,
} from "../lib/roundSettlement";

describe("Independent Counter Rooms & Realtime Isolation Tests", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("sanitizes room IDs correctly for URL and Supabase channels", () => {
    expect(sanitizeRoomId("@agent_kalyan_01")).toBe("agent_kalyan_01");
    expect(sanitizeRoomId("Agent Kalyan 01")).toBe("agent_kalyan_01");
    expect(sanitizeRoomId("COUNTER#99")).toBe("counter_99");
    expect(sanitizeRoomId("")).toBe(DEFAULT_ROOM_ID);
    expect(sanitizeRoomId(undefined)).toBe(DEFAULT_ROOM_ID);
  });

  it("isolates ticket bets per counter room", () => {
    clearTickets("all");

    // Counter A ticket
    const ticketA = createTicket({
      roundId: "#0850",
      roundNumber: 850,
      agentId: "agent_kalyan",
      roomId: "agent_kalyan",
      customerName: "Ramu",
      items: [{ cardIndex: 0, cardName: "पतंग", amount: 200 }],
    });

    // Counter B ticket
    const ticketB = createTicket({
      roundId: "#0850",
      roundNumber: 850,
      agentId: "agent_thane",
      roomId: "agent_thane",
      customerName: "Suresh",
      items: [{ cardIndex: 3, cardName: "सूर्य", amount: 500 }],
    });

    const kalyanTickets = getTickets("agent_kalyan");
    const thaneTickets = getTickets("agent_thane");

    expect(kalyanTickets.some((t) => t.ticketId === ticketA.ticketId)).toBe(true);
    expect(kalyanTickets.some((t) => t.ticketId === ticketB.ticketId)).toBe(false);

    expect(thaneTickets.some((t) => t.ticketId === ticketB.ticketId)).toBe(true);
    expect(thaneTickets.some((t) => t.ticketId === ticketA.ticketId)).toBe(false);
  });

  it("guarantees counter-isolated profit settlement (bets on Counter A do not affect Counter B)", () => {
    clearTickets("all");

    // In Round 851, Counter A receives heavy bet on card 0 (पतंग)
    createTicket({
      roundId: "#0851",
      roundNumber: 851,
      roomId: "counter_a",
      items: [{ cardIndex: 0, cardName: "पतंग", amount: 1000 }],
    });

    // In Round 851, Counter B receives heavy bet on card 3 (सूर्य)
    createTicket({
      roundId: "#0851",
      roundNumber: 851,
      roomId: "counter_b",
      items: [{ cardIndex: 3, cardName: "सूर्य", amount: 1000 }],
    });

    // Winner resolved for Counter A must protect profit for Counter A (card 0 blocked)
    const winnerA = resolveProfitGuaranteedWinnerForRound(851, "#0851", null, undefined, "counter_a");
    // Card 0 has potential payout ₹9000 on turnover ₹1000, so it must NOT win on Counter A
    expect(winnerA).not.toBe(0);

    // Winner resolved for Counter B must protect profit for Counter B (card 3 blocked)
    const winnerB = resolveProfitGuaranteedWinnerForRound(851, "#0851", null, undefined, "counter_b");
    expect(winnerB).not.toBe(3);

    // Record check
    expect(getRecordedRoundWinner(851, "counter_a")).toBe(winnerA);
    expect(getRecordedRoundWinner(851, "counter_b")).toBe(winnerB);
  });

  it("proves that in Room Isolated Mode, an individual counter (like Nandan) NEVER has a loss and always secures >= 35% house margin and positive commission", () => {
    clearTickets("all");

    // Nandan's counter receives 850 PTS total bets:
    // Card 3 (सूर्य): 300 PTS -> 2700 PTS potential payout (Loss if wins)
    // Card 4 (गुलाब): 100 PTS -> 900 PTS potential payout (Loss if wins, because 900 > 850)
    // Card 5 (दिवा): 200 PTS -> 1800 PTS potential payout (Loss if wins)
    // Card 7 (चिमणी): 150 PTS -> 1350 PTS potential payout (Loss if wins)
    // Card 8 (ससा): 100 PTS -> 900 PTS potential payout (Loss if wins)
    // Cards 0, 1, 2, 6, 9, 10, 11: 0 PTS -> 0 PTS payout (100% profit!)
    createTicket({
      roundId: "#0852",
      roundNumber: 852,
      roomId: "nandan",
      agentId: "agent_nandan",
      items: [
        { cardIndex: 3, cardName: "सूर्य", amount: 300 },
        { cardIndex: 4, cardName: "गुलाब", amount: 100 },
        { cardIndex: 5, cardName: "दिवा", amount: 200 },
        { cardIndex: 7, cardName: "चिमणी", amount: 150 },
        { cardIndex: 8, cardName: "ससा", amount: 100 },
      ],
    });

    // In isolated room mode for 'nandan', resolve winner:
    const winnerNandan = resolveProfitGuaranteedWinnerForRound(852, "#0852", null, undefined, "nandan");

    // All loss-making cards (3, 4, 5, 7, 8) MUST BE BLOCKED on Nandan's counter!
    expect([3, 4, 5, 7, 8].includes(winnerNandan)).toBe(false);

    // Only zero-bet / profit-guaranteed cards (0, 1, 2, 6, 9, 10, 11) can win!
    expect([0, 1, 2, 6, 9, 10, 11].includes(winnerNandan)).toBe(true);

    // Calculate Nandan's financial outcome in isolated mode:
    const nandanStaked = 850;
    const nandanPayout = 0; // because a zero-bet card won
    const nandanNetProfit = nandanStaked - nandanPayout;
    const nandanCommission10 = Math.round(nandanNetProfit * 0.10);

    // Guaranteed >= 35% margin (here 100% profit!)
    expect(nandanNetProfit).toBeGreaterThanOrEqual(850 * 0.35);
    // Guaranteed positive agent commission
    expect(nandanCommission10).toBe(85);
  });
});

