import { describe, it, expect } from "vitest";
import { broadcastLiveRamuSnapshot } from "./broadcastSimulationToCloud";

describe("Cloud Live Broadcast", () => {
  it("broadcasts live Ramu snapshot to ntfy cloud topic", async () => {
    const ok = await broadcastLiveRamuSnapshot();
    expect(ok).toBe(true);
  });
});
