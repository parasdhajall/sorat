import { getTodayDateStr, formatTime } from "./userStore";
import { CARDS } from "./cards";

export interface BetItem {
  cardIndex: number;
  cardName: string;
  amount: number;
}

export interface ThermalTicket {
  ticketId: string; // e.g. "TKT-0845-9281"
  barcode: string; // e.g. "8459281"
  roundId: string; // e.g. "#0845"
  roundNumber: number;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  customerName: string;
  agentName: string;
  items: BetItem[];
  totalAmount: number;
  status: "ACTIVE" | "WON" | "LOST" | "CLAIMED";
  winningCardIndex?: number;
  winningCardName?: string;
  winningPayout?: number;
  claimedAt?: number;
}

const STORAGE_KEY = "sorat_thermal_tickets_v1";
const SYNC_CHANNEL = "sorat_ticket_sync_channel";

let cachedTickets: ThermalTicket[] | null = null;
let ticketChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  if (!ticketChannel) {
    try {
      ticketChannel = new BroadcastChannel(SYNC_CHANNEL);
    } catch {}
  }
  return ticketChannel;
}

function notifySync(type: string, data?: any) {
  try {
    getChannel()?.postMessage({ type, data, ts: Date.now() });
  } catch {}
}

export function getTickets(): ThermalTicket[] {
  if (typeof window === "undefined") return [];
  if (cachedTickets) return cachedTickets;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cachedTickets = parsed;
        return parsed;
      }
    }
  } catch {}
  return [];
}

export function saveTickets(tickets: ThermalTicket[]): void {
  cachedTickets = tickets;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
      notifySync("TICKETS_UPDATED", tickets);
    } catch {}
  }
}

/**
 * Creates and prints a new thermal bet slip (Parchi).
 */
export function createTicket(data: {
  roundId: string;
  roundNumber: number;
  customerName?: string;
  agentName?: string;
  items: BetItem[];
}): ThermalTicket {
  const now = Date.now();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const cleanRound = data.roundId.replace("#", "").padStart(4, "0");
  const ticketId = `TKT-${cleanRound}-${randomSuffix}`;
  const barcode = `${cleanRound}${randomSuffix}`;

  const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);

  const newTicket: ThermalTicket = {
    ticketId,
    barcode,
    roundId: data.roundId,
    roundNumber: data.roundNumber,
    timestamp: now,
    dateStr: getTodayDateStr(new Date(now)),
    timeStr: formatTime(now),
    customerName: data.customerName?.trim() || `Customer #${randomSuffix.toString().slice(-2)}`,
    agentName: data.agentName || "Kiosk Agent",
    items: data.items,
    totalAmount,
    status: "ACTIVE",
  };

  const tickets = getTickets();
  tickets.unshift(newTicket);
  // Keep last 500 tickets in cache
  if (tickets.length > 500) tickets.length = 500;
  saveTickets(tickets);

  return newTicket;
}

/**
 * Settle all tickets when winning card is revealed.
 */
export function settleTicketsForRound(
  roundId: string,
  winningCardIndex: number,
  winningCardName: string
): void {
  const tickets = getTickets();
  let changed = false;

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t.roundId === roundId && t.status === "ACTIVE") {
      changed = true;
      const winningItem = t.items.find((item) => item.cardIndex === winningCardIndex);
      const isWin = Boolean(winningItem && winningItem.amount > 0);
      const winningPayout = isWin ? winningItem!.amount * 10 : 0;

      tickets[i] = {
        ...t,
        status: isWin ? "WON" : "LOST",
        winningCardIndex,
        winningCardName,
        winningPayout,
      };
    }
  }

  if (changed) {
    saveTickets(tickets);
  }
}

/**
 * Mark a winning ticket as CLAIMED (Cash paid to customer).
 */
export function claimTicket(ticketId: string): ThermalTicket | null {
  const tickets = getTickets();
  const idx = tickets.findIndex((t) => t.ticketId === ticketId);
  if (idx === -1) return null;

  const target = { ...tickets[idx] };
  if (target.status !== "WON") return target;

  target.status = "CLAIMED";
  target.claimedAt = Date.now();
  tickets[idx] = target;
  saveTickets(tickets);
  return target;
}

