import fs from "node:fs";
import path from "node:path";
import type { Episode } from "./context";
import { ROOT } from "./context";

// Built-in lints for the non-negotiable principles (spec §2), plus the hook for series/rules/.

const COMPONENTS = path.join(ROOT, "packages/components/src");

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

function scan(files: string[], pattern: RegExp, message: string): string[] {
  const out: string[] = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.trim().startsWith("//")) return;
        if (pattern.test(line)) out.push(`${path.relative(ROOT, file)}:${i + 1}: ${message}`);
      });
  }
  return out;
}

export const lints: Record<string, (ep: Episode) => string[]> = {
  // Principle 1: components contain no natural-language text.
  "no-natural-language-in-components": () => {
    const files = sourceFiles(COMPONENTS);
    return [
      ...scan(files, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u, "CJK text in component code"),
      ...scan(files.filter((f) => f.endsWith(".tsx")), />\s*[A-Za-z][A-Za-z ,.'!?-]*\s*<\//, "literal JSX text in component code"),
    ];
  },
  // Visual values live in bible.json: components never hard-code colors.
  "no-literal-colors-in-components": () =>
    scan(
      sourceFiles(COMPONENTS).filter((f) => !f.endsWith(path.join("lib", "color.ts"))),
      /#[0-9a-fA-F]{6}\b|rgba?\(/,
      "literal color in component code (use bible.colors)",
    ),
  // Principle 2: components get event frames, never seconds.
  "no-seconds-in-components": () =>
    scan(
      [...sourceFiles(path.join(COMPONENTS, "grammar")), ...sourceFiles(path.join(COMPONENTS, "signature"))],
      /\bfps\b/,
      "component reads fps; animate from cue events and bible.motion frame counts",
    ),
  // bible.colorRules: e.g. red only in S05–S06.
  "color-rules": (ep) => {
    const out: string[] = [];
    const users = new Map<string, string[]>();
    for (const file of sourceFiles(COMPONENTS)) {
      const src = fs.readFileSync(file, "utf8");
      for (const token of Object.keys(ep.bible.colorRules)) {
        if (src.includes(`colors.${token}`)) {
          const name = path.relative(COMPONENTS, file).replace(/\.tsx?$/, "").split(path.sep).slice(0, 2).join("/");
          users.set(token, [...(users.get(token) ?? []), name]);
        }
      }
    }
    for (const shot of ep.skeleton.shots) {
      const parts = [{ component: shot.component, props: shot.props }, ...(shot.layers ?? [])];
      for (const [token, allowed] of Object.entries(ep.bible.colorRules)) {
        if (allowed.includes(shot.id)) continue;
        for (const p of parts) {
          if (JSON.stringify(p.props).includes(`"${token}"`)) out.push(`${shot.id}: props use color "${token}" (allowed only in ${allowed.join(", ")})`);
          if ((users.get(token) ?? []).includes(p.component)) out.push(`${shot.id}: ${p.component} draws with "${token}" (allowed only in ${allowed.join(", ")})`);
        }
      }
    }
    return out;
  },
};

export function runLints(ep: Episode): { errors: string[]; ran: string[] } {
  const errors: string[] = [];
  for (const [id, lint] of Object.entries(lints)) for (const e of lint(ep)) errors.push(`[lint ${id}] ${e}`);
  // series/rules/*.md: a rule may name a lint in its frontmatter; it must exist.
  const rulesDir = path.join(ROOT, "series/rules");
  for (const f of fs.readdirSync(rulesDir).filter((f) => /^R\d{3}-.*\.md$/.test(f))) {
    const m = /^lint:\s*(\S+)/m.exec(fs.readFileSync(path.join(rulesDir, f), "utf8"));
    if (m && !lints[m[1]]) errors.push(`[rules] ${f} references unknown lint "${m[1]}"`);
  }
  return { errors, ran: Object.keys(lints) };
}
