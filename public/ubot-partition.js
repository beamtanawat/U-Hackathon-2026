/*
 * U-Bot Simulation: deterministic Wallet Partition commands.
 *
 * No LLM is involved. This parser turns a small documented set of phrases
 * into a proposed change; nothing changes until the user confirms, and the
 * Safe-to-Pay API stays the only source of financial status.
 *
 * Supported (THB only):
 *   set (my emergency) buffer to N
 *   increase | add | raise buffer by N      decrease | reduce | lower buffer by N
 *   reserve N (more) for bills              set bills (reserve) to N
 *   reduce bills (reserve) by N             undo                 reset partition
 */
(function (root) {
  "use strict";

  var MAX_AMOUNT = 1000000;
  var EXAMPLES = ["Set my emergency buffer to 4,000 baht", "Reserve 2,000 baht more for bills", "Undo", "Reset partition"];

  var CATEGORY = {
    buffer: /\b(emergency\s+)?buffer\b|กันชน|เงินสำรอง/,
    bills: /\bbills?\b|\brent\b|\butilit(y|ies)\b|ค่าบิล|บิล/,
  };
  var READ_ONLY = {
    debt: /\bdebt\b|\bbnpl\b|\bloan\b|\bcard\b|หนี้/,
    spend: /safe[\s-]*to[\s-]*spend|available\s+to\s+spend/,
    crypto: /\busdc\b|\bcrypto\b|\btoken\b/,
    balance: /\bbalance\b/,
  };
  var FOREIGN = /\busdc?\b|\busd\b|\$|dollar|\beth\b|\bbtc\b|\beur\b|€/;
  var INCREASE = /\b(increase|add|raise|more|reserve|top\s*up|bump)\b|เพิ่ม/;
  var DECREASE = /\b(decrease|reduce|lower|less|remove|cut|drop)\b|ลด/;
  var SET = /\b(set|make|change|update)\b|ตั้ง/;

  function numbers(text) {
    var found = text.match(/\d[\d,]*(\.\d+)?/g) || [];
    return found.map(function (n) { return Number(n.replace(/,/g, "")); });
  }

  /**
   * @returns {{kind:"none"} | {kind:"undo"} | {kind:"reset"} |
   *   {kind:"clarify", message:string, examples:string[]} |
   *   {kind:"change", category:"buffer"|"bills", op:"set"|"increase"|"decrease", amount:number}}
   */
  function parseCommand(input) {
    var text = String(input || "").toLowerCase().trim();
    if (!text) return { kind: "none" };
    if (/^(undo|undo (that|last change)|ย้อนกลับ)\.?$/.test(text)) return { kind: "undo" };
    if (/\breset\b.*\b(partition|buffer|bills|wallet)\b|^reset\.?$|รีเซ็ต/.test(text)) return { kind: "reset" };

    var category = CATEGORY.buffer.test(text) ? "buffer" : CATEGORY.bills.test(text) ? "bills" : null;
    var nums = numbers(text);
    var hasVerb = INCREASE.test(text) || DECREASE.test(text) || SET.test(text) || /\bto\s+[฿]?\d/.test(text);
    var readOnly = Object.keys(READ_ONLY).filter(function (k) { return READ_ONLY[k].test(text); });

    // Plain questions ("what is my buffer?") are not partition commands.
    if (!category && !(readOnly.length && hasVerb && nums.length)) return { kind: "none" };
    if (category && !hasVerb && !nums.length) return { kind: "none" };

    if (!category) {
      return clarify("I can only change your emergency buffer or the money reserved for bills. " +
        (readOnly[0] === "crypto" ? "Crypto holdings are shown separately and are not part of the partition." :
         readOnly[0] === "debt" ? "Debt payments come from your wallet and can't be edited here." :
         "Safe-to-spend and your balance are calculated, not set directly."));
    }
    if (FOREIGN.test(text)) return clarify("Partition changes are in Thai baht only. No exchange rate is applied.");
    if (nums.length === 0) return clarify("How much? Please include an amount in baht.");
    if (nums.length > 1) return clarify("I found more than one amount. Please give one amount at a time.");
    var amount = nums[0];
    if (!Number.isInteger(amount)) return clarify("Please use a whole baht amount.");

    var up = INCREASE.test(text), down = DECREASE.test(text);
    var toTarget = /\bto\s+[฿]?\s*\d/.test(text) || (SET.test(text) && !up && !down);
    var op = toTarget ? "set" : up && !down ? "increase" : down && !up ? "decrease" : null;
    if (!op) return clarify("Should I set, increase, or decrease it?");
    return { kind: "change", category: category, op: op, amount: amount };
  }

  function clarify(message) { return { kind: "clarify", message: message, examples: EXAMPLES.slice() }; }

  /**
   * Validates a change against the current simulated partition.
   * state:   {buffer, extraBills}
   * profile: {balance, baseBills, debt}
   * Returns {ok:true, before, after, next} or {ok:false, message}.
   * Only the safe-to-spend figure is an estimate; the API decides status.
   */
  function propose(state, command, profile) {
    var next = { buffer: state.buffer, extraBills: state.extraBills };
    var bills = profile.baseBills + state.extraBills;
    if (command.category === "buffer") {
      next.buffer = command.op === "set" ? command.amount
        : command.op === "increase" ? state.buffer + command.amount : state.buffer - command.amount;
      if (next.buffer < 0) return { ok: false, message: "The buffer can't go below ฿0." };
    } else {
      var target = command.op === "set" ? command.amount
        : command.op === "increase" ? bills + command.amount : bills - command.amount;
      if (target < profile.baseBills) {
        return { ok: false, message: "Bills can't go below your scheduled ฿" + profile.baseBills.toLocaleString("en-US") + "." };
      }
      next.extraBills = target - profile.baseBills;
    }
    if (next.buffer > MAX_AMOUNT || next.extraBills > MAX_AMOUNT) return { ok: false, message: "That amount is too large for this simulation." };
    if (next.buffer === state.buffer && next.extraBills === state.extraBills) return { ok: false, message: "That's already your current setting." };
    var reserved = profile.baseBills + next.extraBills + profile.debt + next.buffer;
    if (reserved > profile.balance) {
      return { ok: false, message: "That would reserve ฿" + reserved.toLocaleString("en-US") + ", more than your ฿" + profile.balance.toLocaleString("en-US") + " balance." };
    }
    return { ok: true, before: summary(state, profile), after: summary(next, profile), next: next };
  }

  function summary(state, profile) {
    var bills = profile.baseBills + state.extraBills;
    var mustKeep = bills + profile.debt;
    return { buffer: state.buffer, bills: bills, mustKeep: mustKeep, safeToSpendEstimate: Math.max(0, profile.balance - mustKeep - state.buffer) };
  }

  root.UBotPartition = { parseCommand: parseCommand, propose: propose, summary: summary, EXAMPLES: EXAMPLES };
})(typeof globalThis !== "undefined" ? globalThis : this);
