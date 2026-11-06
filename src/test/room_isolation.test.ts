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
});

