import { getSupabaseClient, placeSoratBetsRpc, depositToPlayerRpc, toggleCounterKillSwitchRpc } from "./supabase";
import { RAMU_SIMULATED_BETS } from "./ramuSimulationData";
import { getDeterministicRoundWinner, PAYOUT_MULTIPLIER } from "./realtime";
import { CARDS, getRecordedRoundWinner } from "./cards";

export interface UserDeposit {
  id: string;
  amount: number;
  timestamp: number;
  dateStr: string; // "YYYY-MM-DD"
  timeStr: string; // "hh:mm A"
  note?: string;
  balanceAfter: number;
}

export interface UserBetRecord {
  id: string;
  roundId: string;
  roundNumber: number;
  timestamp: number;
  dateStr: string; // "YYYY-MM-DD"
  timeStr: string; // "hh:mm A"
  cardIndex: number;
  cardName: string;
  stake: number;
  winningCardIndex?: number;
  winningCardName?: string;
  payout: number;
  isWin: boolean;
  status: "PENDING" | "SETTLED";
}

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  phone: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  deposits: UserDeposit[];
  bets: UserBetRecord[];
  createdAt: number;
  status: "ACTIVE" | "INACTIVE" | "PAUSED";
  notes?: string;
  pin?: string; // 4-digit PIN for Agent app login (default: "1234")
  agentCode?: string; // e.g. "AGENT-101"
  balanceUpdatedAt?: number; // timestamp to prevent stale balance overwrites
}

export interface UserProfitStats {
  totalDeposited: number;
  currentBalance: number;
  totalBetsPlaced: number;
  totalBetAmount: number;
  totalWonAmount: number;
  netBetProfit: number; // totalWonAmount - totalBetAmount (positive = player profit, negative = player loss)
  netAccountProfit: number; // currentBalance - totalDeposited
  winCount: number;
  lossCount: number;
  winRate: number; // percentage
  // Today's Stats
  todayBetsCount: number;
  todayBetAmount: number;
  todayWonAmount: number;
  todayNetProfit: number;
  // Yesterday's Stats
  yesterdayBetsCount: number;
  yesterdayBetAmount: number;
  yesterdayWonAmount: number;
  yesterdayNetProfit: number;
}

export const CARD_NAMES = [
  "पतंग",
  "छत्री",
  "बॉल",
  "सूर्य",
  "गुलाब",
  "दिवा",
  "फुलपाखरू",
  "चिमणी",
  "ससा",
  "भोवरा",
  "बादली",
  "गाय",
];

export function getTodayDateStr(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

export function formatDate(date: number | Date = new Date()): string {
  const d = typeof date === "number" ? new Date(date) : date;
  return getTodayDateStr(d);
}

export function getYesterdayDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getTodayDateStr(d);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const STORAGE_KEY = "sorat_users_v2";
const ACTIVE_USER_KEY = "sorat_active_user_id_v2";
const SYNC_CHANNEL_NAME = "sorat_user_sync_channel";

export function isRamuUser(u: any): boolean {
  if (!u) return false;
  const cleanUser = (u.username || "").toLowerCase().replace(/^@/, "").trim();
  const cleanName = (u.displayName || "").toLowerCase().trim();
  const cleanPhone = (u.phone || "").replace(/[^0-9]/g, "");
  const id = (u.id || "").toLowerCase();
  return (
    cleanUser === "ram" ||
    cleanName.includes("ramu") ||
    id === "usr_ramu_00" ||
    id.includes("3ys1") ||
    cleanPhone.endsWith("9284893346")
  );
}

export function getRamuSimulatedBets(): UserBetRecord[] {
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();
  return RAMU_SIMULATED_BETS.map((b, idx) => ({
    ...b,
    dateStr: idx < 12 ? yesterdayStr : todayStr,
  }));
}

function createInitialSeedUsers(): UserAccount[] {
  const now = Date.now();
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();

  // Helper timestamps
  const yesterdayNoon = now - 24 * 3600 * 1000;
  const yesterdayEvening = now - 20 * 3600 * 1000;
  const todayMorning = now - 3 * 3600 * 1000;
  const todayRecent = now - 25 * 60 * 1000;

  return [
    {
      id: "usr_ramu_00",
      username: "@ram",
      displayName: "Ramu",
      phone: "9284893346",
      pin: "1212",
      agentCode: "@ram",
      balance: 0,
      totalDeposited: 5000,
      totalWithdrawn: 0,
      createdAt: now - 3600 * 1000,
      status: "ACTIVE",
      notes: "Main TV Counter Agent (₹5,000 Exhausted Simulation)",
      deposits: [
        {
          id: "dep_ram_01",
          amount: 5000,
          timestamp: now - 3600 * 1000,
          dateStr: todayStr,
          timeStr: "09:00 AM",
          note: "Counter Cash Initial Recharge",
          balanceAfter: 5000,
        },
      ],
      bets: getRamuSimulatedBets(),
      balanceUpdatedAt: now,
    },
    {
      id: "usr_rahul_01",
      username: "agent1",
      displayName: "Rahul Sharma (Agent 1)",
      phone: "+91 98765 43210",
      pin: "1234",
      agentCode: "AGENT-101",
      balance: 1450,
      totalDeposited: 3000,
      totalWithdrawn: 0,
      createdAt: now - 7 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "Main counter agent",
      deposits: [
        {
          id: "dep_001",
          amount: 2000,
          timestamp: yesterdayNoon - 3600 * 1000,
          dateStr: yesterdayStr,
          timeStr: "11:30 AM",
          note: "Counter Cash Deposit",
          balanceAfter: 2000,
        },
        {
          id: "dep_002",
          amount: 1000,
          timestamp: todayMorning - 3600 * 1000,
          dateStr: todayStr,
          timeStr: "09:15 AM",
          note: "UPI Topup",
          balanceAfter: 1950,
        },
      ],
      bets: [
        // Yesterday's bets
        {
          id: "bet_y1",
          roundId: "#0840",
          roundNumber: 840,
          timestamp: yesterdayNoon,
          dateStr: yesterdayStr,
          timeStr: "02:00 PM",
          cardIndex: 0,
          cardName: CARD_NAMES[0],
          stake: 50,
          winningCardIndex: 0,
          winningCardName: CARD_NAMES[0],
          payout: 450,
          isWin: true,
          status: "SETTLED",
        },
        {
          id: "bet_y2",
          roundId: "#0842",
          roundNumber: 842,
          timestamp: yesterdayNoon + 120 * 1000,
          dateStr: yesterdayStr,
          timeStr: "02:02 PM",
          cardIndex: 3,
          cardName: CARD_NAMES[3],
          stake: 100,
          winningCardIndex: 5,
          winningCardName: CARD_NAMES[5],
          payout: 0,
          isWin: false,
          status: "SETTLED",
        },
        {
          id: "bet_y3",
          roundId: "#1020",
          roundNumber: 1020,
          timestamp: yesterdayEvening,
          dateStr: yesterdayStr,
          timeStr: "05:00 PM",
          cardIndex: 11,
          cardName: CARD_NAMES[11],
          stake: 50,
          winningCardIndex: 11,
          winningCardName: CARD_NAMES[11],
          payout: 450,
          isWin: true,
          status: "SETTLED",
        },
        // Today's bets
        {
          id: "bet_t1",
          roundId: "#0615",
          roundNumber: 615,
          timestamp: todayMorning,
          dateStr: todayStr,
          timeStr: "10:15 AM",
          cardIndex: 4,
          cardName: CARD_NAMES[4],
          stake: 100,
          winningCardIndex: 4,
          winningCardName: CARD_NAMES[4],
          payout: 900,
          isWin: true,
          status: "SETTLED",
        },
        {
          id: "bet_t2",
          roundId: "#0618",
          roundNumber: 618,
          timestamp: todayMorning + 180 * 1000,
          dateStr: todayStr,
          timeStr: "10:18 AM",
          cardIndex: 8,
          cardName: CARD_NAMES[8],
          stake: 50,
          winningCardIndex: 2,
          winningCardName: CARD_NAMES[2],
          payout: 0,
          isWin: false,
          status: "SETTLED",
        },
        {
          id: "bet_t3",
          roundId: "#0745",
          roundNumber: 745,
          timestamp: todayRecent,
          dateStr: todayStr,
          timeStr: "12:25 PM",
          cardIndex: 6,
          cardName: CARD_NAMES[6],
          stake: 50,
          winningCardIndex: 1,
          winningCardName: CARD_NAMES[1],
          payout: 0,
          isWin: false,
          status: "SETTLED",
        },
      ],
    },
    {
      id: "usr_amit_02",
      username: "agent2",
      displayName: "Amit Patel (Agent 2)",
      phone: "+91 98234 56789",
      pin: "1234",
      agentCode: "AGENT-102",
      balance: 800,
      totalDeposited: 2000,
      totalWithdrawn: 500,
      createdAt: now - 14 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "Branch counter agent",
      deposits: [
        {
          id: "dep_003",
          amount: 2000,
          timestamp: yesterdayNoon - 2 * 3600 * 1000,
          dateStr: yesterdayStr,
          timeStr: "10:00 AM",
          note: "Counter Cash Deposit",
          balanceAfter: 2000,
        },
      ],
      bets: [
        {
          id: "bet_amit_y1",
          roundId: "#0910",
          roundNumber: 910,
          timestamp: yesterdayNoon + 3600 * 1000,
          dateStr: yesterdayStr,
          timeStr: "03:10 PM",
          cardIndex: 2,
          cardName: CARD_NAMES[2],
          stake: 100,
          winningCardIndex: 7,
          winningCardName: CARD_NAMES[7],
          payout: 0,
          isWin: false,
          status: "SETTLED",
        },
        {
          id: "bet_amit_t1",
          roundId: "#0650",
          roundNumber: 650,
          timestamp: todayMorning + 3600 * 1000,
          dateStr: todayStr,
          timeStr: "11:00 AM",
          cardIndex: 1,
          cardName: CARD_NAMES[1],
          stake: 50,
          winningCardIndex: 1,
          winningCardName: CARD_NAMES[1],
          payout: 450,
          isWin: true,
          status: "SETTLED",
        },
      ],
    },
    {
      id: "usr_suresh_03",
      username: "agent3",
      displayName: "Suresh Patil (Agent 3)",
      phone: "+91 99887 76655",
      pin: "1234",
      agentCode: "AGENT-103",
      balance: 5200,
      totalDeposited: 5000,
      totalWithdrawn: 0,
      createdAt: now - 3 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "Market counter agent",
      deposits: [
        {
          id: "dep_004",
          amount: 5000,
          timestamp: yesterdayEvening,
          dateStr: yesterdayStr,
          timeStr: "06:30 PM",
          note: "Admin Bank Transfer",
          balanceAfter: 5000,
        },
      ],
      bets: [
        {
          id: "bet_sp_y1",
          roundId: "#1140",
          roundNumber: 1140,
          timestamp: yesterdayEvening + 1800 * 1000,
          dateStr: yesterdayStr,
          timeStr: "07:00 PM",
          cardIndex: 5,
          cardName: CARD_NAMES[5],
          stake: 200,
          winningCardIndex: 5,
          winningCardName: CARD_NAMES[5],
          payout: 1800,
          isWin: true,
          status: "SETTLED",
        },
      ],
    },
    {
      id: "usr_kk_05",
      username: "kk",
      displayName: "kk",
      phone: "9284893349",
      pin: "1111",
      agentCode: "AGENT-105",
      balance: 2000,
      totalDeposited: 2000,
      totalWithdrawn: 0,
      createdAt: now - 1800 * 1000,
      status: "ACTIVE",
      notes: "Counter Agent kk",
      deposits: [
        {
          id: "dep_kk_01",
          amount: 2000,
          timestamp: now - 1800 * 1000,
          dateStr: todayStr,
          timeStr: "01:39 PM",
          note: "Initial Account Deposit",
          balanceAfter: 2000,
        },
      ],
      bets: [],
      balanceUpdatedAt: now,
    },
  ];
}

// In-memory cache
let cachedUsers: UserAccount[] | null = null;
let syncBroadcastChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  if (!syncBroadcastChannel) {
    try {
      syncBroadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    } catch {}
  }
  return syncBroadcastChannel;
}

