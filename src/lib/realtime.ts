import { getSupabaseClient } from "./supabase";

export const BET_DURATION = 50; // 50s for bets
export const SELECT_DURATION = 5; // 5s for card spin
export const RESULT_DURATION = 5; // 5s for winner reveal
export const ROUND_DURATION = BET_DURATION + SELECT_DURATION + RESULT_DURATION; // 60s total (1 round per minute)

export interface SynchronizedRoundState {
  roundNumber: number; // e.g. 1325 (Minute of the day in IST)
  roundId: string; // e.g. "#1325"
  phase: "bet" | "select" | "result";
  timeLeft: number; // seconds remaining in current phase
  totalTime: number; // total duration of current phase
  elapsedInRound: number; // 0..59
}

/**
 * Calculates deterministic game clock synchronized to Indian Standard Time (IST / UTC+5:30).
 * Guarantees that any device (TV, Phone, Laptop) anywhere in the world will display
 * the exact same round number and exact same countdown seconds simultaneously!
 */
export function getSynchronizedRoundState(nowMs: number = Date.now()): SynchronizedRoundState {
  const epochSeconds = Math.floor(nowMs / 1000);
  // IST offset: UTC + 5 hours 30 mins = 19800 seconds
  const istSeconds = epochSeconds + (5 * 3600 + 30 * 60);
  const istDate = new Date(istSeconds * 1000);

  // Daily round number from 1 to 1440
  const roundNumber = istDate.getUTCHours() * 60 + istDate.getUTCMinutes() + 1;
  const roundId = `#${String(roundNumber).padStart(4, "0")}`;

  const seconds = istDate.getUTCSeconds();
  const elapsedInRound = seconds % ROUND_DURATION;

  let phase: "bet" | "select" | "result";
  let timeLeft: number;
  let totalTime: number;

  if (elapsedInRound < BET_DURATION) {
    phase = "bet";
    timeLeft = BET_DURATION - elapsedInRound;
    totalTime = BET_DURATION;
  } else if (elapsedInRound < BET_DURATION + SELECT_DURATION) {
    phase = "select";
    timeLeft = (BET_DURATION + SELECT_DURATION) - elapsedInRound;
    totalTime = SELECT_DURATION;
  } else {
    phase = "result";
    timeLeft = ROUND_DURATION - elapsedInRound;
    totalTime = RESULT_DURATION;
  }

  return {
    roundNumber,
    roundId,
    phase,
    timeLeft,
    totalTime,
    elapsedInRound,
  };
}

export const TARGET_PROFIT_MARGIN = 0.35; // 35% Gross House Target (10% Agent Commission + 25% Admin Net Profit)
export const MAX_PAYOUT_RATIO = 0.65; // 65% Maximum RTP to players
export const PAYOUT_MULTIPLIER = 9; // 9x Payout for 12 cards (1 ka 9)

export interface CardProfitAnalysis {
  card: number;
  bet: number;
  potentialPayout: number;
  isSafeForProfit: boolean;
  status: "ZERO_BET" | "SAFE" | "BLOCKED";
}

/**
 * Analyzes all 12 cards against the 30% Owner Profit Margin guarantee rule.
 */
export function analyzeCardProfitability(
  currentBets: Record<number, number>,
  totalTurnover: number,
  totalPayouts: number
): CardProfitAnalysis[] {
  const roundTurnover = Object.values(currentBets).reduce((a, b) => a + b, 0);
  const newTurnover = totalTurnover + roundTurnover;

  // Maximum cumulative payouts allowed to guarantee >= 30% house profit
  const maxAllowedCumulativePayout = newTurnover * MAX_PAYOUT_RATIO;
  const currentMaxRoundPayout = Math.max(0, maxAllowedCumulativePayout - totalPayouts);

  return Array.from({ length: 12 }, (_, i) => {
    const bet = currentBets[i] ?? 0;
    const potentialPayout = bet * PAYOUT_MULTIPLIER;
    const isSafeForProfit = potentialPayout <= currentMaxRoundPayout || roundTurnover === 0;

    let status: "ZERO_BET" | "SAFE" | "BLOCKED";
    if (bet === 0) {
      status = "ZERO_BET";
    } else if (isSafeForProfit) {
      status = "SAFE";
    } else {
      status = "BLOCKED";
    }

    return { card: i, bet, potentialPayout, isSafeForProfit, status };
  });
}

