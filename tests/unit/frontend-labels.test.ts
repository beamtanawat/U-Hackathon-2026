import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../public/u-topia-handshake.html", import.meta.url), "utf8");

describe("simulated U-Bot disclosure", () => {
  it("names the simulation and discloses its real provider order", () => {
    expect(html).toContain("U-Bot Simulation");
    expect(html).toContain("Jev Primary · Qwen Secondary · No official U-Bot API");
  });
});
