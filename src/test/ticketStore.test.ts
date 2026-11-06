import { describe, expect, it } from "vitest";
import {
  createTicket,
  getTickets,
  settleTicketsForRound,
  claimTicket,
  findTicketByIdOrBarcode,
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
    // Payout: 20 * 9 = 180 (9x Payout)
    expect(settled.winningPayout).toBe(180);

    // Claim the winning payout at counter
    const claimed = claimTicket(settled.ticketId, "Agent Kalyan")!;
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.claimedAt).toBeDefined();
    expect(claimed.claimedBy).toBe("Agent Kalyan");

    // Attempting to claim again returns already claimed ticket without re-crediting
    const doubleClaim = claimTicket(settled.ticketId, "Agent Kalyan");
    expect(doubleClaim?.status).toBe("CLAIMED");
  });

  it("finds ticket by ID, full barcode, or trailing 4 digits", () => {
    const ticket = createTicket({
      roundId: "#0870",
      roundNumber: 870,
      items: [{ cardIndex: 0, cardName: "पतंग", amount: 100 }],
    });

    // Search by full ticket ID
    const foundById = findTicketByIdOrBarcode(ticket.ticketId);
    expect(foundById?.ticketId).toBe(ticket.ticketId);

    // Search by full barcode
    const foundByBarcode = findTicketByIdOrBarcode(ticket.barcode);
    expect(foundByBarcode?.ticketId).toBe(ticket.ticketId);

    // Search by trailing 4 digits
    const trailing4 = ticket.ticketId.slice(-4);
    const foundByTrailing = findTicketByIdOrBarcode(trailing4);
    expect(foundByTrailing?.ticketId).toBe(ticket.ticketId);

    // Non-existent search
    const notFound = findTicketByIdOrBarcode("NON_EXISTENT_9999");
    expect(notFound).toBeNull();
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

