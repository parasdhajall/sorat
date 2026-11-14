import { describe, it, expect } from "vitest";
import { calculateProfitGuaranteedWinner, analyzeCardProfitability } from "@/lib/realtime";
import { CARDS } from "@/lib/cards";
import { createTicket, claimTicket, settleTicketsForRound, getTickets, clearTickets } from "@/lib/ticketStore";
import { resolveProfitGuaranteedWinnerForRound } from "@/lib/roundSettlement";

describe("Live Multi-Agent Automated Round & 10% Commission Verification (Room Isolated Mode)", () => {
  it("executes multi-counter round in 100% Room Isolated Mode where EVERY counter is protected from loss", () => {
    clearTickets("all");

    console.log("\n================================================================================");
    console.log("   SORAT ROOM ISOLATED MODE: MULTI-COUNTER LIVE AUTOMATED EXECUTION TEST        ");
    console.log("================================================================================\n");

    // 1. SETUP 3 REAL AGENT COUNTERS (Each running its own isolated room display)
    const agents = [
      { id: "agent_suresh", username: "suresh01", roomId: "suresh01", name: "Suresh (Counter 1)", wallet: 5000, staked: 0, won: 0 },
      { id: "agent_nandan", username: "nandan",   roomId: "nandan",   name: "Nandan (Counter 2)", wallet: 5000, staked: 0, won: 0 },
      { id: "agent_raman",  username: "raman99",  roomId: "raman99",  name: "Raman (Counter 3)",  wallet: 5000, staked: 0, won: 0 },
    ];

    console.log("REGISTERED TEST AGENT COUNTERS (Room Isolated TV Setup):");
    agents.forEach(a => console.log(` • [Room: ${a.roomId}] ${a.name.padEnd(25)} | Balance: ${a.wallet} PTS`));
    console.log("--------------------------------------------------------------------------------");

    const roundNumber = 205;
    const roundId = `#0205`;

    // 2. EACH AGENT PUNCHES BETS AT THEIR OWN COUNTER POS
    // Counter 1: Suresh (Stake 450 PTS)
    const ticket1 = createTicket({
      roundId,
      roundNumber,
      roomId: agents[0].roomId,
      agentId: agents[0].id,
      agentName: agents[0].name,
      customerName: "Customer Vikas",
      items: [
        { cardIndex: 0, cardName: CARDS[0].name, amount: 200 }, // पतंग: 200 PTS
        { cardIndex: 1, cardName: CARDS[1].name, amount: 150 }, // छत्री: 150 PTS
        { cardIndex: 2, cardName: CARDS[2].name, amount: 100 }, // बॉल: 100 PTS
      ],
    });
    agents[0].wallet -= ticket1.totalAmount;
    agents[0].staked += ticket1.totalAmount;

    // Counter 2: Nandan (Stake 850 PTS)
    const ticket2 = createTicket({
      roundId,
      roundNumber,
      roomId: agents[1].roomId,
      agentId: agents[1].id,
      agentName: agents[1].name,
      customerName: "Customer Anil",
      items: [
        { cardIndex: 3, cardName: CARDS[3].name, amount: 300 }, // सूर्य: 300 PTS
        { cardIndex: 4, cardName: CARDS[4].name, amount: 100 }, // गुलाब: 100 PTS
        { cardIndex: 5, cardName: CARDS[5].name, amount: 200 }, // दिवा: 200 PTS
        { cardIndex: 7, cardName: CARDS[7].name, amount: 150 }, // चिमणी: 150 PTS
        { cardIndex: 8, cardName: CARDS[8].name, amount: 100 }, // ससा: 100 PTS
      ],
    });
    agents[1].wallet -= ticket2.totalAmount;
    agents[1].staked += ticket2.totalAmount;

    // Counter 3: Raman (Stake 700 PTS)
    const ticket3 = createTicket({
      roundId,
      roundNumber,
      roomId: agents[2].roomId,
      agentId: agents[2].id,
      agentName: agents[2].name,
      customerName: "Customer Mohan",
      items: [
        { cardIndex: 9,  cardName: CARDS[9].name,  amount: 150 }, // भोवरा: 150 PTS
        { cardIndex: 10, cardName: CARDS[10].name, amount: 100 }, // बादली: 100 PTS
        { cardIndex: 11, cardName: CARDS[11].name, amount: 350 }, // गाय: 350 PTS
        { cardIndex: 6,  cardName: CARDS[6].name,  amount: 100 }, // फुलपाखरू: 100 PTS
      ],
    });
    agents[2].wallet -= ticket3.totalAmount;
    agents[2].staked += ticket3.totalAmount;

    console.log(`\n>>> ROUND ${roundId} TICKETS PUNCHED PER COUNTER:`);
    [ticket1, ticket2, ticket3].forEach(t => {
      console.log(` • [Room: ${t.roomId}] Ticket #${t.ticketId} | Staked: ${t.totalAmount} PTS | Barcode: ${t.barcode}`);
    });

    // 3. IN ROOM ISOLATED MODE: EACH COUNTER DETERMINES ITS OWN FAIR & SAFE WINNER
    console.log("\n--------------------------------------------------------------------------------");
    console.log("ROOM ISOLATED ENGINE DECISION PER COUNTER (Zero Loss Guarantee on Every Counter):");
    console.log("--------------------------------------------------------------------------------");

    agents.forEach(agent => {
      // Resolve winner specifically for this agent's room:
      const winnerIndex = resolveProfitGuaranteedWinnerForRound(
        roundNumber,
        roundId,
        null,
        undefined,
        agent.roomId
      );

      // Settle tickets for this room
      settleTicketsForRound(roundId, winnerIndex, CARDS[winnerIndex].name, agent.roomId);

      const roomTickets = getTickets(agent.roomId).filter(t => t.roundId === roundId);
      let roomPayout = 0;
      roomTickets.forEach(t => {
        if (t.status === "WON") {
          roomPayout += (t.winningPayout || 0);
          claimTicket(t.ticketId, agent.name);
        }
      });

      agent.won = roomPayout;
      agent.wallet += roomPayout;

      const roomProfit = agent.staked - agent.won;
      const roomMargin = ((roomProfit / agent.staked) * 100).toFixed(1);

      console.log(`\n📺 [${agent.name}] TV Result: [Card ${winnerIndex}] ${CARDS[winnerIndex].name}`);
      console.log(`   • Counter Collection : ${agent.staked} PTS`);
      console.log(`   • Counter Payout Paid: ${agent.won} PTS`);
      console.log(`   • Counter Net Profit : +${roomProfit} PTS (${roomMargin}% House Margin)`);

      // In isolated room mode, house margin is strictly guaranteed >= 35%!
      expect(roomProfit).toBeGreaterThanOrEqual(agent.staked * 0.35);
    });

    // 4. AGENT COMMISSION & OWNER SETTLEMENT SHEET
    console.log("\n================================================================================");
    console.log("       ROOM ISOLATED SETTLEMENT: AGENT COMMISSION (10%) & OWNER SHARE (90%)     ");
    console.log("================================================================================\n");

    console.log("Agent Name            Staked (PTS)  Won (PTS)   Net Profit   10% Agent Comm   Owner Share (90%)");
    console.log("------------------------------------------------------------------------------------------------");

    let totalStaked = 0;
    let totalWon = 0;
    let totalComm = 0;
    let totalOwner = 0;

    agents.forEach(a => {
      const netProfit = a.staked - a.won;
      const comm10 = Math.round(netProfit * 0.10);
      const ownerShare = netProfit - comm10;

      totalStaked += a.staked;
      totalWon += a.won;
      totalComm += comm10;
      totalOwner += ownerShare;

      const nameStr = a.name.padEnd(21, " ");
      const stakedStr = String(a.staked).padStart(12, " ");
      const wonStr = String(a.won).padStart(10, " ");
      const netStr = `+${netProfit}`.padStart(12, " ");
      const commStr = `+${comm10} PTS`.padStart(16, " ");
      const ownerStr = `${ownerShare} PTS`.padStart(18, " ");

      console.log(`${nameStr} ${stakedStr} ${wonStr} ${netStr} ${commStr} ${ownerStr}`);

      // Every single agent is GUARANTEED positive profit and positive commission!
      expect(netProfit).toBeGreaterThan(0);
      expect(comm10).toBeGreaterThan(0);
    });

    console.log("------------------------------------------------------------------------------------------------");
    console.log(`TOTAL PLATFORM SUMMARY (Room Isolated):`);
    console.log(` • Total Bets Across All Counters: ${totalStaked} PTS`);
    console.log(` • Total Winnings Paid           : ${totalWon} PTS`);
    console.log(` • House Gross Profit            : +${totalStaked - totalWon} PTS (${(((totalStaked - totalWon) / totalStaked) * 100).toFixed(1)}%)`);
    console.log(` • Total 10% Agent Commission    : +${totalComm} PTS (Kept by Agents)`);
    console.log(` • Total Owner Net Share         : ${totalOwner} PTS (Payable to Owner)`);
    console.log("================================================================================\n");
  });
});
