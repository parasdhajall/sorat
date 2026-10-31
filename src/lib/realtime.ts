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

export const TARGET_PROFIT_MARGIN = 0.30; // 30% Owner Profit Guarantee
export const MAX_PAYOUT_RATIO = 0.70; // 70% Maximum RTP to players
export const PAYOUT_MULTIPLIER = 10; // 10x Payout for 12 cards

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
  | { type: "ADD_BET"; card: number; amount: number }
  | { type: "ADD_TICKET_BETS"; bets: Record<number, number>; totalAmount: number; agentName?: string; roundId: string }
  | { type: "SUB_BET"; card: number; amount: number }
  | { type: "CLEAR_CARD"; card: number }
  | { type: "CLEAR_ALL_BETS" }
  | { type: "FORCE_WINNER"; card: number | null }
  | { type: "TRIGGER_SPIN" }
  | { type: "RESET_ROUND" }
  | { type: "RECHARGE_AGENT"; amount: number }
  | { type: "SET_AGENT_BALANCE"; balance: number }
  | { type: "RESET_FINANCIALS" }
  | { type: "USER_DEPOSIT"; userId: string; amount: number; note?: string }
  | { type: "SWITCH_ACTIVE_USER"; userId: string }
  | { type: "SYNC_USERS" }
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
    };

export const DEFAULT_ROOM_ID = "sorat-arena-88";
export const NTFY_TOPIC = "sorat_arena_live_v2_99";

// TV Host Connection Class (Powered by High-Reliability ntfy.sh SSE + Local Broadcast)
export class TVHostSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private sse: EventSource | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;

  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "waiting" | "disconnected", peerId?: string) => void = () => {};

  constructor(public roomId = DEFAULT_ROOM_ID) {
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

    // 1. Instant Cloud Server-Sent Events (SSE) Stream
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        this.sse = new EventSource(`https://ntfy.sh/${NTFY_TOPIC}/sse`);
        this.sse.onopen = () => {
          this.onStatusChange("connected");
        };
        this.sse.onmessage = (event) => {
          if (this.isDestroyed) return;
          try {
            const ntfyMsg = JSON.parse(event.data);
            if (ntfyMsg.event === "message" && ntfyMsg.message) {
              const wire = JSON.parse(ntfyMsg.message);
              if (wire && wire._from === "admin") {
                this.onStatusChange("connected");
                this.onMessage(wire.payload);
              }
            }
          } catch {}
        };
      } catch {}
    }

    // 2. Initial state polling to recover any past commands
    const pollRecent = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}/json?poll=1&since=all`);
        if (res.ok) {
          const text = await res.text();
          const lines = text.trim().split("\n");
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.event === "message" && item.message) {
                const wire = JSON.parse(item.message);
                if (wire && wire._from === "admin") {
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
      payload: msg,
      time: Date.now(),
    };

    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    try {
      localStorage.setItem(`sorat_tv_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    // Broadcast state to Cloud channel
    fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      body: JSON.stringify(wire),
    }).catch(() => {});
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);
    try {
      this.sse?.close();
      this.broadcastChannel?.close();
    } catch {}
  }
}

// Admin / Phone Client Connection Class (Powered by High-Reliability ntfy.sh SSE + Local Broadcast)
export class AdminClientSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private sse: EventSource | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;

  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void = () => {};

  constructor(public roomId = DEFAULT_ROOM_ID) {
    this.setupLocalChannels();
  }

  private setupLocalChannels() {
    if (typeof window === "undefined") return;

    if ("BroadcastChannel" in window) {
      try {
        this.broadcastChannel = new BroadcastChannel(`sorat_local_${this.roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data._from === "tv") {
            this.onStatusChange("connected");
            this.onMessage(event.data.payload);
          }
        };
      } catch {}
    }

    window.addEventListener("storage", (e) => {
      if (e.key === `sorat_tv_msg_${this.roomId}` && e.newValue) {
        try {
          const wire = JSON.parse(e.newValue);
          if (wire && wire._from === "tv") {
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

    // 1. Instant Cloud Server-Sent Events (SSE) Stream
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        this.sse = new EventSource(`https://ntfy.sh/${NTFY_TOPIC}/sse`);
        this.sse.onopen = () => {
          this.onStatusChange("connected");
        };
        this.sse.onmessage = (event) => {
          if (this.isDestroyed) return;
          try {
            const ntfyMsg = JSON.parse(event.data);
            if (ntfyMsg.event === "message" && ntfyMsg.message) {
              const wire = JSON.parse(ntfyMsg.message);
              if (wire && wire._from === "tv" && wire.payload) {
                this.onStatusChange("connected");
                this.onMessage(wire.payload);
              }
            }
          } catch {}
        };
      } catch {}
    }

    // 2. Initial state poll to get latest TV state
    const pollRecent = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}/json?poll=1&since=all`);
        if (res.ok) {
          const text = await res.text();
          const lines = text.trim().split("\n");
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.event === "message" && item.message) {
                const wire = JSON.parse(item.message);
                if (wire && wire._from === "tv" && wire.payload?.type === "SYNC_FROM_TV") {
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
      payload: msg,
      time: Date.now(),
    };

    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    try {
      localStorage.setItem(`sorat_admin_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    // Push action to Cloud channel
    fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      body: JSON.stringify(wire),
    }).catch(() => {});
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);
    try {
      this.sse?.close();
      this.broadcastChannel?.close();
    } catch {}
  }
}
