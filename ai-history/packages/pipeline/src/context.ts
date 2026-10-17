import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
  Bible,
  ClaimsFile,
  DocumentsFile,
  EntitiesFile,
  GlossaryFile,
  MetaFile,
  Production,
  Skeleton,
  Strings,
  type Claim,
  type Shot,
} from "@ai-history/schemas";
import { createLogger, readJson, type Logger } from "./lib/util";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface Episode {
  id: string;
  dir: string;
  buildDir: string;
  bible: Bible;
  skeleton: Skeleton;
  claims: Map<string, Claim>;
  documents: z.infer<typeof DocumentsFile>;
  production: Production;
  strings: Record<string, Strings>;
  meta: Record<string, MetaFile>;
  scripts: Record<string, string>;
  // every language that has a script file
  languages: string[];
  // languages requested on the command line
  langs: string[];
  // shots requested on the command line, in skeleton order
  selection: string[];
  log: Logger;
}

export class DataError extends Error {}

function load<T extends z.ZodType>(file: string, schema: T, problems: string[]): z.infer<T> {
  if (!fs.existsSync(file)) {
    problems.push(`${path.relative(ROOT, file)}: file missing`);
    return undefined as z.infer<T>;
  }
  let raw: unknown;
  try {
    raw = readJson(file);
  } catch (e) {
    problems.push(`${path.relative(ROOT, file)}: invalid JSON (${(e as Error).message})`);
    return undefined as z.infer<T>;
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    for (const issue of res.error.issues) problems.push(`${path.relative(ROOT, file)}: ${issue.path.join(".") || "<root>"}: ${issue.message}`);
    return undefined as z.infer<T>;
  }
  return res.data;
}

export function findEpisodeDir(epId: string): string {
  const episodes = path.join(ROOT, "episodes");
  const match = fs.readdirSync(episodes).find((d) => d === epId || d.startsWith(`${epId}-`));
  if (!match) throw new DataError(`episode ${epId} not found under episodes/`);
  return path.join(episodes, match);
}

export function parseShotSelection(spec: string | undefined, shots: Shot[]): string[] {
  const ids = shots.map((s) => s.id);
  if (!spec || spec === "all") return ids;
  const picked = new Set<string>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-");
    const i = ids.indexOf(a);
    const j = b ? ids.indexOf(b) : i;
    if (i < 0 || j < 0 || j < i) throw new DataError(`bad --shots "${spec}" (known: ${ids.join(",")})`);
    ids.slice(i, j + 1).forEach((id) => picked.add(id));
  }
  const sel = ids.filter((id) => picked.has(id));
  // a selection must be contiguous so the timeline has no holes
  const first = ids.indexOf(sel[0]);
  if (sel.some((id, k) => ids.indexOf(id) !== first + k)) throw new DataError(`--shots must select a contiguous range`);
  return sel;
}

export function loadEpisode(epId: string, opts: { lang?: string; shots?: string; logName?: string } = {}): Episode {
  const dir = findEpisodeDir(epId);
  const buildDir = path.join(dir, "build");
  const problems: string[] = [];
  const series = path.join(ROOT, "series");

  const bible = load(path.join(series, "bible.json"), Bible, problems);
  const claimsFile = load(path.join(series, "claims.json"), ClaimsFile, problems);
  load(path.join(series, "entities.json"), EntitiesFile, problems);
  load(path.join(series, "glossary.json"), GlossaryFile, problems);
  const skeleton = load(path.join(dir, "skeleton.json"), Skeleton, problems);
  const documents = load(path.join(dir, "documents.json"), DocumentsFile, problems);
  const production = load(path.join(dir, "production.json"), Production, problems);

  const languages = fs
    .readdirSync(dir)
    .map((f) => /^script\.([a-z]{2}(?:-[A-Za-z]+)?)\.txt$/.exec(f)?.[1])
    .filter((l): l is string => !!l)
    .sort();
  const strings: Record<string, Strings> = {};
  const meta: Record<string, MetaFile> = {};
  const scripts: Record<string, string> = {};
  for (const lang of languages) {
    strings[lang] = load(path.join(dir, `strings.${lang}.json`), Strings, problems);
    meta[lang] = load(path.join(dir, `meta.${lang}.json`), MetaFile, problems);
    scripts[lang] = fs.readFileSync(path.join(dir, `script.${lang}.txt`), "utf8");
  }
  if (problems.length) throw new DataError(`schema validation failed:\n  - ${problems.join("\n  - ")}`);

  const requested = !opts.lang || opts.lang === "all" ? languages : opts.lang.split(",");
  for (const l of requested) if (!languages.includes(l)) throw new DataError(`no script.${l}.txt in ${path.relative(ROOT, dir)}`);

  const claims = new Map(claimsFile.claims.map((c) => [c.id, c]));
  const log = createLogger(path.join(buildDir, "logs", `${opts.logName ?? "run"}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`));
  return {
    id: skeleton.episode,
    dir,
    buildDir,
    bible,
    skeleton,
    claims,
    documents,
    production,
    strings,
    meta,
    scripts,
    languages,
    langs: requested,
    selection: parseShotSelection(opts.shots, skeleton.shots),
    log,
  };
}

// cue -> shot that contains it (a shot runs from its startCue to the next shot's startCue)
export function shotOfCue(skeleton: Skeleton): Map<string, Shot> {
  const map = new Map<string, Shot>();
  const starts = new Map(skeleton.shots.map((s) => [s.startCue, s]));
  let current: Shot | undefined;
  for (const cue of skeleton.cueOrder) {
    current = starts.get(cue) ?? current;
    if (current) map.set(cue, current);
  }
  return map;
}

export function selectionTag(ep: Episode): string {
  const all = ep.skeleton.shots.map((s) => s.id);
  return ep.selection.length === all.length ? "" : `.${ep.selection[0]}-${ep.selection[ep.selection.length - 1]}`;
}

export function langBuildDir(ep: Episode, lang: string): string {
  return path.join(ep.buildDir, lang);
}
