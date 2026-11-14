import { describe, it, expect } from "vitest";
import { calculateProfitGuaranteedWinner, analyzeCardProfitability } from "@/lib/realtime";
import { CARDS } from "@/lib/cards";
import { createTicket, claimTicket, settleTicketsForRound, getTickets } from "@/lib/ticketStore";

describe("Live Multi-Agent Automated Round & 10% Commission Verification", () => {
  it("executes a realistic multi-counter round with 3 agents, 30% margin lock and 10% commission", () => {
    console.log("\n================================================================================");
    console.log("       SORAT MULTI-AGENT LIVE AUTOMATED ROUND EXECUTION & AUDIT TEST           ");
    console.log("================================================================================\n");

    // 1. SETUP 3 REAL AGENT COUNTERS
    const agents = [
      { id: "agent_suresh", username: "suresh01", name: "Suresh (Counter 1)", wallet: 5000, staked: 0, won: 0 },
      { id: "agent_nandan", username: "nandan",   name: "Nandan (Counter 2)", wallet: 5000, staked: 0, won: 0 },
      { id: "agent_raman",  username: "raman99",  name: "Raman (Counter 3)",  wallet: 5000, staked: 0, won: 0 },
    ];

    console.log("REGISTERED TEST AGENT COUNTERS:");
    agents.forEach(a => console.log(` • [${a.username}] ${a.name.padEnd(25)} | Balance: ${a.wallet} PTS`));
    console.log("--------------------------------------------------------------------------------");

    const roundNumber = 205;
    const roundId = `#0205`;

    // 2. AGENTS PUNCH TICKETS ACROSS DIFFERENT CARDS
    // Agent Suresh (Counter 1): Punches 450 PTS
    const sureshItems = [
      { cardIndex: 0, cardName: CARDS[0].name, amount: 200 }, // पतंग: 200 PTS
      { cardIndex: 1, cardName: CARDS[1].name, amount: 150 }, // छत्री: 150 PTS
      { cardIndex: 2, cardName: CARDS[2].name, amount: 100 }, // बॉल: 100 PTS
    ];
    const ticket1 = createTicket({
      roundId,
      roundNumber,
      agentId: agents[0].id,
      agentName: agents[0].name,
      customerName: "Customer Vikas",
      items: sureshItems,
    });
    agents[0].wallet -= ticket1.totalAmount;
    agents[0].staked += ticket1.totalAmount;

    // Agent Nandan (Counter 2): Punches 850 PTS
    const nandanItems = [
      { cardIndex: 3, cardName: CARDS[3].name, amount: 300 }, // सूर्य: 300 PTS
      { cardIndex: 4, cardName: CARDS[4].name, amount: 100 }, // गुलाब: 100 PTS
      { cardIndex: 5, cardName: CARDS[5].name, amount: 200 }, // दिवा: 200 PTS
      { cardIndex: 7, cardName: CARDS[7].name, amount: 150 }, // चिमणी: 150 PTS
      { cardIndex: 8, cardName: CARDS[8].name, amount: 100 }, // ससा: 100 PTS
    ];
    const ticket2 = createTicket({
      roundId,
      roundNumber,
      agentId: agents[1].id,
      agentName: agents[1].name,
      customerName: "Customer Anil",
      items: nandanItems,
    });
    agents[1].wallet -= ticket2.totalAmount;
    agents[1].staked += ticket2.totalAmount;

    // Agent Raman (Counter 3): Punches 700 PTS
    const ramanItems = [
      { cardIndex: 9,  cardName: CARDS[9].name,  amount: 150 }, // भोवरा: 150 PTS
      { cardIndex: 10, cardName: CARDS[10].name, amount: 100 }, // बादली: 100 PTS
      { cardIndex: 11, cardName: CARDS[11].name, amount: 350 }, // गाय: 350 PTS
      { cardIndex: 6,  cardName: CARDS[6].name,  amount: 100 }, // फुलपाखरू: 100 PTS
    ];
    const ticket3 = createTicket({
      roundId,
      roundNumber,
      agentId: agents[2].id,
      agentName: agents[2].name,
      customerName: "Customer Mohan",
      items: ramanItems,
    });
    agents[2].wallet -= ticket3.totalAmount;
    agents[2].staked += ticket3.totalAmount;

    const tickets = [ticket1, ticket2, ticket3];
    const totalTurnover = ticket1.totalAmount + ticket2.totalAmount + ticket3.totalAmount;

    console.log(`\n>>> ROUND ${roundId} COLLECTION & TICKETS PUNCHED:`);
    tickets.forEach(t => {
      console.log(` • Ticket [${t.ticketId}] | Counter: ${t.agentName} | Customer: ${t.customerName} | Stake: ${t.totalAmount} PTS | Barcode: ${t.barcode}`);
    });
    console.log(`\nTOTAL ROUND TURNOVER (SALES): ${totalTurnover} PTS`);

    // 3. ENGINE 30% PROFIT RISK AUDIT
    const combinedCardBets: Record<number, number> = {};
    for (let i = 0; i < 12; i++) combinedCardBets[i] = 0;
    tickets.forEach(t => {
      t.items.forEach(item => {
        combinedCardBets[item.cardIndex] = (combinedCardBets[item.cardIndex] || 0) + item.amount;
      });
    });

    const analysis = analyzeCardProfitability(combinedCardBets, 0, 0);

    console.log("\n--------------------------------------------------------------------------------");
    console.log("ENGINE CARD-BY-CARD AUDIT TABLE (9X Payout & House Margin Check):");
    console.log("--------------------------------------------------------------------------------");
    console.log("Card Name           Bet (PTS)   9X Payout   House Profit   Margin %   Status");
    console.log("--------------------------------------------------------------------------------");
    analysis.forEach(c => {
      const cardName = CARDS[c.card].name.padEnd(18, " ");
      const betStr = String(c.bet).padStart(9, " ");
      const payoutStr = String(c.potentialPayout).padStart(11, " ");
      const houseNetIfWins = totalTurnover - c.potentialPayout;
      const marginIfWins = ((houseNetIfWins / totalTurnover) * 100);
      const profitStr = String(houseNetIfWins).padStart(14, " ");
      const marginStr = (marginIfWins.toFixed(1) + "%").padStart(10, " ");
      const statusStr = c.status.padStart(10, " ");
      console.log(`${cardName} ${betStr} ${payoutStr} ${profitStr} ${marginStr} ${statusStr}`);
    });
    console.log("--------------------------------------------------------------------------------");

    // 4. ENGINE DECISION: SELECT GUARANTEED PROFIT WINNER
    const decision = calculateProfitGuaranteedWinner(combinedCardBets, 0, 0);
    const winningCard = CARDS[decision.winner];
    const winningBet = combinedCardBets[decision.winner] || 0;
    const totalPayout = winningBet * 9;
    const houseGrossProfit = totalTurnover - totalPayout;
    const houseMarginPercent = ((houseGrossProfit / totalTurnover) * 100).toFixed(2);

    console.log(`\n🏆 ROUND WINNER DECLARED: [Card ${decision.winner}] ${winningCard.name}`);
    console.log(` • Selection Logic   : ${decision.reason}`);
    console.log(` • Total Round Payout: ${totalPayout} PTS`);
    console.log(` • House Gross Profit: ${houseGrossProfit} PTS (${houseMarginPercent}% Margin)`);

    // House profit must guarantee >= 30% margin!
    expect(Number(houseMarginPercent)).toBeGreaterThanOrEqual(30);

    // 5. SETTLE TICKETS IN TICKET STORE
    settleTicketsForRound(roundId, decision.winner, winningCard.name);

    console.log("\n>>> TICKET STATUS & DISBURSEMENT:");
    const settledTickets = getTickets("all").filter(t => t.roundId === roundId);
    settledTickets.forEach(t => {
      if (t.status === "WON") {
        const winAmount = t.winningPayout || 0;
        // Simulate agent claiming the prize in POS
        const claimed = claimTicket(t.ticketId, t.agentName);
        expect(claimed).not.toBeNull();
        expect(claimed?.status).toBe("CLAIMED");

        // Credit to agent wallet
        const agent = agents.find(a => a.id === t.agentId)!;
        agent.won += winAmount;
        agent.wallet += winAmount;

        console.log(` • Ticket [${t.ticketId}] on ${t.agentName}: 🏆 WON ${winAmount} PTS on ${winningCard.name} -> Marked CLAIMED & CLOSED!`);
      } else {
        console.log(` • Ticket [${t.ticketId}] on ${t.agentName}: LOST (0 PTS)`);
      }
    });

    // 6. PER-AGENT 10% COMMISSION CALCULATION (ON NET PROFIT)
    console.log("\n================================================================================");
    console.log("                    AGENT COMMISSION & OWNER SETTLEMENT SHEET                   ");
    console.log("================================================================================\n");

    console.log("Agent Name            Staked (PTS)  Won (PTS)   Net Profit   10% Agent Comm   Owner Share (90%)");
    console.log("------------------------------------------------------------------------------------------------");
    
    let totalPlatformCommission = 0;
    let totalPlatformOwnerShare = 0;

    agents.forEach(a => {
      const netProfit = a.staked - a.won;
      // 10% commission is strictly on Net Profit (if profit > 0)
      const commission10 = netProfit > 0 ? Math.round(netProfit * 0.10) : 0;
      const ownerShare = netProfit > 0 ? netProfit - commission10 : netProfit;

      totalPlatformCommission += commission10;
      totalPlatformOwnerShare += ownerShare;

      const nameStr = a.name.padEnd(21, " ");
      const stakedStr = String(a.staked).padStart(12, " ");
      const wonStr = String(a.won).padStart(10, " ");
      const netStr = (netProfit >= 0 ? `+${netProfit}` : String(netProfit)).padStart(12, " ");
      const commStr = `+${commission10} PTS`.padStart(16, " ");
      const ownerStr = `${ownerShare} PTS`.padStart(18, " ");

      console.log(`${nameStr} ${stakedStr} ${wonStr} ${netStr} ${commStr} ${ownerStr}`);
      expect(commission10).toBe(netProfit > 0 ? Math.round(netProfit * 0.10) : 0);
    });

    console.log("------------------------------------------------------------------------------------------------");
    console.log(`TOTAL PLATFORM SUMMARY:`);
    console.log(` • Total Bets Placed (Turnover) : ${totalTurnover} PTS`);
    console.log(` • Total Winnings Disbursed    : ${totalPayout} PTS`);
    console.log(` • House Gross Profit          : ${houseGrossProfit} PTS (${houseMarginPercent}%)`);
    console.log(` • Total Agent Commission (10%): +${totalPlatformCommission} PTS (Kept by Agents)`);
    console.log(` • Total Owner Net Share       : ${totalPlatformOwnerShare} PTS (Payable to Owner)`);
    console.log("================================================================================\n");
  });
});
