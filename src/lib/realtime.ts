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

// Dynamically load PeerJS CDN script if not present
export function loadPeerJS(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve(null);
    if ((window as any).Peer) return resolve((window as any).Peer);

    const existing = document.getElementById("peerjs-script");
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).Peer));
      return;
    }

    const script = document.createElement("script");
    script.id = "peerjs-script";
    script.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
    script.async = true;
    script.onload = () => resolve((window as any).Peer);
    script.onerror = () => reject(new Error("PeerJS script failed to load"));
    document.head.appendChild(script);
  });
}

// TV Host Connection Class
export class TVHostSync {
  private peer: any = null;
  private connections: any[] = [];
  private broadcastChannel: BroadcastChannel | null = null;
  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "waiting" | "disconnected", peerId?: string) => void = () => {};

  constructor(public roomId = DEFAULT_ROOM_ID) {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.broadcastChannel = new BroadcastChannel(`sorat_channel_${roomId}`);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data) this.onMessage(event.data);
      };
    }
  }

  async start() {
    this.onStatusChange("connecting");
    try {
      const Peer = await loadPeerJS();
      if (!Peer) {
        this.onStatusChange("waiting");
        return;
      }

      const hostPeerId = `tv-${this.roomId}`;
      this.peer = new Peer(hostPeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      });

      this.peer.on("open", (id: string) => {
        this.onStatusChange("waiting", id);
      });

      this.peer.on("connection", (conn: any) => {
        this.connections.push(conn);
        this.onStatusChange("connected");

        conn.on("data", (data: any) => {
          this.onMessage(data);
        });

        conn.on("close", () => {
          this.connections = this.connections.filter((c) => c !== conn);
          if (this.connections.length === 0) {
            this.onStatusChange("waiting");
          }
        });
      });

      this.peer.on("error", (err: any) => {
        // If peer ID is taken or network issue, continue with local channel
        console.warn("PeerJS host warning:", err);
      });
    } catch (e) {
      console.warn("PeerJS load failed, using local channel:", e);
      this.onStatusChange("waiting");
    }
  }

  broadcast(msg: GameMessage) {
    // Send to local BroadcastChannel (same computer tabs)
    try {
      this.broadcastChannel?.postMessage(msg);
    } catch {}

    // Send via WebRTC to all connected mobile phone operators
    for (const conn of this.connections) {
      try {
        if (conn && conn.open) conn.send(msg);
      } catch {}
    }
  }

  destroy() {
    this.broadcastChannel?.close();
    for (const conn of this.connections) {
      try {
        conn.close();
      } catch {}
    }
    this.peer?.destroy();
  }
}

// Admin / Phone Client Connection Class
export class AdminClientSync {
  private peer: any = null;
  private conn: any = null;
  private broadcastChannel: BroadcastChannel | null = null;
  public onMessage: (msg: GameMessage) => void = () => {};
  public onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void = () => {};

  constructor(public roomId = DEFAULT_ROOM_ID) {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.broadcastChannel = new BroadcastChannel(`sorat_channel_${roomId}`);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data) {
          this.onMessage(event.data);
          this.onStatusChange("connected");
        }
      };
    }
  }

  async connect() {
    this.onStatusChange("connecting");
    try {
      const Peer = await loadPeerJS();
      if (!Peer) return;

      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      });

      this.peer.on("open", () => {
        const targetId = `tv-${this.roomId}`;
        this.conn = this.peer.connect(targetId, { reliable: true });

        this.conn.on("open", () => {
          this.onStatusChange("connected");
        });

        this.conn.on("data", (data: any) => {
          this.onMessage(data);
        });

        this.conn.on("close", () => {
          this.onStatusChange("disconnected");
        });
      });

      this.peer.on("error", (err: any) => {
        console.warn("PeerJS admin client error:", err);
        this.onStatusChange("disconnected");
      });
    } catch (e) {
      console.warn("PeerJS connect failed:", e);
      this.onStatusChange("disconnected");
    }
  }

  send(msg: GameMessage) {
    // Send to local BroadcastChannel
    try {
      this.broadcastChannel?.postMessage(msg);
    } catch {}

    // Send to TV via WebRTC
    try {
      if (this.conn && this.conn.open) {
        this.conn.send(msg);
      }
    } catch {}
  }

  destroy() {
    this.broadcastChannel?.close();
    try {
      this.conn?.close();
    } catch {}
    this.peer?.destroy();
  }
}
