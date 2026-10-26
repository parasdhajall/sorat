// Realtime communication helper between Smart TV Display and Admin Mobile Phone
// Supports WebRTC (PeerJS) over Wi-Fi/Internet + BroadcastChannel for same-device tabs

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
