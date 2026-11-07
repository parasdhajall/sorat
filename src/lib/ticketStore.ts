import { getTodayDateStr, formatTime } from "./userStore";
import { CARDS } from "./cards";
import { PAYOUT_MULTIPLIER } from "./realtime";
import { claimTicketInSupabase } from "./supabase";

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
  agentId?: string | undefined;
  username?: string | undefined;
  roomId?: string | undefined; // Room / Counter Isolation
  items: BetItem[];
  totalAmount: number;
  status: "ACTIVE" | "WON" | "LOST" | "CLAIMED" | "SETTLED";
  winningCardIndex?: number | undefined;
  winningCardName?: string | undefined;
  winningPayout?: number | undefined;
  claimedAt?: number | undefined;
  claimedBy?: string | undefined;
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

export function cleanupLegacyUnscopedTickets(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Retain only tickets with explicit non-empty agentId or username
      const scopedOnly = parsed.filter(
        (t: any) => Boolean((t.agentId && t.agentId.trim()) || (t.username && t.username.trim()))
      );
      if (scopedOnly.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scopedOnly));
        cachedTickets = scopedOnly;
      }
    }
  } catch {}
}

export function getTickets(agentId?: string): ThermalTicket[] {
  if (typeof window === "undefined") return [];
  cleanupLegacyUnscopedTickets();
  let all: ThermalTicket[] = [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        all = parsed;
      }
    }
  } catch {}

  cachedTickets = all;
  if (!agentId || agentId === "all") return all;

  const cleanAgent = agentId.toLowerCase().replace(/^@/, "").trim();
  if (!cleanAgent) return [];

  return all.filter((t) => {
    const tAgentId = (t.agentId || "").toLowerCase().trim();
    const tUsername = (t.username || "").toLowerCase().replace(/^@/, "").trim();
    const tRoomId = (t.roomId || "").toLowerCase().trim();

    return (
      (tAgentId !== "" && tAgentId === cleanAgent) ||
      (tUsername !== "" && tUsername === cleanAgent) ||
      (tRoomId !== "" && tRoomId === cleanAgent)
    );
  });
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
 * Clears tickets for a specific agent or all tickets.
 */
export function clearTickets(agentId?: string): void {
  if (!agentId || agentId === "all") {
    cachedTickets = [];
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
      notifySync("TICKETS_UPDATED", []);
    }
    return;
  }
  const all = getTickets("all");
  const cleanAgent = agentId.toLowerCase().replace(/^@/, "").trim();
  const remaining = all.filter((t) => {
    const tAgentId = (t.agentId || "").toLowerCase().trim();
    const tUsername = (t.username || "").toLowerCase().replace(/^@/, "").trim();
    const tRoomId = (t.roomId || "").toLowerCase().trim();

    return tAgentId !== cleanAgent && tUsername !== cleanAgent && tRoomId !== cleanAgent;
  });
  saveTickets(remaining);
}

/**
 * Creates and prints a new thermal bet slip (Parchi).
 */