/**
 * Calculates the winning card ensuring at least 30% House Margin is maintained.
 */
export function calculateProfitGuaranteedWinner(
  currentBets: Record<number, number>,
  totalTurnover: number,
  totalPayouts: number,
  forcedWinner: number | null = null
): { winner: number; netPayout: number; reason: string } {
  // 1. If Admin manually forced a winner, honor Admin's command unconditionally
  if (forcedWinner !== null && forcedWinner >= 0 && forcedWinner < 12) {
    const betOnCard = currentBets[forcedWinner] ?? 0;
    return {
      winner: forcedWinner,
      netPayout: betOnCard * PAYOUT_MULTIPLIER,
      reason: "ADMIN_MANUAL_OVERRIDE",
    };
  }

  const analysis = analyzeCardProfitability(currentBets, totalTurnover, totalPayouts);
  const safeCards = analysis.filter((c) => c.isSafeForProfit);
  const safeWithBets = safeCards.filter((c) => c.bet > 0);
  const zeroBetCards = analysis.filter((c) => c.status === "ZERO_BET");

  // 2. Real, Dynamic Player Wins across ALL Safe Cards (Small, Medium, or High bets):
  // As long as the payout keeps house profit >= 30%, players CAN and WILL win!
  // No longer biased to only pick zero or strictly lowest ₹10.
  if (safeWithBets.length > 0) {
    // 70% chance a card with a bet wins (varied across small, medium, high safe bets),
    // 30% chance a zero-bet card wins (if available) to bank house profit.
    const shouldPlayerWin = zeroBetCards.length === 0 || Math.random() < 0.70;
    if (shouldPlayerWin) {
      // Pick randomly among all safe cards with bets
      const pick = safeWithBets[Math.floor(Math.random() * safeWithBets.length)]!;
      return {
        winner: pick.card,
        netPayout: pick.potentialPayout,
        reason: "VARIED_SAFE_PLAYER_WIN",
      };
    }
  }

  // 3. 0-Bet Card Selection (100% house profit buffer)
  if (zeroBetCards.length > 0) {
    const lucky = zeroBetCards[Math.floor(Math.random() * zeroBetCards.length)]!;
    return {
      winner: lucky.card,
      netPayout: 0,
      reason: "ZERO_BET_100_PERCENT_PROFIT",
    };
  }

  // 4. All cards have bets and some are safe:
  if (safeCards.length > 0) {
    const pick = safeCards[Math.floor(Math.random() * safeCards.length)]!;
    return {
      winner: pick.card,
      netPayout: pick.potentialPayout,
      reason: "SAFE_RANDOM_WIN",
    };
  }

  // 5. Extreme edge case: All cards violate 30% budget (very high bets in early rounds)
  // Pick card with lowest potential payout to defend capital
  const lowestLossCard = analysis.reduce((prev, curr) => (curr.bet < prev.bet ? curr : prev));
  return {
    winner: lowestLossCard.card,
    netPayout: lowestLossCard.potentialPayout,
    reason: "MINIMAL_LOSS_PROTECTION",
  };
}

/**
 * Deterministic pseudo-random card index (0..11) for a given IST round number.
 * Guarantees that any device (TV, Phone, APK) will compute the exact same baseline winner
 * for round #1234 without requiring network messages if offline or latency occurs.
 */
export function getDeterministicRoundWinner(roundNumber: number): number {
  const seed = (Math.abs(roundNumber) * 1103515245 + 12345) & 0x7fffffff;
  return seed % 12;
}

