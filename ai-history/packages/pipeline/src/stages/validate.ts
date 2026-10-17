import path from "node:path";
import { componentSpecs, type Segment } from "@ai-history/schemas";
import { shotOfCue, type Episode } from "../context";
import { runLints } from "../lints";
import { parseScript } from "../lib/script";
import { writeJson } from "../lib/util";

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  // build cites unverified claims: allowed only in M0, with a DRAFT watermark
  draft: boolean;
  citedClaims: string[];
}

const MILESTONE_ORDER = ["M0", "M1", "M2"];

export function citedClaimsFor(ep: Episode, segments: Record<string, Segment[]>): string[] {
  const ids = new Set<string>();
  for (const segs of Object.values(segments)) for (const s of segs) s.claims.forEach((c) => ids.add(c));
  for (const key of Object.values(ep.skeleton.screenText)) {
    if (key.startsWith("doc:")) ep.documents.documents[key.slice(4)]?.claims.forEach((c) => ids.add(c));
  }
  return [...ids].sort();
}

export async function validate(ep: Episode, opts: { forExport?: boolean } = {}): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { skeleton, bible } = ep;
  const cueShot = shotOfCue(skeleton);

  // ---- skeleton consistency ----
  const cueIndex = new Map(skeleton.cueOrder.map((c, i) => [c, i]));
  if (cueIndex.size !== skeleton.cueOrder.length) errors.push("skeleton.cueOrder has duplicate cues");
  if (skeleton.format.width !== bible.canvas.width || skeleton.format.height !== bible.canvas.height || skeleton.format.fps !== bible.canvas.fps)
    errors.push("skeleton.format disagrees with bible.canvas");
  let prev = -1;
  skeleton.shots.forEach((shot, k) => {
    const expectedId = `S${String(k + 1).padStart(2, "0")}`;
    if (shot.id !== expectedId) errors.push(`shot #${k + 1} has id ${shot.id}, expected ${expectedId}`);
    const i = cueIndex.get(shot.startCue);
    if (i === undefined) return errors.push(`${shot.id}: startCue ${shot.startCue} not in cueOrder`);
    if (i <= prev) errors.push(`${shot.id}: startCue ${shot.startCue} is not after the previous shot's startCue`);
    prev = i;
    if (shot.minSec > shot.maxSec) errors.push(`${shot.id}: minSec > maxSec`);
    const parts = [{ component: shot.component, props: shot.props, cueBindings: shot.cueBindings }, ...(shot.layers ?? [])];
    for (const part of parts) {
      const spec = componentSpecs[part.component as keyof typeof componentSpecs];
      if (!spec) {
        errors.push(`${shot.id}: unknown component ${part.component}`);
        continue;
      }
      const res = spec.props.safeParse(part.props);
      if (!res.success) for (const is of res.error.issues) errors.push(`${shot.id}: ${part.component} props.${is.path.join(".")}: ${is.message}`);
      for (const [cue, event] of Object.entries(part.cueBindings)) {
        if (cueShot.get(cue) !== shot) errors.push(`${shot.id}: ${part.component} binds cue ${cue}, which is not inside this shot`);
        if (!(spec.events as readonly string[]).includes(event))
          errors.push(`${shot.id}: ${part.component} has no event "${event}" (has: ${spec.events.join(", ") || "none"})`);
      }
    }
  });
  if (skeleton.shots[0] && skeleton.shots[0].startCue !== skeleton.cueOrder[0]) errors.push("S01 must start at the first cue");

  // ---- screen text: every key resolves in every language ----
  for (const [slot, key] of Object.entries(skeleton.screenText)) {
    if (!skeleton.shots.some((s) => s.id === slot.split(".")[0])) errors.push(`screenText ${slot}: no such shot`);
    if (key.startsWith("doc:")) {
      if (!ep.documents.documents[key.slice(4)]) errors.push(`screenText ${slot}: document ${key} missing from documents.json`);
    } else {
      for (const lang of ep.languages) if (ep.strings[lang][key] === undefined) errors.push(`screenText ${slot}: strings.${lang}.json has no "${key}"`);
    }
  }
  const keySets = ep.languages.map((l) => Object.keys(ep.strings[l]).sort().join(","));
  if (new Set(keySets).size > 1) errors.push(`strings.<lang>.json files have different key sets: ${ep.languages.join(" / ")}`);
  for (const k of ["ai_label", "draft_mark"]) for (const l of ep.languages) if (!ep.strings[l][k]) errors.push(`strings.${l}.json needs "${k}"`);

  // ---- per-language config ----
  for (const lang of ep.languages) {
    if (!bible.languages[lang]) errors.push(`bible.languages has no "${lang}"`);
    if (!bible.voice.narrator[lang]) errors.push(`bible.voice.narrator has no "${lang}"`);
    if (ep.meta[lang].lang !== lang) errors.push(`meta.${lang}.json declares lang ${ep.meta[lang].lang}`);
  }
  for (const doc of Object.values(ep.documents.documents)) for (const c of doc.claims) if (!ep.claims.has(c)) errors.push(`documents.json cites unknown claim ${c}`);

  // ---- scripts ----
  const segments: Record<string, Segment[]> = {};
  for (const lang of ep.languages) {
    const file = `script.${lang}.txt`;
    const { lines, errors: parseErrors } = parseScript(ep.scripts[lang]);
    parseErrors.forEach((e) => errors.push(`${file} ${e}`));
    const cues = lines.map((l) => l.cue);
    const expected = skeleton.cueOrder;
    const firstDiff = Math.max(cues.length, expected.length) > 0 ? cues.findIndex((c, i) => c !== expected[i]) : -1;
    if (firstDiff >= 0 || cues.length !== expected.length) {
      const at = firstDiff >= 0 ? firstDiff : Math.min(cues.length, expected.length);
      errors.push(`${file}: cue sequence differs from skeleton.cueOrder at position ${at + 1}: got "${cues[at] ?? "<end>"}", expected "${expected[at] ?? "<end>"}"`);
    }
    for (const l of lines) {
      const shot = cueShot.get(l.cue);
      if (shot && l.beat !== shot.beat) errors.push(`${file} line ${l.line}: cue ${l.cue} is under ${l.beat} but its shot ${shot.id} is ${shot.beat}`);
      for (const c of l.claims) if (!ep.claims.has(c)) errors.push(`${file} line ${l.line}: unknown claim ${c}`);
    }
    segments[lang] = lines
      .filter((l) => cueShot.has(l.cue))
      .map((l) => ({ cue: l.cue, text: l.text, claims: l.claims, beat: l.beat, shot: cueShot.get(l.cue)!.id }));
    writeJson(path.join(ep.buildDir, `segments.${lang}.json`), segments[lang]);
  }

  // ---- fact gate ----
  const cited = citedClaimsFor(ep, segments);
  if (opts.forExport) for (const lang of ep.languages) for (const p of Object.values(ep.meta[lang].platforms)) p.claims.forEach((c) => cited.includes(c) || cited.push(c));
  const waived = new Set(ep.production.claimWaivers.map((w) => w.id));
  const milestone = MILESTONE_ORDER.indexOf(ep.production.milestone);
  let draft = false;
  for (const id of cited) {
    const claim = ep.claims.get(id);
    if (!claim) {
      errors.push(`cited claim ${id} does not exist`);
      continue;
    }
    if (claim.status === "rejected") errors.push(`claim ${id} is rejected but still cited`);
    if (claim.status === "pending" && !waived.has(id)) {
      if (milestone >= 1) errors.push(`claim ${id} is pending; from M1 every cited claim must be verified (or waived by Ryan)`);
      else draft = true;
    }
  }
  if (draft) warnings.push(`M0: ${cited.filter((c) => ep.claims.get(c)?.status === "pending").length} cited claims are pending; output carries a DRAFT watermark`);

  // ---- lints ----
  const lint = runLints(ep);
  errors.push(...lint.errors);

  const result: ValidateResult = { ok: errors.length === 0, errors, warnings, draft, citedClaims: cited };
  writeJson(path.join(ep.buildDir, "validate.json"), { ...result, milestone: ep.production.milestone, lints: lint.ran });
  for (const w of warnings) ep.log.warn(`[validate] ${w}`);
  for (const e of errors) ep.log.error(`[validate] ${e}`);
  ep.log.info(`[validate] ${result.ok ? "ok" : `${errors.length} error(s)`} · languages ${ep.languages.join(",")} · ${cited.length} claims cited`);
  return result;
}
