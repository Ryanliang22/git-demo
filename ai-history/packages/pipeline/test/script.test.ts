import { describe, expect, it } from "vitest";
import { parseScript } from "../src/lib/script";

describe("parseScript", () => {
  it("parses beats, cues, text and claim references", () => {
    const { lines, errors } = parseScript("## B2\n{#y1936} 1936年，现代计算机还不存在。 [[C03]]\n{#tape_appears} 一条无限长的纸带， [[C01,C04]]\n{#x} 我。 [[N]]\n");
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.beat, l.cue, l.text, l.claims])).toEqual([
      ["B2", "y1936", "1936年，现代计算机还不存在。", ["C03"]],
      ["B2", "tape_appears", "一条无限长的纸带，", ["C01", "C04"]],
      ["B2", "x", "我。", []],
    ]);
  });

  it("rejects lines without a claim reference, without a cue, or mixing N with IDs", () => {
    const { errors } = parseScript("## B1\n{#a} no refs\nplain text [[N]]\n{#b} mixed [[N,C01]]\n{#c} empty [[]]\n");
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/line 2: missing trailing/);
    expect(errors[1]).toMatch(/line 3: does not start/);
  });

  it("requires a beat header before the first cue", () => {
    expect(parseScript("{#a} text [[N]]").errors[0]).toMatch(/before any "## B<n>"/);
  });
});
