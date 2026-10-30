import { useState } from "react";
import { CARDS } from "@/lib/cards";
import {
  createTicket,
  getTickets,
  claimTicket,
  ThermalTicket,
  BetItem,
} from "@/lib/ticketStore";

interface CounterPosModalProps {
  isOpen: boolean;
  onClose: () => void;
  roundId: string;
  roundNumber: number;
  agentBalance: number;
  onBetPlaced: (betsDelta: Record<number, number>, totalBet: number, ticket: ThermalTicket) => void;
  onShowSlip: (ticket: ThermalTicket) => void;
}

export function CounterPosModal({
  isOpen,
  onClose,
  roundId,
  roundNumber,
  agentBalance,
  onBetPlaced,
  onShowSlip,
}: CounterPosModalProps) {
  const [activeTab, setActiveTab] = useState<"punch" | "history">("punch");
  const [customerName, setCustomerName] = useState("");
  const [activeChip, setActiveChip] = useState<number>(10);
  const [selectedCards, setSelectedCards] = useState<Record<number, number>>({});
  const [ticketsList, setTicketsList] = useState<ThermalTicket[]>(() => getTickets());

  if (!isOpen) return null;

  const totalTicketStake = Object.values(selectedCards).reduce((a, b) => a + b, 0);
  const isBalanceEnough = agentBalance >= totalTicketStake;

  const handleCardClick = (cardIdx: number) => {
    setSelectedCards((prev) => ({
      ...prev,
      [cardIdx]: (prev[cardIdx] || 0) + activeChip,
    }));
  };

  const handleClearCard = (cardIdx: number) => {
    setSelectedCards((prev) => {
      const next = { ...prev };
      delete next[cardIdx];
      return next;
    });
  };

  const handleClearAll = () => {
    setSelectedCards({});
  };

  const handlePunchAndPrint = () => {
    if (totalTicketStake <= 0) {
      alert("Kripya kam se kam ek card par bet chunein!");
      return;
    }

    if (!isBalanceEnough) {
      alert(`Insufficient balance! Needed: ₹${totalTicketStake}, Available: ₹${agentBalance}. Please recharge counter!`);
      return;
    }

    // Prepare bet items
    const items: BetItem[] = Object.entries(selectedCards).map(([idx, amt]) => ({
      cardIndex: Number(idx),
      cardName: CARDS[Number(idx)]?.name || `Card ${idx}`,
      amount: amt,
    }));

    // Create ticket in ticketStore
    const newTicket = createTicket({
      roundId,
      roundNumber,
      customerName: customerName.trim() || undefined,
      agentName: "Main Kiosk Counter",
      items,
    });

    // Notify parent to deduct balance and update live round bets
    onBetPlaced(selectedCards, totalTicketStake, newTicket);

    // Refresh tickets list
    setTicketsList(getTickets());

    // Reset form
    setSelectedCards({});
    setCustomerName("");

    // Show thermal slip modal & trigger print
    onShowSlip(newTicket);
  };

  const handleClaimPrize = (ticketId: string) => {
    const updated = claimTicket(ticketId);
    if (updated) {
      setTicketsList(getTickets());
      alert(`Ticket #${ticketId} prize of ₹${updated.winningPayout} marked as PAID/CLAIMED!`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 select-none no-print">
      <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-4 shadow-2xl space-y-3 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-gold grid place-items-center text-lg text-primary-foreground font-black shadow-gold">
              🖨️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-black text-foreground">
                  COUNTER POS: PUNCH BET & PRINT PARCHI
                </h2>
                <span className="rounded-md bg-primary/20 border border-primary/40 px-2 py-0.2 text-[10px] font-mono font-black text-primary">
                  ROUND {roundId}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground block font-mono">
                Counter Balance: <strong className="text-primary font-bold">₹{agentBalance.toLocaleString("en-IN")}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted/80 p-0.5 rounded-xl border border-border text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("punch")}
                className={`py-1 px-3 rounded-lg font-bold transition ${
                  activeTab === "punch"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Parchi Booking
              </button>
              <button
                type="button"
                onClick={() => {
                  setTicketsList(getTickets());
                  setActiveTab("history");
                }}
                className={`py-1 px-2.5 rounded-lg font-bold transition ${
                  activeTab === "history"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Parchi List ({ticketsList.length})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm p-1.5 rounded-lg hover:bg-muted"
            >
              ✕
            </button>
          </div>
        </div>

        {/* TAB 1: PUNCH BET & PRINT SLIP */}
        {activeTab === "punch" && (
          <div className="space-y-3 overflow-y-auto pr-1 flex-1">
            {/* Customer Name & Stake Chips */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-background/60 p-2.5 rounded-2xl border border-border/80">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">👤</span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer Name or Token # (e.g. Ramesh / #42)"
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-input bg-card text-foreground text-xs font-bold focus:border-primary focus:outline-none"
                />
              </div>

              {/* Stake Amount Selector */}
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Chip:</span>
                {[10, 20, 50, 100, 200, 500].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setActiveChip(chip)}
                    className={`py-1 px-2.5 rounded-lg text-xs font-mono font-black transition active:scale-95 border ${
                      activeChip === chip
                        ? "bg-gradient-gold text-primary-foreground border-primary shadow-gold"
                        : "bg-card border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    ₹{chip}
                  </button>
                ))}
              </div>
            </div>

            {/* 12 Cards Grid for Fast Counter Punching */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {CARDS.map((card, i) => {
                const staked = selectedCards[i] || 0;
                return (
                  <div
                    key={i}
                    onClick={() => handleCardClick(i)}
                    className={`relative rounded-xl border p-2 cursor-pointer transition active:scale-95 flex flex-col items-center justify-between text-center select-none ${
                      staked > 0
                        ? "border-primary bg-primary/20 ring-2 ring-primary shadow-gold"
                        : "border-border/80 bg-card hover:border-primary/50"
                    }`}
                  >
                    {/* Clear Button if card has bet */}
                    {staked > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearCard(i);
                        }}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white text-[9px] font-black grid place-items-center shadow-sm"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}

                    <img
                      src={card.img}
                      alt={card.name}
                      className="h-10 w-10 rounded-lg object-cover border border-border shadow-sm mb-1"
                    />
                    <span className="font-display text-xs font-black text-foreground block leading-tight">
                      {card.name}
                    </span>

                    <span
                      className={`text-[10px] font-mono font-bold mt-1 px-1 rounded ${
                        staked > 0
                          ? "bg-primary text-primary-foreground font-black"
                          : "text-muted-foreground"
                      }`}
                    >
                      {staked > 0 ? `₹${staked}` : "+ Add"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Live Cart Summary Strip */}
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-inner">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                    Selected Cards: {Object.keys(selectedCards).length}
                  </span>
                  {totalTicketStake > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-[10px] text-destructive hover:underline font-bold"
                    >
                      Clear Selection
                    </button>
                  )}
                </div>
                <div className="text-xl font-display font-black text-foreground">
                  Total Bet: <span className="text-primary">₹{totalTicketStake}</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono block">
                  Remaining Balance: ₹{Math.max(0, agentBalance - totalTicketStake).toLocaleString("en-IN")}
                </span>
              </div>

              <button
                type="button"
                onClick={handlePunchAndPrint}
                disabled={totalTicketStake <= 0 || !isBalanceEnough}
                className="py-3 px-6 rounded-2xl bg-gradient-gold text-primary-foreground font-display text-sm font-black shadow-gold hover:opacity-90 transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>🖨️</span>
                <span>PUNCH BET & PRINT PARCHI</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: RECENT TICKETS & CLAIM WINNERS */}
        {activeTab === "history" && (
          <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-muted-foreground">
                All Parchi Slips ({ticketsList.length})
              </span>
              <span className="text-[10px] text-muted-foreground">
                Customer slip lekar aaye toh "Pay Out" karein
              </span>
            </div>

            {ticketsList.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl text-xs">
                No tickets issued yet. Punch a bet to generate the first thermal receipt!
              </div>
            ) : (
              ticketsList.map((t) => (
                <div
                  key={t.ticketId}
                  className={`p-3 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    t.status === "WON"
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
                      : t.status === "CLAIMED"
                      ? "border-zinc-500/30 bg-muted/30"
                      : "border-border bg-card"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-black text-xs text-foreground">
                        #{t.ticketId}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border">
                        Round {t.roundId}
                      </span>
                      <span
                        className={`text-[9px] font-black px-2 py-0.2 rounded-full uppercase ${
                          t.status === "WON"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                            : t.status === "CLAIMED"
                            ? "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40"
                            : t.status === "LOST"
                            ? "bg-destructive/15 text-destructive border border-destructive/30"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        }`}
                      >
                        {t.status === "WON"
                          ? `🏆 WON ₹${t.winningPayout}`
                          : t.status === "CLAIMED"
                          ? "✓ CLAIMED & PAID"
                          : t.status === "LOST"
                          ? "LOST"
                          : "⏳ IN PLAY"}
                      </span>
                    </div>

                    <div className="text-[11px] text-muted-foreground mt-1">
                      Customer: <strong className="text-foreground">{t.customerName}</strong> • {t.dateStr} {t.timeStr}
                    </div>

                    {/* Cards on ticket */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {t.items.map((item, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-background border border-border text-foreground"
                        >
                          {item.cardName}: ₹{item.amount}
                        </span>
                      ))}
                      <span className="text-[10px] font-mono font-black text-primary">
                        Total: ₹{t.totalAmount}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                    {t.status === "WON" && (
                      <button
                        type="button"
                        onClick={() => handleClaimPrize(t.ticketId)}
                        className="py-1.5 px-3 rounded-xl bg-emerald-500 text-black font-display text-xs font-black shadow-gold hover:opacity-90 transition active:scale-95"
                      >
                        💵 Pay Out ₹{t.winningPayout}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onShowSlip(t)}
                      className="py-1.5 px-3 rounded-xl bg-muted border border-border text-foreground hover:bg-accent text-xs font-bold transition flex items-center gap-1"
                    >
                      <span>🖨️</span>
                      <span>Reprint</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
