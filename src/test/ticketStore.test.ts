import { describe, expect, it } from "vitest";
import {
  createTicket,
  getTickets,
  settleTicketsForRound,
  claimTicket,
} from "@/lib/ticketStore";

describe("Thermal Printer Ticket POS Engine", () => {
  it("creates a thermal ticket with unique ID, barcode, and bet items", () => {
    const ticket = createTicket({
      roundId: "#0845",
      roundNumber: 845,
      customerName: "Ramesh Sharma",
      agentName: "Main Counter",
      items: [
        { cardIndex: 0, cardName: "पतंग", amount: 50 },
        { cardIndex: 3, cardName: "सूर्य", amount: 100 },
      ],
    });

    expect(ticket.ticketId).toContain("TKT-0845-");
    expect(ticket.totalAmount).toBe(150);
    expect(ticket.status).toBe("ACTIVE");
    expect(ticket.items.length).toBe(2);

    const all = getTickets();
    const found = all.find((t) => t.ticketId === ticket.ticketId);
    expect(found).toBeDefined();
  });

  it("settles tickets correctly when winning card is revealed", () => {
    const ticket = createTicket({
      roundId: "#0850",
      roundNumber: 850,
      customerName: "Winner Test",
      items: [
        { cardIndex: 4, cardName: "गुलाब", amount: 20 },
        { cardIndex: 7, cardName: "चिमणी", amount: 30 },
      ],
    });

    // Settle with winning card 4 (गुलाब)
    settleTicketsForRound("#0850", 4, "गुलाब");

    const all = getTickets();
    const settled = all.find((t) => t.ticketId === ticket.ticketId)!;

    expect(settled.status).toBe("WON");
    expect(settled.winningCardIndex).toBe(4);
    // Payout: 20 * 10 = 200
    expect(settled.winningPayout).toBe(200);

    // Claim the winning payout at counter
    const claimed = claimTicket(settled.ticketId)!;
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.claimedAt).toBeDefined();
  });

  it("marks ticket as LOST when none of its cards win", () => {
    const ticket = createTicket({
      roundId: "#0855",
      roundNumber: 855,
      items: [{ cardIndex: 1, cardName: "छत्री", amount: 50 }],
    });

    // Winning card is 11 (गाय)
    settleTicketsForRound("#0855", 11, "गाय");

    const all = getTickets();
    const lost = all.find((t) => t.ticketId === ticket.ticketId)!;
    expect(lost.status).toBe("LOST");
    expect(lost.winningPayout).toBe(0);
  });
});

