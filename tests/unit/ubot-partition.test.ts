import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

type Command = { kind: string; category?: string; op?: string; amount?: number; message?: string };
type Api = {
  parseCommand(text: string): Command;
  propose(state: { buffer: number; extraBills: number }, command: Command, profile: { balance: number; baseBills: number; debt: number }):
    { ok: true; before: Record<string, number>; after: Record<string, number>; next: { buffer: number; extraBills: number } } | { ok: false; message: string };
};

let api: Api;
beforeAll(() => {
  // Run the browser script exactly as the page does: a classic script that sets a global.
  const sandbox: { UBotPartition?: Api } = {};
  runInNewContext(readFileSync(new URL("../../public/ubot-partition.js", import.meta.url), "utf8"), sandbox);
  api = sandbox.UBotPartition as Api;
});

const profile = { balance: 18_500, baseBills: 7_200, debt: 2_800 };
const initial = { buffer: 3_000, extraBills: 0 };

describe("U-Bot partition commands", () => {
  it.each([
    ["Set my emergency buffer to 4,000 baht", { category: "buffer", op: "set", amount: 4000 }],
    ["increase buffer by 500", { category: "buffer", op: "increase", amount: 500 }],
    ["reduce my buffer by 1000 THB", { category: "buffer", op: "decrease", amount: 1000 }],
    ["Reserve 2,000 baht more for bills", { category: "bills", op: "increase", amount: 2000 }],
    ["set bills to 9000", { category: "bills", op: "set", amount: 9000 }],
    ["add 500 to my buffer", { category: "buffer", op: "increase", amount: 500 }],
  ])("parses %s", (text, expected) => {
    expect(api.parseCommand(text)).toEqual({ kind: "change", ...expected });
  });

  it.each([
    ["ตั้งเงินสำรองฉุกเฉินเป็น 4000 บาท", { category: "buffer", op: "set", amount: 4000 }],
    ["ตั้งเงินสำรองฉุกเฉินเป็น ๔๐๐๐ บาท", { category: "buffer", op: "set", amount: 4000 }],
    ["เพิ่มเงินสำรอง 500 บาท", { category: "buffer", op: "increase", amount: 500 }],
    ["ลดเงินสำรอง 1,000 บาท", { category: "buffer", op: "decrease", amount: 1000 }],
    ["กันเงินค่าบิลเพิ่ม 2000 บาท", { category: "bills", op: "increase", amount: 2000 }],
    ["Set my emergency buffer to 4000 baht.", { category: "buffer", op: "set", amount: 4000 }],
  ])("parses spoken command %s", (text, expected) => {
    expect(api.parseCommand(text)).toEqual({ kind: "change", ...expected });
  });

  it("asks for an amount when a Thai command has none", () => {
    expect(api.parseCommand("ตั้งเงินสำรองฉุกเฉิน").kind).toBe("clarify");
  });

  it("leaves ordinary questions to the Q&A helper", () => {
    for (const q of ["What is the buffer?", "Is this real money?", "What is safe-to-spend?", "How is must keep calculated?"]) {
      expect(api.parseCommand(q).kind).toBe("none");
    }
  });

  it.each([
    ["set my buffer to 100 USD", /Thai baht only/],
    ["set buffer", /How much/],
    ["set buffer to 4000 and bills to 9000", /more than one amount/],
    ["set my debt to 0", /Debt payments/],
    ["increase safe-to-spend by 1000", /calculated, not set/],
    ["set buffer to 4000.5", /whole baht/],
  ])("asks for clarification on %s", (text, pattern) => {
    const result = api.parseCommand(text);
    expect(result.kind).toBe("clarify");
    expect(result.message).toMatch(pattern);
  });

  it("recognises undo and reset", () => {
    expect(api.parseCommand("undo").kind).toBe("undo");
    expect(api.parseCommand("reset partition").kind).toBe("reset");
  });
});

describe("U-Bot partition proposals", () => {
  it("shows before and after for a buffer change without touching the input state", () => {
    const state = { ...initial };
    const result = api.propose(state, api.parseCommand("set my emergency buffer to 4000"), profile);
    expect(result).toEqual({
      ok: true,
      before: { buffer: 3000, bills: 7200, mustKeep: 10000, safeToSpendEstimate: 5500 },
      after: { buffer: 4000, bills: 7200, mustKeep: 10000, safeToSpendEstimate: 4500 },
      next: { buffer: 4000, extraBills: 0 },
    });
    expect(state).toEqual(initial);
  });

  it("reserves more for bills as an extra on top of scheduled bills", () => {
    const result = api.propose(initial, api.parseCommand("reserve 2,000 baht more for bills"), profile);
    expect(result.ok && result.next).toEqual({ buffer: 3000, extraBills: 2000 });
    expect(result.ok && result.after.mustKeep).toBe(12000);
  });

  it.each([
    ["reduce buffer by 5000", /below ฿0/],
    ["set bills to 5000", /below your scheduled ฿7,200/],
    ["set buffer to 9000", /more than your ฿18,500 balance/],
    ["set buffer to 3000", /already your current setting/],
  ])("rejects %s", (text, pattern) => {
    const result = api.propose(initial, api.parseCommand(text), profile);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(pattern);
  });
});