function notifySync(type: string, data?: any) {
  try {
    getChannel()?.postMessage({ type, data, ts: Date.now() });
  } catch {}
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("sorat_users_last_sync", String(Date.now()));
    } catch {}
  }
}

export function getUsers(): UserAccount[] {
  if (typeof window === "undefined") {
    return createInitialSeedUsers();
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const enriched = parsed.map((u, i) => ({
          ...u,
          pin: u.pin || "1234",
          agentCode: u.agentCode || `AGENT-${101 + i}`,
        }));

        // Robust auto-upgrade: Find ANY Ramu account in localStorage and ensure full 5000 exhaustion simulation & bets are populated
        const ramuIndices: number[] = [];
        enriched.forEach((u, idx) => {
          if (isRamuUser(u)) ramuIndices.push(idx);
        });

        const freshBets = getRamuSimulatedBets();
        const freshSeed = createInitialSeedUsers();
        const freshRamu = freshSeed.find((u) => u.id === "usr_ramu_00")!;

        if (ramuIndices.length === 0) {
          enriched.unshift(freshRamu);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched));
          } catch {}
        } else {
          let updated = false;
          for (const idx of ramuIndices) {
            const r = enriched[idx];
            if (!r.bets || r.bets.length === 0 || r.totalDeposited < 5000 || r.balance > 0) {
              enriched[idx] = {
                ...r,
                displayName: r.displayName || "Ramu",
                username: r.username || "@ram",
                phone: r.phone || "9284893346",
                pin: r.pin || "1212",
                agentCode: r.agentCode || "@ram",
                balance: 0,
                totalDeposited: 5000,
                totalWithdrawn: 0,
                deposits: freshRamu.deposits,
                bets: freshBets,
                balanceUpdatedAt: Date.now(),
              };
              updated = true;
            }
          }
          if (updated) {
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched));
            } catch {}
          }
        }

        cachedUsers = enriched;
        return enriched;
      }
    }
  } catch (e) {
    console.error("Failed to load users from localStorage", e);
  }

  if (cachedUsers) return cachedUsers;

  const seed = createInitialSeedUsers();
  saveUsers(seed);
  return seed;
}

export const CLOUD_ACCOUNTS_SYNC_TOPIC = "sorat_accounts_sync_v2_99";

/**
 * Merges a list of remote accounts into local store, preserving local bets & deposit history.
 */
