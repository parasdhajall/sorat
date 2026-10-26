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
  const zeroBetCards = analysis.filter((c) => c.status === "ZERO_BET");
  const safeCards = analysis.filter((c) => c.isSafeForProfit);
  const safeWithBets = safeCards.filter((c) => c.bet > 0);

  const roundTurnover = Object.values(currentBets).reduce((a, b) => a + b, 0);
  const newTurnover = totalTurnover + roundTurnover;
  const currentProfitMargin = newTurnover > 0 ? (newTurnover - totalPayouts) / newTurnover : 1;

  // If lifetime profit margin is already high (> 35%) and there are safe bets,
  // let players win occasionally (40% chance) to keep them engaged & entertained!
  if (currentProfitMargin > 0.35 && safeWithBets.length > 0 && Math.random() < 0.40) {
    const lucky = safeWithBets[Math.floor(Math.random() * safeWithBets.length)]!;
    return {
      winner: lucky.card,
      netPayout: lucky.potentialPayout,
      reason: "CONTROLLED_SAFE_PLAYER_WIN",
    };
  }

  // Primary House Vault Protection: Prioritize 0-bet cards (100% house profit)
  if (zeroBetCards.length > 0) {
    const lucky = zeroBetCards[Math.floor(Math.random() * zeroBetCards.length)]!;
    return {
      winner: lucky.card,
      netPayout: 0,
      reason: "ZERO_BET_100_PERCENT_PROFIT",
    };
  }

  // If all cards have bets, pick the safe card with the lowest payout
  if (safeCards.length > 0) {
    const minSafe = safeCards.reduce((prev, curr) => (curr.potentialPayout < prev.potentialPayout ? curr : prev));
    return {
      winner: minSafe.card,
      netPayout: minSafe.potentialPayout,
      reason: "LOWEST_SAFE_PAYOUT",
    };
  }

  // Extreme edge case: Heavy bets on all 12 cards exceeding 70% budget.
  // Pick the card with absolute lowest bet to protect capital!
  const lowestLossCard = analysis.reduce((prev, curr) => (curr.bet < prev.bet ? curr : prev));
  return {
    winner: lowestLossCard.card,
    netPayout: lowestLossCard.potentialPayout,
    reason: "MINIMAL_LOSS_PROTECTION",
  };
}

export type GameMessage =
  | { type: "ADD_BET"; card: number; amount: number }
  | { type: "SUB_BET"; card: number; amount: number }
  | { type: "CLEAR_CARD"; card: number }
  | { type: "CLEAR_ALL_BETS" }
  | { type: "FORCE_WINNER"; card: number | null }
  | { type: "TRIGGER_SPIN" }
  | { type: "RESET_ROUND" }
  | { type: "RECHARGE_AGENT"; amount: number }
  | { type: "RESET_FINANCIALS" }
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
export const CLOUD_SYNC_URL = "https://api.restful-api.dev/objects/ff808181a09d98f701a17943e2421add";

// TV Host Connection Class (Powered by High-Reliability Cloud REST + Local Broadcast)
export class TVHostSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;
  private lastAdminUpdate = 0;

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

  start() {
    this.isDestroyed = false;
    this.onStatusChange("connected");

    // Cloud polling every 1000ms
    const poll = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(CLOUD_SYNC_URL);
        if (res.ok) {
          const json = await res.json();
          const d = json.data;
          if (d && d.adminUpdatedAt && d.adminUpdatedAt > this.lastAdminUpdate) {
            this.lastAdminUpdate = d.adminUpdatedAt;
            this.onStatusChange("connected");

            if (d.forcedWinner !== undefined) {
              this.onMessage({ type: "FORCE_WINNER", card: d.forcedWinner });
            }
            if (d.triggerSpin) {
              this.onMessage({ type: "TRIGGER_SPIN" });
            }
            if (d.clearBets) {
              this.onMessage({ type: "CLEAR_ALL_BETS" });
            }
            if (d.rechargeAgent) {
              this.onMessage({ type: "RECHARGE_AGENT", amount: d.rechargeAgent });
            }
            if (d.resetFinancials) {
              this.onMessage({ type: "RESET_FINANCIALS" });
            }
          }
        }
      } catch {}
    };

    poll();
    this.pollInterval = setInterval(poll, 1000);
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

    // When TV state changes (bets, phase, t, winner, financials):
    if (msg.type === "SYNC_FROM_TV") {
      fetch(CLOUD_SYNC_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "sorat_live_arena_sync_v1",
          data: {
            bets: msg.bets,
            pool: msg.pool,
            winner: msg.winner,
            forcedWinner: msg.forcedWinner,
            tvT: msg.t,
            phase: msg.phase,
            roundNumber: msg.roundNumber,
            roundId: msg.roundId,
            agentBalance: msg.agentBalance,
            totalTurnover: msg.totalTurnover,
            totalPayouts: msg.totalPayouts,
            houseProfit: msg.houseProfit,
            profitPercentage: msg.profitPercentage,
            tvUpdatedAt: Date.now(),
          },
        }),
      }).catch(() => {});
    }
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);
    try {
      this.broadcastChannel?.close();
    } catch {}
  }
}

// Admin / Phone Client Connection Class (Powered by High-Reliability Cloud REST + Local Broadcast)
export class AdminClientSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private pollInterval: any = null;
  private isDestroyed = false;
  private lastTvUpdate = 0;

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

    // Cloud polling every 1000ms
    const poll = async () => {
      if (this.isDestroyed) return;
      try {
        const res = await fetch(CLOUD_SYNC_URL);
        if (res.ok) {
          const json = await res.json();
          const d = json.data;
          if (d && d.tvUpdatedAt && d.tvUpdatedAt > this.lastTvUpdate) {
            this.lastTvUpdate = d.tvUpdatedAt;
            this.onStatusChange("connected");
            this.onMessage({
              type: "SYNC_FROM_TV",
              roundNumber: d.roundNumber,
              roundId: d.roundId,
              phase: d.phase,
              t: d.tvT,
              bets: d.bets || {},
              pool: d.pool || 0,
              winner: d.winner,
              forcedWinner: d.forcedWinner,
              agentBalance: d.agentBalance ?? 1000,
              totalTurnover: d.totalTurnover ?? 0,
              totalPayouts: d.totalPayouts ?? 0,
              houseProfit: d.houseProfit ?? 0,
              profitPercentage: d.profitPercentage ?? 100,
            });
          }
        }
      } catch {}
    };

    poll();
    this.pollInterval = setInterval(poll, 1000);
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

    // Send action to Cloud REST store
    const cloudPayload: any = {
      adminUpdatedAt: Date.now(),
    };
    if (msg.type === "FORCE_WINNER") {
      cloudPayload.forcedWinner = msg.card;
    } else if (msg.type === "TRIGGER_SPIN") {
      cloudPayload.triggerSpin = Date.now();
    } else if (msg.type === "CLEAR_ALL_BETS") {
      cloudPayload.clearBets = Date.now();
      cloudPayload.bets = {};
    } else if (msg.type === "RECHARGE_AGENT") {
      cloudPayload.rechargeAgent = msg.amount;
    } else if (msg.type === "RESET_FINANCIALS") {
      cloudPayload.resetFinancials = Date.now();
    }

    fetch(CLOUD_SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "sorat_live_arena_sync_v1",
        data: cloudPayload,
      }),
    }).catch(() => {});
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.pollInterval);
    try {
      this.broadcastChannel?.close();
    } catch {}
  }
}