export type GameMessage =
  | { type: "ADD_BET"; card: number; amount: number; roomId?: string }
  | { type: "ADD_TICKET_BETS"; bets: Record<number, number>; totalAmount: number; agentName?: string; roundId: string; roomId?: string }
  | { type: "SUB_BET"; card: number; amount: number; roomId?: string }
  | { type: "CLEAR_CARD"; card: number; roomId?: string }
  | { type: "CLEAR_ALL_BETS"; roomId?: string }
  | { type: "FORCE_WINNER"; card: number | null; roomId?: string }
  | { type: "TRIGGER_SPIN"; roomId?: string }
  | { type: "RESET_ROUND"; roomId?: string }
  | { type: "RECHARGE_AGENT"; amount: number; roomId?: string }
  | { type: "SET_AGENT_BALANCE"; balance: number; roomId?: string }
  | { type: "RESET_FINANCIALS"; roomId?: string }
  | { type: "USER_DEPOSIT"; userId: string; amount: number; note?: string; roomId?: string }
  | { type: "SWITCH_ACTIVE_USER"; userId: string; roomId?: string }
  | { type: "SYNC_USERS"; roomId?: string }
  | {
      type: "WINNER_DECLARED";
      roundNumber: number;
      roundId: string;
      winner: number;
      winnerName: string;
      netPayout: number;
      reason: string;
      roomId: string;
    }
  | {
      type: "SYNC_FROM_TV";
      roundNumber: number;
      roundId: string;
      phase: "bet" | "select" | "result";
      t: number;
      bets: Record<number, number>;
      pool: number;
      winner: number | null;
      forcedWinner: number | null;
      agentBalance: number;
      totalTurnover: number;
      totalPayouts: number;
      houseProfit: number;
      profitPercentage: number;
      roomId?: string;
    };

export const DEFAULT_ROOM_ID = "sorat_main";

/**
 * Sanitizes room/counter identifiers (e.g. "@agent1" -> "agent1", lowercase, safe characters).
 */
export function sanitizeRoomId(roomId?: string): string {
  if (!roomId) return DEFAULT_ROOM_ID;
  const clean = roomId
    .toString()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]/g, "_")
    .trim();
  return clean || DEFAULT_ROOM_ID;
}

