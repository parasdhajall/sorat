import { getSupabaseClient } from "./supabase";

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
  status: "ACTIVE" | "INACTIVE";
  notes?: string;
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
      id: "usr_rahul_01",
      username: "rahul99",
      displayName: "Rahul Sharma",
      phone: "+91 98765 43210",
      balance: 1450,
      totalDeposited: 3000,
      totalWithdrawn: 0,
      createdAt: now - 7 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "Regular counter player",
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
          payout: 500,
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
          payout: 500,
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
          payout: 1000,
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
      username: "amit_patel",
      displayName: "Amit Patel",
      phone: "+91 98234 56789",
      balance: 800,
      totalDeposited: 2000,
      totalWithdrawn: 500,
      createdAt: now - 14 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "VIP player",
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
          payout: 500,
          isWin: true,
          status: "SETTLED",
        },
      ],
    },
    {
      id: "usr_suresh_03",
      username: "suresh_patil",
      displayName: "Suresh Patil",
      phone: "+91 99887 76655",
      balance: 5200,
      totalDeposited: 5000,
      totalWithdrawn: 0,
      createdAt: now - 3 * 24 * 3600 * 1000,
      status: "ACTIVE",
      notes: "High roller",
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
          payout: 2000,
          isWin: true,
          status: "SETTLED",
        },
      ],
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

  if (cachedUsers) return cachedUsers;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedUsers = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load users from localStorage", e);
  }

  const seed = createInitialSeedUsers();
  saveUsers(seed);
  return seed;
}

export function saveUsers(users: UserAccount[]): void {
  cachedUsers = users;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
      notifySync("USERS_UPDATED", users);
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
  target.totalDeposited = (target.totalDeposited || 0) + amount;
  target.deposits = [depositRecord, ...(target.deposits || [])];

  users[idx] = target;
  saveUsers(users);

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
  target.totalWithdrawn = (target.totalWithdrawn || 0) + amount;

  users[idx] = target;
  saveUsers(users);

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
 * Set exact balance for a user.
 */
export function setUserBalance(userId: string, balance: number): UserAccount {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");

  const target = { ...users[idx] };
  target.balance = Math.max(0, balance);
  users[idx] = target;
  saveUsers(users);

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
 * Create a new user account.
 */
export function createUser(data: {
  displayName: string;
  username: string;
  phone?: string;
  initialDeposit: number;
  notes?: string;
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
  return newUser;
}

/**
 * Delete a user account.
 */
export function deleteUser(userId: string): void {
  const users = getUsers().filter((u) => u.id !== userId);
  saveUsers(users);
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
 * Credits user balance for winnings.
 */
export function settleRoundBets(
  roundId: string,
  winningCardIndex: number,
  winningCardName: string
): void {
  const users = getUsers();
  let changed = false;

  for (let i = 0; i < users.length; i++) {
    const user = { ...users[i] };
    let userChanged = false;

    if (user.bets) {
      const updatedBets = user.bets.map((bet) => {
        if (bet.roundId === roundId && bet.status === "PENDING") {
          userChanged = true;
          const isWin = bet.cardIndex === winningCardIndex;
          const payout = isWin ? bet.stake * 10 : 0;

          if (isWin) {
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
    totalBetAmount += b.stake;
    totalWonAmount += b.payout || 0;

    if (b.status === "SETTLED") {
      if (b.isWin) winCount++;
      else lossCount++;
    }

    if (b.dateStr === todayStr) {
      todayBetsCount++;
      todayBetAmount += b.stake;
      todayWonAmount += b.payout || 0;
    } else if (b.dateStr === yesterdayStr) {
      yesterdayBetsCount++;
      yesterdayBetAmount += b.stake;
      yesterdayWonAmount += b.payout || 0;
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
          date_str: b.dateStr,
          time_str: b.timeStr,
          card_index: b.cardIndex,
          card_name: b.cardName,
          stake: b.stake,
          winning_card_index: b.winningCardIndex ?? null,
          winning_card_name: b.winningCardName ?? null,
          payout: b.payout || 0,
          is_win: b.isWin || false,
          status: b.status || "SETTLED",
        });
      });
    });

    if (betRows.length > 0) {
      const { error: bErr } = await supabase.from("bets").upsert(betRows);
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

    const { data: bets, error: bErr } = await supabase.from("bets").select("*");
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
          roundId: b.round_id,
          roundNumber: b.round_number,
          timestamp: new Date(b.created_at).getTime(),
          dateStr: b.date_str,
          timeStr: b.time_str,
          cardIndex: b.card_index,
          cardName: b.card_name,
          stake: Number(b.stake),
          winningCardIndex: b.winning_card_index ?? undefined,
          winningCardName: b.winning_card_name ?? undefined,
          payout: Number(b.payout || 0),
          isWin: Boolean(b.is_win),
          status: b.status,
        }));

      return {
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        phone: p.phone || "",
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


