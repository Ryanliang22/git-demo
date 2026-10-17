import { describe, expect, it } from "vitest";
import { layoutCaption, lineWidth } from "../src/lib/linebreak";

const zh = { maxLineChars: 16, unit: "char" as const, dropLineEndPunct: "，。、；：" };
const en = { maxLineChars: 32, unit: "word" as const, dropLineEndPunct: "" };

describe("caption layout", () => {
  it("keeps zh lines within 16 chars and drops line-end punctuation", () => {
    const blocks = layoutCaption("七十多年前，有人认真地问：机器，能思考吗？", zh, 2);
    expect(blocks).toEqual([["七十多年前，有人认真地问", "机器，能思考吗？"]]);
  });

  it("splits long zh segments into several blocks at punctuation", () => {
    const blocks = layoutCaption("他还写道：与其造一个成年人的头脑，不如造一个孩子的，再去教它。", zh, 2);
    for (const b of blocks) {
      expect(b.length).toBeLessThanOrEqual(2);
      for (const l of b) expect(lineWidth(l)).toBeLessThanOrEqual(16);
    }
    const bare = (t: string) => t.replace(/[，。、；：]/g, "");
    expect(bare(blocks.flat().join(""))).toBe(bare("他还写道：与其造一个成年人的头脑，不如造一个孩子的，再去教它。"));
  });

  it("keeps quotes attached and digits whole", () => {
    const lines = layoutCaption('又过了一年，"人工智能"这个词才第一次出现。', zh, 2).flat();
    expect(lines.join("|")).toContain('"人工智能"');
    expect(layoutCaption("1936年，现代计算机还不存在。", zh, 2)).toEqual([["1936年，现代计算机还不存在"]]);
  });

  it("wraps en at word boundaries within 32 chars, at most 2 lines per block", () => {
    const text = "His paper ends: \"We can only see a short distance ahead, but we can see plenty there that needs to be done.\"";
    const blocks = layoutCaption(text, en, 2);
    for (const b of blocks) {
      expect(b.length).toBeLessThanOrEqual(2);
      for (const l of b) expect(l.length).toBeLessThanOrEqual(32);
    }
    expect(blocks.flat().join(" ")).toBe(text);
  });
});