// TV Host Connection Class (Powered by Supabase Realtime Channels + Local Broadcast + Cloud Fallback)
export class TVHostSync {
  public roomId: string;
  private broadcastChannel: BroadcastChannel | null = null;
  private supabaseChannel: any = null;
  private sse: EventSource | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;

  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "waiting" | "disconnected", peerId?: string) => void = () => {};

  constructor(roomId: string = DEFAULT_ROOM_ID) {
    this.roomId = sanitizeRoomId(roomId);
    this.setupLocalChannels();
  }

  private setupLocalChannels() {
    if (typeof window === "undefined") return;

    if ("BroadcastChannel" in window) {
      try {
        this.broadcastChannel = new BroadcastChannel(`sorat_local_${this.roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data._from === "admin") {
            this.onStatusChange("connected");
            this.onMessage(event.data.payload);
          }
        };
      } catch {}
    }

    window.addEventListener("storage", (e) => {
      if (e.key === `sorat_admin_msg_${this.roomId}` && e.newValue) {
        try {
          const wire = JSON.parse(e.newValue);
          if (wire && wire._from === "admin") {
            this.onStatusChange("connected");
            this.onMessage(wire.payload);
          }
        } catch {}
      }
    });
  }

  connect() {
    this.start();
  }

  start() {
    this.isDestroyed = false;
    this.onStatusChange("connected");

    // 1. Primary: Supabase Realtime WebSocket Broadcast Channel (Sub-50ms latency across networks)
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        this.supabaseChannel = supabase.channel(`sorat_room_${this.roomId}`, {
          config: { broadcast: { ack: false, self: false } },
        });

        this.supabaseChannel
          .on("broadcast", { event: "GAME_MESSAGE" }, (payload: any) => {
            if (this.isDestroyed) return;
            const wire = payload.payload;
            if (wire && wire._from === "admin" && wire.payload) {
              this.onStatusChange("connected");
              this.onMessage(wire.payload);
            }
          })
          .subscribe((status: string) => {
            if (status === "SUBSCRIBED") {
              this.onStatusChange("connected");
            }
          });
      } catch (err) {
        console.warn("TVHostSync: Supabase channel connection fallback to local/cloud:", err);
      }
    }

    // 2. Secondary Cloud Fallback: Room-Scoped Server-Sent Events (SSE) Stream
    const ntfyRoomTopic = `sorat_room_${this.roomId}`;
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        this.sse = new EventSource(`https://ntfy.sh/${ntfyRoomTopic}/sse`);
        this.sse.onopen = () => {
          this.onStatusChange("connected");
        };
        this.sse.onmessage = (event) => {
          if (this.isDestroyed) return;
          try {
            const ntfyMsg = JSON.parse(event.data);
            if (ntfyMsg.event === "message" && ntfyMsg.message) {
              const wire = JSON.parse(ntfyMsg.message);
              if (wire && wire._from === "admin" && wire.payload) {
                this.onStatusChange("connected");
                this.onMessage(wire.payload);
              }
            }
          } catch {}
        };
      } catch {}
    }

    // 3. Initial state polling to recover past commands
    const pollRecent = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(`https://ntfy.sh/${ntfyRoomTopic}/json?poll=1&since=all`);
        if (res.ok) {
          const text = await res.text();
          const lines = text.trim().split("\n");
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.event === "message" && item.message) {
                const wire = JSON.parse(item.message);
                if (wire && wire._from === "admin" && wire.payload) {
                  this.onStatusChange("connected");
                  this.onMessage(wire.payload);
                  break;
                }
              }
            } catch {}
          }
        }
      } catch {}
    };

    pollRecent();
    this.pollInterval = setInterval(pollRecent, 5000);
  }

  broadcast(msg: GameMessage) {
    if (typeof window === "undefined") return;

    const wire = {
      _from: "tv",
      roomId: this.roomId,
      payload: msg,
      time: Date.now(),
    };

    // 1. Send via Supabase Realtime Channel
    try {
      this.supabaseChannel?.send({
        type: "broadcast",
        event: "GAME_MESSAGE",
        payload: wire,
      });
    } catch {}

    // 2. Send via Local BroadcastChannel
    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    // 3. Save to localStorage for cross-tab sync
    try {
      localStorage.setItem(`sorat_tv_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    // 4. Room-isolated cloud channel fallback
    const ntfyRoomTopic = `sorat_room_${this.roomId}`;
    fetch(`https://ntfy.sh/${ntfyRoomTopic}`, {
      method: "POST",
      body: JSON.stringify(wire),
    }).catch(() => {});
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);

    try {
      if (this.supabaseChannel) {
        const supabase = getSupabaseClient();
        supabase?.removeChannel(this.supabaseChannel);
        this.supabaseChannel = null;
      }
    } catch {}

    try {
      this.sse?.close();
      this.broadcastChannel?.close();
    } catch {}
  }
}

// Admin / Phone Client Connection Class (Powered by Supabase Realtime Channels + Local Broadcast + Cloud Fallback)
export class AdminClientSync {
  public roomId: string;
  private broadcastChannel: BroadcastChannel | null = null;
  private supabaseChannel: any = null;
  private sse: EventSource | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;

  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void = () => {};

  constructor(roomId: string = DEFAULT_ROOM_ID) {
    this.roomId = sanitizeRoomId(roomId);
    this.setupLocalChannels();
  }

