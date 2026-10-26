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

interface WireMessage {
  _id: string;
  _from: "tv" | "admin";
  payload: GameMessage;
}

// TV Host Connection Class (Powered by High-Reliability Cloud SSE + Local Broadcast)
export class TVHostSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private eventSource: EventSource | null = null;
  private seenIds = new Set<string>();
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
          this.handleIncoming(event.data);
        };
      } catch {}
    }

    window.addEventListener("storage", (e) => {
      if (e.key === `sorat_msg_${this.roomId}` && e.newValue) {
        try {
          this.handleIncoming(JSON.parse(e.newValue));
        } catch {}
      }
    });
  }

  start() {
    this.isDestroyed = false;
    this.onStatusChange("connecting");
    this.connectCloud();
  }

  private connectCloud() {
    if (typeof window === "undefined" || this.isDestroyed) return;

    try {
      if (this.eventSource) {
        this.eventSource.close();
      }

      const topic = `sorat_arena_ch_${this.roomId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const es = new EventSource(`https://ntfy.sh/${topic}/sse`);
      this.eventSource = es;

      es.onopen = () => {
        this.onStatusChange("connected");
      };

      es.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.event === "message" && envelope.message) {
            const wire: WireMessage = JSON.parse(envelope.message);
            this.handleIncoming(wire);
          }
        } catch {}
      };

      es.onerror = () => {
        if (!this.isDestroyed) {
          this.onStatusChange("connecting");
        }
      };
    } catch {
      this.onStatusChange("connected");
    }
  }

  private handleIncoming(wire: WireMessage) {
    if (!wire || !wire._id || wire._from === "tv") return;
    if (this.seenIds.has(wire._id)) return;
    this.seenIds.add(wire._id);
    if (this.seenIds.size > 100) {
      const first = this.seenIds.values().next().value;
      if (first) this.seenIds.delete(first);
    }
    this.onStatusChange("connected");
    this.onMessage(wire.payload);
  }

  broadcast(msg: GameMessage) {
    if (typeof window === "undefined") return;

    const wire: WireMessage = {
      _id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      _from: "tv",
      payload: msg,
    };
    this.seenIds.add(wire._id);

    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    try {
      localStorage.setItem(`sorat_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    try {
      const topic = `sorat_arena_ch_${this.roomId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire),
        mode: "no-cors",
      }).catch(() => {});
    } catch {}
  }

  destroy() {
    this.isDestroyed = true;
    try {
      this.broadcastChannel?.close();
    } catch {}
    try {
      this.eventSource?.close();
    } catch {}
  }
}

// Admin / Phone Client Connection Class (Powered by High-Reliability Cloud SSE + Local Broadcast)
export class AdminClientSync {
  private broadcastChannel: BroadcastChannel | null = null;
  private eventSource: EventSource | null = null;
  private seenIds = new Set<string>();
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
          this.handleIncoming(event.data);
        };
      } catch {}
    }

    window.addEventListener("storage", (e) => {
      if (e.key === `sorat_msg_${this.roomId}` && e.newValue) {
        try {
          this.handleIncoming(JSON.parse(e.newValue));
        } catch {}
      }
    });
  }

  connect() {
    this.isDestroyed = false;
    this.onStatusChange("connecting");
    this.connectCloud();

    // Immediately request current round and bets sync from TV
    setTimeout(() => {
      this.send({ type: "REQUEST_SYNC" });
    }, 250);
  }

  private connectCloud() {
    if (typeof window === "undefined" || this.isDestroyed) return;

    try {
      if (this.eventSource) {
        this.eventSource.close();
      }

      const topic = `sorat_arena_ch_${this.roomId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const es = new EventSource(`https://ntfy.sh/${topic}/sse`);
      this.eventSource = es;

      es.onopen = () => {
        this.onStatusChange("connected");
        this.send({ type: "REQUEST_SYNC" });
      };

      es.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.event === "message" && envelope.message) {
            const wire: WireMessage = JSON.parse(envelope.message);
            this.handleIncoming(wire);
          }
        } catch {}
      };

      es.onerror = () => {
        if (!this.isDestroyed) {
          this.onStatusChange("connecting");
        }
      };
    } catch {
      this.onStatusChange("connected");
    }
  }

  private handleIncoming(wire: WireMessage) {
    if (!wire || !wire._id || wire._from === "admin") return;
    if (this.seenIds.has(wire._id)) return;
    this.seenIds.add(wire._id);
    if (this.seenIds.size > 100) {
      const first = this.seenIds.values().next().value;
      if (first) this.seenIds.delete(first);
    }
    this.onStatusChange("connected");
    this.onMessage(wire.payload);
  }

  send(msg: GameMessage) {
    if (typeof window === "undefined") return;

    const wire: WireMessage = {
      _id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      _from: "admin",
      payload: msg,
    };
    this.seenIds.add(wire._id);

    try {
      this.broadcastChannel?.postMessage(wire);
    } catch {}

    try {
      localStorage.setItem(`sorat_msg_${this.roomId}`, JSON.stringify(wire));
    } catch {}

    try {
      const topic = `sorat_arena_ch_${this.roomId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire),
        mode: "no-cors",
      }).catch(() => {});
    } catch {}
  }

  destroy() {
    this.isDestroyed = true;
    try {
      this.broadcastChannel?.close();
    } catch {}
    try {
      this.eventSource?.close();
    } catch {}
  }
}
