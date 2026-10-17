import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEpisode, ROOT } from "../src/context";
import { validate } from "../src/stages/validate";

// Each case copies ep001 into a scratch episode, breaks one thing, and expects validate to say so.
const SRC = path.join(ROOT, "episodes/ep001-turing");
const TMP = path.join(ROOT, "episodes/ep998-validate-test");

function scratch(mutate: (dir: string) => void) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP);
  for (const f of fs.readdirSync(SRC)) if (fs.statSync(path.join(SRC, f)).isFile()) fs.copyFileSync(path.join(SRC, f), path.join(TMP, f));
  const skel = JSON.parse(fs.readFileSync(path.join(TMP, "skeleton.json"), "utf8"));
  skel.episode = "ep998";
  fs.writeFileSync(path.join(TMP, "skeleton.json"), JSON.stringify(skel, null, 2));
  mutate(TMP);
  return loadEpisode("ep998");
}
const edit = (dir: string, file: string, fn: (s: string) => string) => fs.writeFileSync(path.join(dir, file), fn(fs.readFileSync(path.join(dir, file), "utf8")));

describe("validate", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("accepts ep001 as shipped, as a DRAFT in M0", async () => {
    const r = await validate(scratch(() => {}));
    expect(r.errors).toEqual([]);
    expect(r.draft).toBe(true);
  });

  it("rejects a script whose cue order differs from the skeleton", async () => {
    const r = await validate(scratch((d) => edit(d, "script.en.txt", (s) => s.replace("{#head_appears}", "{#tmp}").replace("{#rules_appear}", "{#head_appears}").replace("{#tmp}", "{#rules_appear}"))));
    expect(r.errors.join("\n")).toMatch(/script\.en\.txt: cue sequence differs .* position 6/);
  });

  it("rejects a line without a claim reference and an unknown claim", async () => {
    const r = await validate(scratch((d) => edit(d, "script.zh.txt", (s) => s.replace("还不存在。 [[C03]]", "还不存在。").replace("[[C05]]", "[[C99]]"))));
    const all = r.errors.join("\n");
    expect(all).toMatch(/missing trailing \[\[claim IDs\]\]/);
    expect(all).toMatch(/unknown claim C99/);
  });

  it("from M1, refuses pending claims unless Ryan waived them", async () => {
    const r = await validate(scratch((d) => edit(d, "production.json", (s) => s.replace('"M0"', '"M1"'))));
    expect(r.errors.some((e) => /claim C09 is pending/.test(e))).toBe(true);
  });

  it("rejects cue bindings to events a component does not have", async () => {
    const r = await validate(scratch((d) => edit(d, "skeleton.json", (s) => s.replace('"tape_appears": "showTape"', '"tape_appears": "explode"'))));
    expect(r.errors.join("\n")).toMatch(/signature\/TuringMachine has no event "explode"/);
  });

  it("rejects a strings file that lacks a screen-text key", async () => {
    const r = await validate(scratch((d) => edit(d, "strings.en.json", (s) => s.replace('"term_ai": "Artificial Intelligence",', ""))));
    expect(r.errors.join("\n")).toMatch(/strings\.en\.json has no "term_ai"/);
  });
});