export function mergeRemoteUsers(remoteUsers: any[]): UserAccount[] {
  if (!Array.isArray(remoteUsers) || remoteUsers.length === 0) {
    return getUsers();
  }

  const current = getUsers();
  const mergedMap = new Map<string, UserAccount>();
  current.forEach((u) => mergedMap.set(u.id, u));

  remoteUsers.forEach((remoteU: any) => {
    if (!remoteU || !remoteU.id) return;
    const remotePhoneDigits = (remoteU.phone || "").replace(/\D/g, "");
    const remoteUserClean = (remoteU.username || "").toLowerCase().replace(/^@/, "");

    const existing =
      mergedMap.get(remoteU.id) ||
      current.find((c) => {
        const cPhone = (c.phone || "").replace(/\D/g, "");
        const cUser = (c.username || "").toLowerCase().replace(/^@/, "");
        return (
          (remoteUserClean && cUser === remoteUserClean) ||
          (remotePhoneDigits.length >= 6 && cPhone.includes(remotePhoneDigits))
        );
      });

    if (existing) {
      const localUpdatedAt = existing.balanceUpdatedAt || 0;
      const remoteUpdatedAt = remoteU.balanceUpdatedAt || 0;
      const effBalance = remoteUpdatedAt >= localUpdatedAt ? remoteU.balance : existing.balance;
      const effUpdatedAt = Math.max(localUpdatedAt, remoteUpdatedAt);

      const isRamu = isRamuUser(existing) || isRamuUser(remoteU);
      const ramuBets = isRamu ? getRamuSimulatedBets() : [];
      const finalBets =
        remoteU.bets && remoteU.bets.length > 0
          ? remoteU.bets
          : existing.bets && existing.bets.length > 0
          ? existing.bets
          : ramuBets;

      const todayStr = getTodayDateStr();
      const ramuDeposits = [
        {
          id: "dep_ram_01",
          amount: 5000,
          timestamp: Date.now() - 3600 * 1000,
          dateStr: todayStr,
          timeStr: "09:00 AM",
          note: "Counter Cash Initial Recharge",
          balanceAfter: 5000,
        },
      ];

      const finalDeposits =
        remoteU.deposits && remoteU.deposits.length > 0
          ? remoteU.deposits
          : existing.deposits && existing.deposits.length > 0
          ? existing.deposits
          : isRamu
          ? ramuDeposits
          : [];

      mergedMap.set(existing.id, {
        ...remoteU,
        ...existing,
        id: existing.id,
        pin: remoteU.pin || existing.pin || "1234",
        phone: remoteU.phone || existing.phone || "",
        balance: isRamu ? 0 : effBalance,
        balanceUpdatedAt: effUpdatedAt,
        totalDeposited: isRamu ? 5000 : (remoteU.totalDeposited ?? existing.totalDeposited ?? 0),
        bets: finalBets,
        deposits: finalDeposits,
      });
    } else {
      const isRamu = isRamuUser(remoteU);
      const todayStr = getTodayDateStr();
      mergedMap.set(remoteU.id, {
        id: remoteU.id,
        username: remoteU.username || `user_${Date.now()}`,
        displayName: remoteU.displayName || remoteU.username || "Agent",
        phone: remoteU.phone || "",
        pin: remoteU.pin || "1234",
        agentCode: remoteU.agentCode || `AGENT-${100 + mergedMap.size}`,
        createdAt: remoteU.createdAt || Date.now(),
        totalWithdrawn: remoteU.totalWithdrawn || 0,
        totalDeposited: isRamu ? 5000 : (remoteU.totalDeposited || 0),
        balance: isRamu ? 0 : (remoteU.balance || 0),
        status: remoteU.status || "ACTIVE",
        notes: remoteU.notes || "",
        deposits: isRamu
          ? [
              {
                id: "dep_ram_01",
                amount: 5000,
                timestamp: Date.now() - 3600 * 1000,
                dateStr: todayStr,
                timeStr: "09:00 AM",
                note: "Counter Cash Initial Recharge",
                balanceAfter: 5000,
              },
            ]
          : remoteU.deposits || [],
        bets: isRamu ? getRamuSimulatedBets() : remoteU.bets || [],
        balanceUpdatedAt: remoteU.balanceUpdatedAt || Date.now(),
      });
    }
  });

  const mergedUsers = Array.from(mergedMap.values());
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedUsers));
    } catch {}
  }
  cachedUsers = mergedUsers;
  notifySync("USERS_UPDATED", mergedUsers);
  return mergedUsers;
}

/**
 * Broadcasts lightweight accounts snapshot to the cloud topic so phones & APKs receive them instantly.
 * Strips heavy bets & deposit arrays to stay well below 4KB and avoid ntfy file-attachment conversion.
 */
export function broadcastUsersToCloud(users: UserAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload = users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      phone: u.phone || "",
      pin: u.pin || "1234",
      agentCode: u.agentCode || "",
      balance: u.balance,
      balanceUpdatedAt: u.balanceUpdatedAt || Date.now(),
      totalDeposited: u.totalDeposited || 0,
      totalWithdrawn: u.totalWithdrawn || 0,
      status: u.status,
      notes: u.notes || "",
    }));

    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "ACCOUNTS_SYNC" },
      body: JSON.stringify({ type: "ACCOUNTS_SYNC", users: payload, ts: Date.now() }),
    }).catch(() => {});
  } catch (e) {
    console.error("Cloud users broadcast error:", e);
  }
}

/**
 * Broadcasts instant single user creation event for sub-second cross-device registration.
 */