  private setupLocalChannels() {
    if (typeof window === "undefined") return;

    if ("BroadcastChannel" in window) {
      try {
        this.broadcastChannel = new BroadcastChannel(`sorat_local_${this.roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.payload) {
            this.onStatusChange("connected");
            this.onMessage(event.data.payload);
          }
        };
      } catch {}
    }

    window.addEventListener("storage", (e) => {
      if (
        (e.key === `sorat_tv_msg_${this.roomId}` || e.key === `sorat_admin_msg_${this.roomId}`) &&
        e.newValue
      ) {
        try {
          const wire = JSON.parse(e.newValue);
          if (wire && wire.payload) {
            this.onStatusChange("connected");
            this.onMessage(wire.payload);
          }
        } catch {}
      }
    });
  }

  connect() {
    this.isDestroyed = false;
    this.onStatusChange("connected");

    // 1. Primary: Supabase Realtime WebSocket Broadcast Channel
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        this.supabaseChannel = supabase.channel(`sorat_room_${this.roomId}`, {
          config: { broadcast: { ack: false, self: false } },
        });

        this.supabaseChannel
          .on("broadcast", { event: "GAME_MESSAGE" }, (payload: any) => {
            if (this.isDestroyed) return;
            const wire = payload.payload;
            if (wire && wire.payload) {
              this.onStatusChange("connected");
              this.onMessage(wire.payload);
            }
          })
          .subscribe((status: string) => {
            if (status === "SUBSCRIBED") {
              this.onStatusChange("connected");
            }
          });
      } catch (err) {
        console.warn("AdminClientSync: Supabase channel connection fallback to local/cloud:", err);
      }
    }

    // 2. Secondary Cloud Fallback: Room-Scoped Server-Sent Events (SSE) Stream
    const ntfyRoomTopic = `sorat_room_${this.roomId}`;
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        this.sse = new EventSource(`https://ntfy.sh/${ntfyRoomTopic}/sse`);
        this.sse.onopen = () => {
          this.onStatusChange("connected");
        };
        this.sse.onmessage = (event) => {
          if (this.isDestroyed) return;
          try {
            const ntfyMsg = JSON.parse(event.data);
            if (ntfyMsg.event === "message" && ntfyMsg.message) {
              const wire = JSON.parse(ntfyMsg.message);
              if (wire && wire.payload) {
                this.onStatusChange("connected");
                this.onMessage(wire.payload);
              }
            }
          } catch {}
        };
      } catch {}
    }

    // 3. Initial state poll to get latest TV state
    const pollRecent = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(`https://ntfy.sh/${ntfyRoomTopic}/json?poll=1&since=all`);
        if (res.ok) {
          const text = await res.text();
          const lines = text.trim().split("\n");
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.event === "message" && item.message) {
                const wire = JSON.parse(item.message);
                if (wire && (wire._from === "tv" || wire._from === "admin") && wire.payload) {
                  this.onStatusChange("connected");
                  this.onMessage(wire.payload);
                  break;
                }
              }
            } catch {}
          }
        }
      } catch {}
    };

    pollRecent();
    this.pollInterval = setInterval(pollRecent, 5000);
  }

  send(msg: GameMessage) {
    if (typeof window === "undefined") return;

    const wire = {
      _from: "admin",
      roomId: this.roomId,
      payload: msg,
      time: Date.now(),
    };

    // 1. Send via Supabase Realtime Channel
    try {
      this.supabaseChannel?.send({
        type: "broadcast",
        event: "GAME_MESSAGE",
        payload: wire,
      });
    } catch {}

    // 2. Send via Local BroadcastChannel
    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    // 3. Save to localStorage for cross-tab sync
    try {
      localStorage.setItem(`sorat_admin_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    // 4. Room-isolated cloud channel fallback
    const ntfyRoomTopic = `sorat_room_${this.roomId}`;
    fetch(`https://ntfy.sh/${ntfyRoomTopic}`, {
      method: "POST",
      body: JSON.stringify(wire),
    }).catch(() => {});
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);

    try {
      if (this.supabaseChannel) {
        const supabase = getSupabaseClient();
        supabase?.removeChannel(this.supabaseChannel);
        this.supabaseChannel = null;
      }
    } catch {}

    try {
      this.sse?.close();
      this.broadcastChannel?.close();
    } catch {}
  }
}