export function createTicket(data: {
  roundId: string;
  roundNumber: number;
  customerName?: string | undefined;
  agentName?: string | undefined;
  agentId?: string | undefined;
  username?: string | undefined;
  roomId?: string | undefined;
  items: BetItem[];
}): ThermalTicket {
  const now = Date.now();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const cleanRound = data.roundId.replace("#", "").padStart(4, "0");
  const ticketId = `TKT-${cleanRound}-${randomSuffix}`;
  const barcode = `${cleanRound}${randomSuffix}`;

  const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);

  const cleanAgentId = (
    data.agentId ||
    (data.agentName ? data.agentName.toLowerCase().replace(/\s+/g, "_") : "kiosk")
  ).trim();
  const cleanUsername = (
    data.username ||
    (data.agentName ? data.agentName.toLowerCase().replace(/\s+/g, "_") : "kiosk")
  )
    .toLowerCase()
    .replace(/^@/, "")
    .trim();
  const cleanRoomId = (data.roomId || data.agentId || data.username || "sorat_main")
    .toLowerCase()
    .replace(/^@/, "")
    .trim();

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
    agentId: cleanAgentId,
    username: cleanUsername,
    roomId: cleanRoomId,
    items: data.items,
    totalAmount,
    status: "ACTIVE",
  };

  const tickets = getTickets("all");
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
  winningCardName: string,
  roomId?: string
): void {
  const tickets = getTickets("all");
  let changed = false;
  const cleanRoom = roomId ? roomId.toLowerCase().replace(/^@/, "").trim() : "";

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (!t) continue;
    const isMatchingRound = t.roundId === roundId;
    const isMatchingRoom =
      !cleanRoom ||
      (t.roomId && t.roomId.toLowerCase() === cleanRoom) ||
      (t.agentId && t.agentId.toLowerCase() === cleanRoom) ||
      (t.username && t.username.toLowerCase() === cleanRoom);

    if (isMatchingRound && isMatchingRoom && t.status === "ACTIVE") {
      changed = true;
      const winningItem = t.items.find((item) => item.cardIndex === winningCardIndex);
      const isWin = Boolean(winningItem && winningItem.amount > 0);
      const winningPayout = isWin ? winningItem!.amount * PAYOUT_MULTIPLIER : 0;

      const updatedTicket: ThermalTicket = {
        ...t,
        status: isWin ? "WON" : "LOST",
        winningCardIndex,
        winningCardName,
        winningPayout,
      };
      tickets[i] = updatedTicket;
    }
  }

  if (changed) {
    saveTickets(tickets);
  }
}

/**
 * Finds a ticket across all counters by Ticket ID, Barcode, or trailing digits.
 */
export function findTicketByIdOrBarcode(query: string): ThermalTicket | null {
  if (!query) return null;
  const clean = query.trim().toLowerCase().replace(/^#/, "");
  if (!clean) return null;

  const tickets = getTickets("all");

  // 1. Exact match by ticketId or barcode
  const exact = tickets.find(
    (t) =>
      t.ticketId.toLowerCase() === clean ||
      t.barcode.toLowerCase() === clean
  );
  if (exact) return exact;

  // 2. Trailing numeric match (e.g. customer entered last 4 or 6 digits like "9281" or "08459281")
  const digitsOnly = clean.replace(/\D/g, "");
  if (digitsOnly.length >= 4) {
    const byDigits = tickets.find(
      (t) =>
        t.barcode === digitsOnly ||
        t.barcode.endsWith(digitsOnly) ||
        t.ticketId.replace(/\D/g, "").endsWith(digitsOnly)
    );
    if (byDigits) return byDigits;
  }

  // 3. Substring match
  const partial = tickets.find(
    (t) =>
      t.ticketId.toLowerCase().includes(clean) ||
      t.barcode.toLowerCase().includes(clean)
  );
  return partial || null;
}

/**
 * Mark a winning ticket as CLAIMED (Cash paid to customer).
 * Anti-Fraud Protected: Records claimedAt timestamp and claimedBy agent name.
 */
export function claimTicket(ticketId: string, claimedBy?: string): ThermalTicket | null {
  const tickets = getTickets("all");
  const clean = ticketId.trim().toLowerCase();
  const idx = tickets.findIndex(
    (t) =>
      t.ticketId.toLowerCase() === clean ||
      t.barcode.toLowerCase() === clean ||
      t.ticketId.toLowerCase().endsWith(clean)
  );
  if (idx === -1) return null;

  const existing = tickets[idx];
  if (!existing) return null;

  const target: ThermalTicket = { ...existing };
  if (target.status !== "WON") return target;

  target.status = "CLAIMED";
  target.claimedAt = Date.now();
  target.claimedBy = claimedBy || "Counter Agent";
  tickets[idx] = target;
  saveTickets(tickets);

  // Sync claimed status to Supabase `sorat_bets`
  try {
    claimTicketInSupabase(target.ticketId, target.claimedBy).catch(() => {});
  } catch {}

  return target;
}

