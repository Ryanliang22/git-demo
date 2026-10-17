import { describe, expect, it } from "vitest";
import { encodeProgram, finalConfig, getProgram, initialConfig, programs, readTape, run, step } from "../src/signature/turing/sim";

const bin = (n: number) => n.toString(2);

describe("binary_increment (fact gate: S02 must compute correctly)", () => {
  const p = getProgram("binary_increment");

  it("adds one to every number from 0 to 4095", () => {
    for (let n = 0; n <= 4095; n++) {
      expect(readTape(finalConfig(p, bin(n))), `n=${n}`).toBe(bin(n + 1));
    }
  });

  it("keeps leading zeros and stops at the first 0", () => {
    expect(readTape(finalConfig(p, "0111"))).toBe("1000");
    expect(readTape(finalConfig(p, "0010"))).toBe("0011");
  });

  it("is correct at every single step for the S02 input 1011", () => {
    const steps = run(p, "1011", 100);
    expect(steps.map((s) => p.rules[s.rule]).map((r) => `${r.state}:${r.read}->${r.write}${r.move}:${r.next}`)).toEqual([
      "carry:1->0L:carry",
      "carry:1->0L:carry",
      "carry:0->1L:done",
    ]);
    expect(steps.map((s) => readTape(s.after))).toEqual(["1010", "1000", "1100"]);
    expect(steps.map((s) => s.after.head)).toEqual([2, 1, 0]);
    expect(step(p, steps[steps.length - 1].after)).toBeNull();
  });

  it("starts on the rightmost bit", () => {
    expect(initialConfig(p, "1011").head).toBe(3);
  });
});

describe("binary_counter (S10)", () => {
  it("counts up by one on each pass", () => {
    const p = getProgram("binary_counter");
    let c = initialConfig(p, "1011");
    const seen: string[] = [];
    for (let i = 0; i < 400 && seen.length < 20; i++) {
      const s = step(p, c)!;
      if (s.before.state === "carry" && s.after.state === "seek") seen.push(readTape(s.after));
      c = s.after;
    }
    expect(seen).toEqual(Array.from({ length: 20 }, (_, k) => bin(11 + k + 1)));
  });
});

describe("guest machines (S03)", () => {
  it("bit_invert flips every bit", () => {
    expect(readTape(finalConfig(getProgram("bit_invert"), "1011"))).toBe("0100");
  });
  it("unary_add adds", () => {
    for (let a = 1; a < 6; a++) for (let b = 1; b < 6; b++) expect(readTape(finalConfig(getProgram("unary_add"), "1".repeat(a) + "0" + "1".repeat(b)))).toBe("1".repeat(a + b));
  });
});

describe("rule tables use symbols only", () => {
  it("moves are only L/R and every state has a color slot", () => {
    for (const p of Object.values(programs)) {
      for (const r of p.rules) {
        expect(["L", "R"]).toContain(r.move);
        expect(p.states).toContain(r.state);
        expect(p.states).toContain(r.next);
      }
      expect(p.states.length).toBeLessThanOrEqual(3);
    }
  });
  it("encodes a rule table into 5 glyphs per rule plus separators", () => {
    const p = getProgram("bit_invert");
    const g = encodeProgram(p);
    expect(g.length).toBe(p.rules.length * 5 + p.rules.length - 1);
    expect(g[0]).toEqual({ kind: "state", state: "flip", index: 0, halt: false });
  });
});
