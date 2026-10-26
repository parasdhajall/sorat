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

export type GameMessage =
  | { type: "ADD_BET"; card: number; amount: number }
  | { type: "SUB_BET"; card: number; amount: number }
  | { type: "CLEAR_CARD"; card: number }
  | { type: "CLEAR_ALL_BETS" }
  | { type: "SET_STRATEGY"; mode: "house_profit" | "player_win" | "manual" }
  | { type: "FORCE_WINNER"; card: number | null }
  | { type: "TRIGGER_SPIN" }
  | { type: "RESET_ROUND" }
  | {
      type: "SYNC_FROM_TV";
      roundNumber: number;
      roundId: string;
      phase: "bet" | "select" | "result";
      t: number;
      bets: Record<number, number>;
      pool: number;
      winner: number | null;
      strategy: "house_profit" | "player_win" | "manual";
      forcedWinner: number | null;
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
            if (d.strategy) {
              this.onMessage({ type: "SET_STRATEGY", mode: d.strategy });
            }
            if (d.triggerSpin) {
              this.onMessage({ type: "TRIGGER_SPIN" });
            }
            if (d.clearBets) {
              this.onMessage({ type: "CLEAR_ALL_BETS" });
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

    // When TV state changes (bets, phase, t, winner):
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
            strategy: msg.strategy,
            forcedWinner: msg.forcedWinner,
            tvT: msg.t,
            phase: msg.phase,
            roundNumber: msg.roundNumber,
            roundId: msg.roundId,
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
              strategy: d.strategy || "house_profit",
              forcedWinner: d.forcedWinner,
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
      cloudPayload.strategy = "manual";
    } else if (msg.type === "SET_STRATEGY") {
      cloudPayload.strategy = msg.mode;
      if (msg.mode !== "manual") cloudPayload.forcedWinner = null;
    } else if (msg.type === "TRIGGER_SPIN") {
      cloudPayload.triggerSpin = Date.now();
    } else if (msg.type === "CLEAR_ALL_BETS") {
      cloudPayload.clearBets = Date.now();
      cloudPayload.bets = {};
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
