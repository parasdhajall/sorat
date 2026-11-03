import { describe, it, expect } from "vitest";
import { generateSimulationFile } from "./generateRamuData";

describe("Ramu 5000 Balance Exhaustion Simulation Generator", () => {
  it("generates ramuSimulationData.ts with exactly 5000 turnover and 0 final balance", () => {
    const res = generateSimulationFile();
    expect(res.cumulativeTurnover).toBe(5000);
    expect(res.runningBalance).toBe(0);
    expect(res.ramuBets.length).toBeGreaterThan(10);
  });
});