export function broadcastSingleUserCreated(u: UserAccount): void {
  if (typeof window === "undefined") return;
  try {
    const minUser = {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      phone: u.phone || "",
      pin: u.pin || "1234",
      agentCode: u.agentCode || "",
      balance: u.balance,
      balanceUpdatedAt: u.balanceUpdatedAt || Date.now(),
      totalDeposited: u.totalDeposited || 0,
      totalWithdrawn: u.totalWithdrawn || 0,
      status: u.status,
      notes: u.notes || "",
    };
    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "USER_CREATED" },
      body: JSON.stringify({ type: "USER_CREATED", user: minUser, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}

export function broadcastPinChange(userId: string, pin: string): void {
  if (typeof window === "undefined") return;
  try {
    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "PIN_CHANGED" },
      body: JSON.stringify({ type: "PIN_CHANGED", userId, pin, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}

export function broadcastUserDelete(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "USER_DELETED" },
      body: JSON.stringify({ type: "USER_DELETED", userId, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}

/**
 * Broadcasts dedicated atomic balance deduction & live bet event to the cloud channel so Admin & other devices reflect it immediately.
 */
export function broadcastBalanceDeductionToCloud(
  agentId: string,
  username: string,
  agentName: string,
  totalDeducted: number,
  newBalance: number,
  roundId: string,
  balanceUpdatedAt: number,
  roundNumber?: number,
  items?: { cardIndex: number; cardName: string; amount: number }[],
  betRecords?: UserBetRecord[]
): void {
  if (typeof window === "undefined") return;
  try {
    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "BALANCE_DEDUCT" },
      body: JSON.stringify({
        type: "AGENT_BALANCE_DEDUCT",
        agentId,
        username,
        agentName,
        totalDeducted,
        newBalance,
        balanceUpdatedAt,
        roundId,
        roundNumber,
        items,
        betRecords,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) {
    console.error("Cloud deduct broadcast error:", e);
  }
}

/**
 * Broadcasts deposit event to the cloud topic so phone terminals update their wallet immediately.
 */
export function broadcastUserDeposit(
  userId: string,
  username: string,
  amount: number,
  newBalance: number,
  totalDeposited: number,
  depositRecord: UserDeposit
): void {
  if (typeof window === "undefined") return;
  try {
    fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
      method: "POST",
      headers: { Title: "USER_DEPOSIT" },
      body: JSON.stringify({
        type: "USER_DEPOSIT",
        userId,
        username,
        amount,
        newBalance,
        totalDeposited,
        depositRecord,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch {}
}

/**
 * Pulls latest accounts snapshot from cloud topic and updates local store.
 * Handles both plain JSON messages AND ntfy file-attachment downloads seamlessly.
 */
export async function pullUsersFromCloud(): Promise<UserAccount[]> {
  if (typeof window === "undefined") return getUsers();

  // 1. Direct Supabase Query (Primary Cloud Source of Truth - DigitJodi Pattern)
  try {
    const client = getSupabaseClient();
    if (client) {
      const { data: dbPlayers, error } = await client.from("players").select("*");
      if (!error && Array.isArray(dbPlayers) && dbPlayers.length > 0) {
        // Fetch recent bets from Supabase to keep bets history and House Gross Profit 100% in sync
        let dbBets: any[] = [];
        try {
          const { data: bData } = await client
            .from("sorat_bets")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(1000);
          if (Array.isArray(bData)) {
            dbBets = bData;
          }
        } catch {}

        const local = getUsers();
        const merged = local.map((u) => {
          const remote = dbPlayers.find(
            (p) =>
              p.id === u.id ||
              (p.username && p.username.toLowerCase() === u.username.toLowerCase()) ||
              (p.phone && u.phone && p.phone.replace(/\D/g, "") === u.phone.replace(/\D/g, ""))
          );
          if (remote) {
            const uBetsFromDb = dbBets
              .filter((b) => {
                const bUser = (b.user_id || "").toLowerCase().replace(/^@/, "").trim();
                const uId = (u.id || "").toLowerCase().trim();
                const uName = (u.username || "").toLowerCase().replace(/^@/, "").trim();
                const rId = (remote.id || "").toLowerCase().trim();
                const rName = (remote.username || "").toLowerCase().replace(/^@/, "").trim();
                return bUser === uId || bUser === uName || bUser === rId || bUser === rName;
              })
              .map((b) => ({
                id: b.id,
                ticketId: b.ticket_id,
                roundId: b.round_id,
                roundNumber: b.round_number,
                timestamp: new Date(b.created_at).getTime(),
                dateStr: b.date_str,
                timeStr: b.time_str,
                cardIndex: b.card_index,
                cardName: b.card_name,
                stake: Number(b.amount || 0),
                winningCardIndex: b.winning_card_index ?? undefined,
                winningCardName: b.winning_card_name ?? undefined,
                payout: (b.status === "won" || b.status === "claimed" || Boolean(b.is_win))
                  ? Math.min(Number(b.payout || 0) > 0 ? Number(b.payout) : Number(b.amount || 0) * PAYOUT_MULTIPLIER, Number(b.amount || 0) * PAYOUT_MULTIPLIER)
                  : 0,
                isWin: b.status === "won" || b.status === "claimed" || Boolean(b.is_win),
                status: (b.status === "won" || b.status === "claimed" || b.status === "lost") ? "SETTLED" as const : "PENDING" as const,
              }));

            const finalBets = uBetsFromDb.length > 0 ? uBetsFromDb : u.bets;

            return {
              ...u,
              id: remote.id || u.id,
              balance: Number(remote.balance ?? u.balance),
              totalDeposited: Number(remote.total_deposited ?? u.totalDeposited),
              pin: remote.pin || u.pin,
              phone: remote.phone || u.phone,
              displayName: remote.display_name || u.displayName,
              status: (remote.status as any) || u.status,
              bets: finalBets,
            };
          }
          return u;
        });

        // Add any players in Supabase that aren't yet in local store
        for (const p of dbPlayers) {
          const exists = merged.some(
            (u) =>
              u.id === p.id ||
              (p.username && u.username.toLowerCase() === p.username.toLowerCase()) ||
              (p.phone && u.phone && p.phone.replace(/\D/g, "") === u.phone.replace(/\D/g, ""))
          );
          if (!exists) {
            const pBetsFromDb = dbBets
              .filter((b) => {
                const bUser = (b.user_id || "").toLowerCase().replace(/^@/, "").trim();
                const pId = (p.id || "").toLowerCase().trim();
                const pName = (p.username || "").toLowerCase().replace(/^@/, "").trim();
                return bUser === pId || bUser === pName;
              })
              .map((b) => ({
                id: b.id,
                ticketId: b.ticket_id,
                roundId: b.round_id,
                roundNumber: b.round_number,
                timestamp: new Date(b.created_at).getTime(),
                dateStr: b.date_str,
                timeStr: b.time_str,
                cardIndex: b.card_index,
                cardName: b.card_name,
                stake: Number(b.amount || 0),
                winningCardIndex: b.winning_card_index ?? undefined,
                winningCardName: b.winning_card_name ?? undefined,
                payout: (b.status === "won" || b.status === "claimed" || Boolean(b.is_win))
                  ? Math.min(Number(b.payout || 0) > 0 ? Number(b.payout) : Number(b.amount || 0) * PAYOUT_MULTIPLIER, Number(b.amount || 0) * PAYOUT_MULTIPLIER)
                  : 0,
                isWin: b.status === "won" || b.status === "claimed" || Boolean(b.is_win),
                status: (b.status === "won" || b.status === "claimed" || b.status === "lost") ? "SETTLED" as const : "PENDING" as const,
              }));

            merged.push({
              id: p.id,
              username: p.username || p.display_name || "user",
              displayName: p.display_name || p.username || "User",
              phone: p.phone || "",
              balance: Number(p.balance || 0),
              totalDeposited: Number(p.total_deposited || 0),
              totalWithdrawn: Number(p.total_withdrawn || 0),
              deposits: [],
              bets: pBetsFromDb,
              createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
              status: (p.status as any) || "ACTIVE",
              pin: p.pin || "1234",
            });
          }
        }

        saveUsers(merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn("Supabase pull error, falling back to ntfy:", err);
  }

  // 2. ntfy.sh fallback (if offline or Supabase connection unreachable)
  try {
    const res = await fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}/json?poll=1&since=all`);
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const item = JSON.parse(lines[i]);
          if (item.event === "message") {
            let rawContent = item.message;
            if (item.attachment && item.attachment.url) {
              try {
                const attRes = await fetch(item.attachment.url);
                if (attRes.ok) rawContent = await attRes.text();
              } catch {}
            }
            if (rawContent && rawContent.startsWith("{")) {
              const parsed = JSON.parse(rawContent);
              if (parsed.type === "ACCOUNTS_SYNC" && Array.isArray(parsed.users) && parsed.users.length > 0) {
                return mergeRemoteUsers(parsed.users);
              }
              if (parsed.type === "USER_CREATED" && parsed.user) {
                return mergeRemoteUsers([parsed.user]);
              }
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error("Failed to pull users from cloud:", e);
  }
  return getUsers();
}

/**
 * Subscribes to real-time cloud account changes via Server-Sent Events (SSE).
 * Handles ACCOUNTS_SYNC, USER_CREATED, PIN_CHANGED, USER_DELETED, AGENT_BALANCE_DEDUCT, and USER_DEPOSIT.
 */
export function subscribeToCloudUsers(
  onUpdate?: (users: UserAccount[]) => void,
  onDeduct?: (event: {
    agentId: string;
    username: string;
    agentName: string;
    totalDeducted: number;
    newBalance: number;
    roundId: string;
    roundNumber?: number;
    items?: { cardIndex: number; cardName: string; amount: number }[];
    betRecords?: UserBetRecord[];
    timestamp: number;
  }) => void
): () => void {
  if (typeof window === "undefined" || !("EventSource" in window)) {
    return () => {};
  }
  try {
    const sse = new EventSource(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}/sse`);
    sse.onmessage = async (event) => {
      try {
        const item = JSON.parse(event.data);
        if (item.event === "message") {
          let rawContent = item.message;
          if (item.attachment && item.attachment.url) {
            try {
              const attRes = await fetch(item.attachment.url);
              if (attRes.ok) rawContent = await attRes.text();
            } catch {}
          }
          if (!rawContent || !rawContent.startsWith("{")) return;
          const parsed = JSON.parse(rawContent);

          // 1. Direct Balance Deduction & Real-time Bet Placed Event (e.g. phone placed bet)
          if (parsed.type === "AGENT_BALANCE_DEDUCT") {
            const current = getUsers();
            const rawId = (parsed.username || parsed.agentId || "").toLowerCase();
            const cleanId = rawId.replace(/^@/, "");
            const cleanPhone = cleanId.replace(/\D/g, "");

            const target = current.find(
              (u) =>
                u.id.toLowerCase() === rawId ||
                u.id.toLowerCase() === cleanId ||
                u.username.toLowerCase().replace(/^@/, "") === cleanId ||
                (cleanPhone.length >= 6 && (u.phone || "").replace(/\D/g, "").includes(cleanPhone)) ||
                (isRamuUser(u) && (cleanId === "ram" || cleanId.includes("ramu")))
            );

            if (target) {
              const deductTime = parsed.balanceUpdatedAt || parsed.timestamp || Date.now();
              target.balance = parsed.newBalance;
              target.balanceUpdatedAt = deductTime;

              // Append new bet records if provided!
              if (Array.isArray(parsed.betRecords) && parsed.betRecords.length > 0) {
                const existingBetIds = new Set((target.bets || []).map((b) => b.id));
                const newBets = parsed.betRecords.filter((b: any) => !existingBetIds.has(b.id));
                if (newBets.length > 0) {
                  target.bets = [...newBets, ...(target.bets || [])];
                }
              }

              localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
              cachedUsers = current;
              notifySync("USERS_UPDATED", current);
              onDeduct?.(parsed);
              onUpdate?.(current);
            }
            return;
          }

          // 2. Real-time User Deposit Event (e.g. Admin topped up user wallet)
          if (parsed.type === "USER_DEPOSIT") {
            const current = getUsers();
            const rawId = (parsed.username || parsed.userId || "").toLowerCase();
            const cleanId = rawId.replace(/^@/, "");
            const cleanPhone = cleanId.replace(/\D/g, "");

            const target = current.find(
              (u) =>
                u.id.toLowerCase() === rawId ||
                u.id.toLowerCase() === cleanId ||
                u.username.toLowerCase().replace(/^@/, "") === cleanId ||
                (cleanPhone.length >= 6 && (u.phone || "").replace(/\D/g, "").includes(cleanPhone))
            );

            if (target) {
              target.balance = parsed.newBalance;
              target.balanceUpdatedAt = parsed.timestamp || Date.now();
              target.totalDeposited = parsed.totalDeposited;
              if (parsed.depositRecord) {
                const existingDepIds = new Set((target.deposits || []).map((d) => d.id));
                if (!existingDepIds.has(parsed.depositRecord.id)) {
                  target.deposits = [parsed.depositRecord, ...(target.deposits || [])];
                }
              }
              localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
              cachedUsers = current;
              notifySync("USERS_UPDATED", current);
              onUpdate?.(current);
            }
            return;
          }

          // 3. Real-time Single User Created
          if (parsed.type === "USER_CREATED" && parsed.user) {
            const merged = mergeRemoteUsers([parsed.user]);
            onUpdate?.(merged);
            return;
          }

          // 4. PIN Changed
          if (parsed.type === "PIN_CHANGED" && parsed.userId && parsed.pin) {
            const current = getUsers();
            const target = current.find((u) => u.id === parsed.userId);
            if (target) {
              target.pin = parsed.pin;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
              cachedUsers = current;
              notifySync("USERS_UPDATED", current);
              onUpdate?.(current);
            }
            return;
          }

          // 5. User Deleted
          if (parsed.type === "USER_DELETED" && parsed.userId) {
            const current = getUsers().filter((u) => u.id !== parsed.userId);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
            cachedUsers = current;
            notifySync("USERS_UPDATED", current);
            onUpdate?.(current);
            return;
          }

          // 6. Full Snapshot Sync
          if (parsed.type === "ACCOUNTS_SYNC" && Array.isArray(parsed.users) && parsed.users.length > 0) {
            const merged = mergeRemoteUsers(parsed.users);
            onUpdate?.(merged);
          }
        }
      } catch {}
    };
    return () => sse.close();
  } catch {
    return () => {};
  }
}

export function saveUsers(users: UserAccount[]): void {
  cachedUsers = users;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
      notifySync("USERS_UPDATED", users);
      broadcastUsersToCloud(users);
    } catch (e) {
      console.error("Failed to save users", e);
    }
  }
}

export function getUser(id: string): UserAccount | undefined {
  const users = getUsers();
  return users.find((u) => u.id === id);
}

export function getActiveUserId(): string {
  if (typeof window === "undefined") return "usr_rahul_01";
  const saved = localStorage.getItem(ACTIVE_USER_KEY);
  if (saved) return saved;
  const users = getUsers();
  const firstId = users[0]?.id || "usr_rahul_01";
  localStorage.setItem(ACTIVE_USER_KEY, firstId);
  return firstId;
}

export function setActiveUserId(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(ACTIVE_USER_KEY, id);
    notifySync("ACTIVE_USER_CHANGED", id);
  }
}

export function getActiveUser(): UserAccount {
  const id = getActiveUserId();
  const u = getUser(id);
  if (u) return u;
  const all = getUsers();
  return all[0] || createInitialSeedUsers()[0];
}

const LOGGED_IN_AGENT_KEY = "sorat_logged_in_agent_id_v1";

export function getLoggedInAgent(): UserAccount | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(LOGGED_IN_AGENT_KEY);
  if (!id) return null;
  return getUser(id) || null;
}

export function setLoggedInAgent(userId: string | null): void {
  if (typeof window !== "undefined") {
    if (userId) {
      localStorage.setItem(LOGGED_IN_AGENT_KEY, userId);
      setActiveUserId(userId);
    } else {
      localStorage.removeItem(LOGGED_IN_AGENT_KEY);
    }
    notifySync("AGENT_AUTH_CHANGED", userId);
  }
}

export function authenticateAgent(
  identifier: string,
  pin: string
): { success: boolean; user?: UserAccount; error?: string } {
  const users = getUsers();
  const rawId = (identifier || "").trim().toLowerCase();
  const cleanId = rawId.replace(/^@/, "");
  const cleanPin = (pin || "").trim();

  if (!cleanId) return { success: false, error: "Kripya Agent ID ya Mobile Number daalein" };
  if (!cleanPin) return { success: false, error: "Kripya 4-digit PIN daalein" };

  const cleanPhone = cleanId.replace(/\D/g, "");

  const user = users.find((u) => {
    const uRaw = (u.username || "").toLowerCase();
    const uName = uRaw.replace(/^@/, "");
    const uCode = (u.agentCode || "").toLowerCase().replace(/^@/, "");
    const uDisplay = (u.displayName || "").toLowerCase();
    const uPhone = (u.phone || "").replace(/\D/g, "");

    const phoneMatches =
      cleanPhone.length >= 4 &&
      uPhone.length >= 4 &&
      (uPhone.includes(cleanPhone) ||
        cleanPhone.includes(uPhone) ||
        uPhone.endsWith(cleanPhone) ||
        cleanPhone.endsWith(uPhone));

    return (
      uName === cleanId ||
      uRaw === rawId ||
      uCode === cleanId ||
      uDisplay === cleanId ||
      u.id.toLowerCase() === cleanId ||
      phoneMatches
    );
  });

  if (!user) {
    return {
      success: false,
      error: `Galat Agent ID "${identifier}"! Kripya sahi ID daalein (jaise @ram, agent1 ya Mobile No.).`,
    };
  }

  const expectedPin = (user.pin || "1234").trim();
  if (expectedPin !== cleanPin) {
    return {
      success: false,
      error: `Galat PIN! "${user.displayName}" ka sahi 4-digit PIN daalein.`,
    };
  }

  setLoggedInAgent(user.id);
  return { success: true, user };
}

/**
 * Asynchronously authenticates an agent against local store and live Supabase.
 */
export async function authenticateAgentAsync(
  identifier: string,
  pin: string
): Promise<{ success: boolean; user?: UserAccount; error?: string }> {
  const localRes = authenticateAgent(identifier, pin);
  if (localRes.success) return localRes;

  const sb = getSupabaseClient();
  if (sb) {
    try {
      const raw = (identifier || "").trim().toLowerCase();
      const clean = raw.replace(/^@/, "");
      if (!clean) return { success: false, error: "Kripya Agent ID daalein" };

      const { data, error } = await sb
        .from("players")
        .select("*")
        .or(`username.eq.${clean},id.eq.${clean},display_name.ilike.%${clean}%`)
        .limit(1);

      if (!error && data && data.length > 0) {
        const p = data[0];
        const expectedPin = (p.pin || "1234").trim();
        if (expectedPin === pin.trim()) {
          const remoteUser: UserAccount = {
            id: p.id,
            displayName: p.display_name,
            username: p.username,
            phone: p.phone || "",
            pin: p.pin,
            agentCode: `AGENT-${p.id.slice(0, 6)}`,
            balance: Number(p.balance) || 0,
            totalDeposited: Number(p.total_deposited || 0),
            totalWithdrawn: Number(p.total_withdrawn || 0),
            createdAt: new Date(p.created_at).getTime(),
            status: p.status || "ACTIVE",
            notes: p.notes || "",
            deposits: [],
            bets: [],
          };
          const users = getUsers();
          const existIdx = users.findIndex((u) => u.id === p.id || u.username === p.username);
          if (existIdx >= 0) {
            users[existIdx] = remoteUser;
          } else {
            users.unshift(remoteUser);
          }
          saveUsers(users);
          setLoggedInAgent(remoteUser.id);
          return { success: true, user: remoteUser };
        } else {
          return { success: false, error: `Galat PIN! "${p.display_name}" ka sahi PIN daalein.` };
        }
      }
    } catch {}
  }

  return localRes;
}

export function updateUserPin(userId: string, newPin: string): UserAccount {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");
  const target = { ...users[idx], pin: newPin.trim() };
  users[idx] = target;
  saveUsers(users);
  broadcastPinChange(userId, newPin.trim());
  return target;
}

/**
 * Emergency Counter Kill-Switch: Toggle pause/resume betting for any specific counter.
 */
export function toggleCounterKillSwitch(userId: string, isPaused?: boolean): UserAccount {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId || u.username === userId);
  if (idx === -1) throw new Error("User account not found");

  const current = users[idx];
  const nextPaused = typeof isPaused === "boolean" ? isPaused : (current.status !== "PAUSED");
  const target: UserAccount = {
    ...current,
    status: nextPaused ? "PAUSED" : "ACTIVE",
  };
  users[idx] = target;
  saveUsers(users);
  broadcastUsersToCloud(users);

  // Sync to Supabase
  try {
    toggleCounterKillSwitchRpc(target.id, nextPaused).catch(() => {});
  } catch {}

  return target;
}

/**
 * Atomically deducts stake from an agent account and records the bets in their ledger.
 * Returns the updated balance and success status.
 */
export function deductAgentBalance(
  agentIdentifier: string,
  totalStake: number,
  roundId: string,
  roundNumber: number,
  items: { cardIndex: number; cardName: string; amount: number }[]
): { success: boolean; newBalance: number; error?: string } {
  const users = getUsers();
  const rawId = (agentIdentifier || "").trim().toLowerCase();
  const cleanId = rawId.replace(/^@/, "");
  const cleanPhone = cleanId.replace(/\D/g, "");

  const idx = users.findIndex((u) => {
    const uRaw = (u.username || "").toLowerCase();
    const uName = uRaw.replace(/^@/, "");
    const uCode = (u.agentCode || "").toLowerCase().replace(/^@/, "");
    const uDisplay = (u.displayName || "").toLowerCase();
    const uPhone = (u.phone || "").replace(/\D/g, "");
    const phoneMatches =
      cleanPhone.length >= 4 &&
      uPhone.length >= 4 &&
      (uPhone.includes(cleanPhone) || cleanPhone.includes(uPhone));

    return (
      u.id.toLowerCase() === rawId ||
      u.id.toLowerCase() === cleanId ||
      uName === cleanId ||
      uRaw === rawId ||
      uCode === cleanId ||
      uDisplay === cleanId ||
      phoneMatches ||
      (isRamuUser(u) && (cleanId === "ram" || cleanId.includes("ramu")))
    );
  });

  if (idx === -1) {
    return { success: false, newBalance: 0, error: `Agent "${agentIdentifier}" not found` };
  }

  // Emergency Counter Kill-Switch Enforcement
  if (users[idx].status === "PAUSED" || users[idx].status === "INACTIVE") {
    return {
      success: false,
      newBalance: users[idx].balance,
      error: "🛑 Counter Betting Paused by Admin! Betting is currently suspended.",
    };
  }

  if (users[idx].balance < totalStake) {
    return {
      success: false,
      newBalance: users[idx].balance,
      error: `Balance kam hai: Needed ₹${totalStake}, Available ₹${users[idx].balance}`,
    };
  }

  const now = Date.now();
  const newBalance = Math.max(0, users[idx].balance - totalStake);
  users[idx].balance = newBalance;
  users[idx].balanceUpdatedAt = now;

  const betRecords: UserBetRecord[] = items.map((it) => ({
    id: `bet_${now}_${Math.random().toString(36).slice(2, 6)}`,
    roundId,
    roundNumber,
    timestamp: now,
    dateStr: getTodayDateStr(new Date(now)),
    timeStr: formatTime(now),
    cardIndex: it.cardIndex,
    cardName: it.cardName,
    stake: it.amount,
    payout: 0,
    isWin: false,
    status: "PENDING",
  }));

  users[idx].bets = [...betRecords, ...(users[idx].bets || [])];
  saveUsers(users);

  // Broadcast dedicated atomic balance deduction event to Admin & all devices
  broadcastBalanceDeductionToCloud(
    users[idx].id,
    users[idx].username,
    users[idx].displayName,
    totalStake,
    newBalance,
    roundId,
    now,
    roundNumber,
    items,
    betRecords
  );

  // Direct Supabase Update (DigitJodi pattern)
  try {
    const client = getSupabaseClient();
    if (client) {
      // 1. Direct balance deduction in players table so cloud is immediately authoritative
      client
        .from("players")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", users[idx].id)
        .then(() => {})
        .catch(() => {});
    }
  } catch (err) {
    console.warn("Supabase balance update notice in deductAgentBalance:", err);
  }

  return { success: true, newBalance };
}

/**
 * Deposit funds into user account.
 * Updates balance, totalDeposited, and appends a deposit receipt record.
 */
export function depositToUser(
  userId: string,
  amount: number,
  note = "Admin Counter Deposit"
): UserAccount {
  if (amount <= 0) throw new Error("Deposit amount must be positive");
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");

  const target = { ...users[idx] };
  const now = Date.now();
  const newBalance = target.balance + amount;

  const depositRecord: UserDeposit = {
    id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    amount,
    timestamp: now,
    dateStr: getTodayDateStr(new Date(now)),
    timeStr: formatTime(now),
    note,
    balanceAfter: newBalance,
  };

  target.balance = newBalance;
  target.balanceUpdatedAt = now;
  target.totalDeposited = (target.totalDeposited || 0) + amount;
  target.deposits = [depositRecord, ...(target.deposits || [])];

  users[idx] = target;
  saveUsers(users);
  broadcastUserDeposit(
    target.id,
    target.username,
    amount,
    newBalance,
    target.totalDeposited,
    depositRecord
  );

  // Background sync to Supabase if configured
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from("deposits")
        .insert({
          id: depositRecord.id,
          user_id: target.id,
          amount: depositRecord.amount,
          date_str: depositRecord.dateStr,
          time_str: depositRecord.timeStr,
          note: depositRecord.note || null,
          balance_after: depositRecord.balanceAfter,
        })
        .then(() => {
          supabase
            .from("players")
            .update({
              balance: target.balance,
              total_deposited: target.totalDeposited,
              updated_at: new Date().toISOString(),
            })
            .eq("id", target.id);
        })
        .catch(() => {});
    }
  } catch {}

  return target;
}

/**
 * Withdraw / adjust funds from user account.
 */
export function withdrawFromUser(
  userId: string,
  amount: number,
  note = "Counter Payout / Withdrawal"
): UserAccount {
  if (amount <= 0) throw new Error("Withdrawal amount must be positive");
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");

  const target = { ...users[idx] };
  if (target.balance < amount) throw new Error("Insufficient user balance");

  target.balance = target.balance - amount;
  target.balanceUpdatedAt = Date.now();
  target.totalWithdrawn = (target.totalWithdrawn || 0) + amount;

  users[idx] = target;
  saveUsers(users);

  // Background sync to Supabase if configured
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from("players")
        .update({
          balance: target.balance,
          total_withdrawn: target.totalWithdrawn,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .then(() => {})
        .catch(() => {});
    }
  } catch {}

  return target;
}

/**
 * Set exact balance for a user.
 */
export function setUserBalance(userId: string, balance: number): UserAccount {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");

  const target = { ...users[idx] };
  target.balance = Math.max(0, balance);
  target.balanceUpdatedAt = Date.now();
  users[idx] = target;
  saveUsers(users);

  // Background sync to Supabase if configured
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from("players")
        .update({
          balance: target.balance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .then(() => {})
        .catch(() => {});
    }
  } catch {}

  return target;
}

/**
 * Create a new user account.
 */
export function createUser(data: {
  displayName: string;
  username: string;
  phone?: string;
  initialDeposit: number;
  notes?: string;
  pin?: string;
  agentCode?: string;
}): UserAccount {
  const users = getUsers();
  const now = Date.now();
  const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const initialDep = Math.max(0, data.initialDeposit || 0);

  const newUser: UserAccount = {
    id,
    displayName: data.displayName.trim(),
    username: data.username.trim().toLowerCase().replace(/\s+/g, "_"),
    phone: data.phone?.trim() || "",
    pin: data.pin?.trim() || "1234",
    agentCode: data.agentCode?.trim() || `AGENT-${101 + users.length}`,
    balance: initialDep,
    totalDeposited: initialDep,
    totalWithdrawn: 0,
    createdAt: now,
    status: "ACTIVE",
    notes: data.notes?.trim() || "",
    deposits: initialDep > 0
      ? [
          {
            id: `dep_init_${Date.now()}`,
            amount: initialDep,
            timestamp: now,
            dateStr: getTodayDateStr(new Date(now)),
            timeStr: formatTime(now),
            note: "Initial Account Deposit",
            balanceAfter: initialDep,
          },
        ]
      : [],
    bets: [],
  };

  users.unshift(newUser);
  saveUsers(users);
  broadcastSingleUserCreated(newUser);

  // Directly persist newly created agent/player to Supabase
  const sb = getSupabaseClient();
  if (sb) {
    sb.from("players")
      .upsert({
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.displayName,
        phone: newUser.phone,
        pin: newUser.pin,
        role: "agent",
        balance: newUser.balance,
        total_deposited: newUser.totalDeposited,
        total_withdrawn: 0,
        status: "ACTIVE",
        notes: newUser.notes,
      })
      .then(({ error }) => {
        if (error) console.warn("Supabase player upsert notice:", error.message);
        if (initialDep > 0) {
          sb.from("deposits").insert({
            user_id: newUser.id,
            amount: initialDep,
            date_str: getTodayDateStr(new Date(now)),
            time_str: formatTime(now),
            note: "Initial Account Deposit",
            balance_after: initialDep,
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }

  return newUser;
}

/**
 * Delete a user account.
 */
export function deleteUser(userId: string): void {
  const users = getUsers().filter((u) => u.id !== userId);
  saveUsers(users);
  broadcastUserDelete(userId);
}

/**
 * Records a bet placed by a user in the current round.
 * Deducts stake from user balance.
 */
export function recordUserBet(
  userId: string,
  bet: {
    roundId: string;
    roundNumber: number;
    cardIndex: number;
    cardName: string;
    stake: number;
  }
): UserBetRecord {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");

  const target = { ...users[idx] };
  if (target.balance < bet.stake) {
    throw new Error("Insufficient user balance to place bet");
  }

  const now = Date.now();
  target.balance -= bet.stake;

  const betRecord: UserBetRecord = {
    id: `bet_${now}_${Math.random().toString(36).slice(2, 6)}`,
    roundId: bet.roundId,
    roundNumber: bet.roundNumber,
    timestamp: now,
    dateStr: getTodayDateStr(new Date(now)),
    timeStr: formatTime(now),
    cardIndex: bet.cardIndex,
    cardName: bet.cardName,
    stake: bet.stake,
    payout: 0,
    isWin: false,
    status: "PENDING",
  };

  target.bets = [betRecord, ...(target.bets || [])];
  users[idx] = target;
  saveUsers(users);
  return betRecord;
}

/**
 * Settles all pending bets for a round when the winner card is declared.
 * Winning payout = 10x stake.
 * In Prepaid Burn Model, creditBalance is false by default so the agent wallet strictly
 * consumes downwards without auto-inflating, requiring top-up when empty!
 */
export function settleRoundBets(
  roundId: string,
  winningCardIndex: number,
  winningCardName: string,
  creditBalance = false
): void {
  const users = getUsers();
  let changed = false;
  const cleanTarget = (roundId || "").replace(/^#/, "").trim();

  for (let i = 0; i < users.length; i++) {
    const user = { ...users[i] };
    let userChanged = false;

    if (user.bets) {
      const updatedBets = user.bets.map((bet) => {
        const cleanBetId = (bet.roundId || "").replace(/^#/, "").trim();
        const matchesRound = cleanBetId === cleanTarget || String(bet.roundNumber) === cleanTarget;

        if (matchesRound && bet.status === "PENDING") {
          userChanged = true;
          const isWin = bet.cardIndex === winningCardIndex;
          const payout = isWin ? bet.stake * PAYOUT_MULTIPLIER : 0;

          if (isWin && creditBalance) {
            user.balance += payout;
          }

          return {
            ...bet,
            winningCardIndex,
            winningCardName,
            payout,
            isWin,
            status: "SETTLED" as const,
          };
        }
        return bet;
      });

      if (userChanged) {
        user.bets = updatedBets;
        users[i] = user;
        changed = true;
      }
    }
  }

  if (changed) {
    saveUsers(users);
  }
}

/**
 * Automatically settles any pending bets whose rounds have finished or reached result phase.
 * Guarantees zero bets ever get stuck in "PENDING" ("⏳ IN PLAY").
 */
export function autoSettleAllPendingBets(
  currentRoundNumber: number,
  currentPhase: string,
  currentWinner?: number | null,
  creditBalance = false
): boolean {
  const users = getUsers();
  let changed = false;

  for (let i = 0; i < users.length; i++) {
    const user = { ...users[i] };
    let userChanged = false;

    if (user.bets && user.bets.length > 0) {
      const updatedBets = user.bets.map((bet) => {
        if (bet.status !== "PENDING") return bet;

        const betRoundNum = bet.roundNumber || parseInt((bet.roundId || "").replace(/\D/g, ""), 10) || 0;
        const isPastRound = betRoundNum > 0 && betRoundNum < currentRoundNumber;
        const isCurrentRoundSettled =
          betRoundNum === currentRoundNumber &&
          (currentPhase === "select" || currentPhase === "result") &&
          currentWinner !== null &&
          currentWinner !== undefined;

        if (isPastRound || isCurrentRoundSettled) {
          userChanged = true;
          const winIdx = isCurrentRoundSettled
            ? currentWinner!
            : (getRecordedRoundWinner(betRoundNum) ?? getDeterministicRoundWinner(betRoundNum));

          const winCard = CARDS[winIdx];
          const isWin = bet.cardIndex === winIdx;
          const payout = isWin ? bet.stake * PAYOUT_MULTIPLIER : 0;

          if (isWin && creditBalance) {
            user.balance += payout;
          }

          return {
            ...bet,
            winningCardIndex: winIdx,
            winningCardName: winCard?.name || `Card ${winIdx}`,
            payout,
            isWin,
            status: "SETTLED" as const,
          };
        }
        return bet;
      });

      if (userChanged) {
        user.bets = updatedBets;
        users[i] = user;
        changed = true;
      }
    }
  }

  if (changed) {
    saveUsers(users);
  }
  return changed;
}

/**
 * Computes comprehensive profit & loss analytics for a user.
 */
export function getUserProfitStats(user: UserAccount): UserProfitStats {
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();

  const bets = user.bets || [];
  let totalBetAmount = 0;
  let totalWonAmount = 0;
  let winCount = 0;
  let lossCount = 0;

  let todayBetsCount = 0;
  let todayBetAmount = 0;
  let todayWonAmount = 0;

  let yesterdayBetsCount = 0;
  let yesterdayBetAmount = 0;
  let yesterdayWonAmount = 0;

  for (const b of bets) {
    const isWin = b.status === "SETTLED" ? Boolean(b.isWin) : (Number(b.payout || 0) > 0);
    const maxPayout = Number(b.stake || 0) * PAYOUT_MULTIPLIER;
    const effPayout = isWin ? (Number(b.payout || 0) > 0 ? Math.min(Number(b.payout), maxPayout) : maxPayout) : 0;

    totalBetAmount += b.stake;
    totalWonAmount += effPayout;

    if (b.status === "SETTLED") {
      if (b.isWin) winCount++;
      else lossCount++;
    }

    if (b.dateStr === todayStr) {
      todayBetsCount++;
      todayBetAmount += b.stake;
      todayWonAmount += effPayout;
    } else if (b.dateStr === yesterdayStr) {
      yesterdayBetsCount++;
      yesterdayBetAmount += b.stake;
      yesterdayWonAmount += effPayout;
    }
  }

  const settledCount = winCount + lossCount;
  const winRate = settledCount > 0 ? Math.round((winCount / settledCount) * 100) : 0;
  const netBetProfit = totalWonAmount - totalBetAmount;
  const netAccountProfit = user.balance - user.totalDeposited;

  return {
    totalDeposited: user.totalDeposited,
    currentBalance: user.balance,
    totalBetsPlaced: bets.length,
    totalBetAmount,
    totalWonAmount,
    netBetProfit,
    netAccountProfit,
    winCount,
    lossCount,
    winRate,
    todayBetsCount,
    todayBetAmount,
    todayWonAmount,
    todayNetProfit: todayWonAmount - todayBetAmount,
    yesterdayBetsCount,
    yesterdayBetAmount,
    yesterdayWonAmount,
    yesterdayNetProfit: yesterdayWonAmount - yesterdayBetAmount,
  };
}

/**
 * Filter user's bets into Today, Yesterday, and Older.
 */
export function getCategorizedUserBets(user: UserAccount) {
  const todayStr = getTodayDateStr();
  const yesterdayStr = getYesterdayDateStr();

  const all = user.bets || [];
  const today = all.filter((b) => b.dateStr === todayStr);
  const yesterday = all.filter((b) => b.dateStr === yesterdayStr);
  const older = all.filter((b) => b.dateStr !== todayStr && b.dateStr !== yesterdayStr);

  return { today, yesterday, older, all };
}

/**
 * Global stats across all users for admin high-level overview.
 */
export function getGlobalPlatformStats(users: UserAccount[]) {
  let totalDeposited = 0;
  let totalCurrentBalance = 0;
  let totalBetsPlaced = 0;
  let totalTurnover = 0;
  let totalPayouts = 0;
  let todayTotalBets = 0;
  let todayTurnover = 0;
  let todayPayouts = 0;

  const todayStr = getTodayDateStr();

  for (const u of users) {
    totalDeposited += u.totalDeposited || 0;
    totalCurrentBalance += u.balance || 0;
    const bets = u.bets || [];
    totalBetsPlaced += bets.length;
    for (const b of bets) {
      totalTurnover += b.stake;
      totalPayouts += b.payout || 0;
      if (b.dateStr === todayStr) {
        todayTotalBets++;
        todayTurnover += b.stake;
        todayPayouts += b.payout || 0;
      }
    }
  }

  const netPlatformProfit = totalTurnover - totalPayouts;
  const platformProfitMargin = totalTurnover > 0 ? Math.round((netPlatformProfit / totalTurnover) * 100) : 100;

  return {
    totalUsers: users.length,
    totalDeposited,
    totalCurrentBalance,
    totalBetsPlaced,
    totalTurnover,
    totalPayouts,
    netPlatformProfit,
    platformProfitMargin,
    todayTotalBets,
    todayTurnover,
    todayPayouts,
  };
}

/**
 * Pushes all local user accounts, deposits, and bets into Supabase database.
 */
export async function pushAllToSupabase(): Promise<{
  success: boolean;
  message: string;
  usersCount: number;
  depositsCount: number;
  betsCount: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      message: "Supabase client not initialized. Check credentials.",
      usersCount: 0,
      depositsCount: 0,
      betsCount: 0,
    };
  }

  const users = getUsers();
  let depositsCount = 0;
  let betsCount = 0;

  try {
    // 1. Upsert Players
    const playerRows = users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.displayName,
      phone: u.phone || null,
      pin: u.pin || "1234",
      balance: u.balance,
      total_deposited: u.totalDeposited,
      total_withdrawn: u.totalWithdrawn || 0,
      status: u.status || "ACTIVE",
      notes: u.notes || null,
      updated_at: new Date().toISOString(),
    }));

    if (playerRows.length > 0) {
      const { error: pErr } = await supabase.from("players").upsert(playerRows);
      if (pErr) throw pErr;
    }

    // 2. Upsert Deposits
    const depositRows: any[] = [];
    users.forEach((u) => {
      (u.deposits || []).forEach((dep) => {
        depositRows.push({
          id: dep.id,
          user_id: u.id,
          amount: dep.amount,
          date_str: dep.dateStr,
          time_str: dep.timeStr,
          note: dep.note || null,
          balance_after: dep.balanceAfter,
        });
      });
    });

    if (depositRows.length > 0) {
      const { error: dErr } = await supabase.from("deposits").upsert(depositRows);
      if (dErr) throw dErr;
      depositsCount = depositRows.length;
    }

    // 3. Upsert Bets
    const betRows: any[] = [];
    users.forEach((u) => {
      (u.bets || []).forEach((b) => {
        betRows.push({
          id: b.id,
          user_id: u.id,
          round_id: b.roundId,
          round_number: b.roundNumber,
          ticket_id: b.ticketId || b.id,
          card_index: b.cardIndex,
          card_name: b.cardName,
          amount: b.stake,
          payout: b.payout || 0,
          status: b.isWin ? "won" : "lost",
          date_str: b.dateStr,
          time_str: b.timeStr,
        });
      });
    });

    if (betRows.length > 0) {
      const { error: bErr } = await supabase.from("sorat_bets").upsert(betRows);
      if (bErr) throw bErr;
      betsCount = betRows.length;
    }

    return {
      success: true,
      message: `Synced ${users.length} users, ${depositsCount} deposits, and ${betsCount} bets to Supabase!`,
      usersCount: users.length,
      depositsCount,
      betsCount,
    };
  } catch (e: any) {
    console.error("Supabase Push Error:", e);
    return {
      success: false,
      message: e.message || "Failed to push to Supabase",
      usersCount: 0,
      depositsCount: 0,
      betsCount: 0,
    };
  }
}

/**
 * Pulls all user accounts, deposits, and bets from Supabase and replaces/merges into local store.
 */
export async function syncFromSupabase(): Promise<{
  success: boolean;
  message: string;
  usersCount: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      message: "Supabase not configured.",
      usersCount: 0,
    };
  }

  try {
    const { data: players, error: pErr } = await supabase.from("players").select("*");
    if (pErr) throw pErr;
    if (!players || players.length === 0) {
      return { success: true, message: "No remote players found in Supabase.", usersCount: 0 };
    }

    const { data: deposits, error: dErr } = await supabase.from("deposits").select("*");
    if (dErr) throw dErr;

    const { data: bets, error: bErr } = await supabase.from("sorat_bets").select("*");
    if (bErr) throw bErr;

    const parsedUsers: UserAccount[] = players.map((p: any) => {
      const userDeposits: UserDeposit[] = (deposits || [])
        .filter((d: any) => d.user_id === p.id)
        .map((d: any) => ({
          id: d.id,
          amount: Number(d.amount),
          timestamp: new Date(d.created_at).getTime(),
          dateStr: d.date_str,
          timeStr: d.time_str,
          note: d.note,
          balanceAfter: Number(d.balance_after),
        }));

      const userBets: UserBetRecord[] = (bets || [])
        .filter((b: any) => b.user_id === p.id)
        .map((b: any) => ({
          id: b.id,
          ticketId: b.ticket_id,
          roundId: b.round_id,
          roundNumber: b.round_number,
          timestamp: new Date(b.created_at).getTime(),
          dateStr: b.date_str,
          timeStr: b.time_str,
          cardIndex: b.card_index,
          cardName: b.card_name,
          stake: Number(b.amount || b.stake || 0),
          winningCardIndex: b.winning_card_index ?? undefined,
          winningCardName: b.winning_card_name ?? undefined,
          payout: (b.status === "won" || b.status === "claimed" || Boolean(b.is_win))
            ? Math.min(Number(b.payout || 0) > 0 ? Number(b.payout) : Number(b.amount || b.stake || 0) * PAYOUT_MULTIPLIER, Number(b.amount || b.stake || 0) * PAYOUT_MULTIPLIER)
            : 0,
          isWin: b.status === "won" || b.status === "claimed" || Boolean(b.is_win),
          status: b.status === "won" ? "SETTLED" : b.status === "lost" ? "SETTLED" : "PENDING",
        }));

      return {
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        phone: p.phone || "",
        pin: p.pin || "1234",
        balance: Number(p.balance),
        totalDeposited: Number(p.total_deposited),
        totalWithdrawn: Number(p.total_withdrawn || 0),
        status: p.status || "ACTIVE",
        notes: p.notes || "",
        createdAt: new Date(p.created_at).getTime(),
        deposits: userDeposits,
        bets: userBets,
      };
    });

    saveUsers(parsedUsers);
    return {
      success: true,
      message: `Pulled ${parsedUsers.length} accounts from Supabase!`,
      usersCount: parsedUsers.length,
    };
  } catch (e: any) {
    console.error("Supabase Pull Error:", e);
    return {
      success: false,
      message: e.message || "Failed to pull from Supabase",
      usersCount: 0,
    };
  }
}


