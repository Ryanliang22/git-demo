import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import { componentSpecs, Manifest, QcReport, RenderLog, TtsIndex, CaptionsFile, type Timeline } from "@ai-history/schemas";
import { ROOT, selectionTag, type Episode } from "../context";
import { ensureDir, ffmpeg, readJson, run, writeJson } from "../lib/util";
import { browserExecutable, getBundle, renderInput } from "./render";
import { loadSegments } from "./tts";

const require_ = createRequire(path.join(ROOT, "packages/components/package.json"));

// Implicit AI label (spec §13). Field names and values must come from the text of GB 45438-2025
// Appendix E, recorded in series/compliance/gb45438-2025.json once someone has checked the source.
// Until that file exists the export writes no implicit label and says so; M2 refuses to export.
interface ImplicitLabelSpec {
  standard: string;
  verified: { by: string; date: string; source: string };
  mp4Tags: Record<string, string>;
}

function loadImplicitSpec(): ImplicitLabelSpec | null {
  const file = path.join(ROOT, "series/compliance/gb45438-2025.json");
  return fs.existsSync(file) ? readJson<ImplicitLabelSpec>(file) : null;
}

async function git(args: string[]): Promise<string> {
  try {
    return (await run("git", args, { cwd: ROOT })).stdout.trim();
  } catch {
    return "";
  }
}

export async function exportStage(ep: Episode, lang: string, opts: { timeline: Timeline }) {
  const { timeline } = opts;
  const tag = selectionTag(ep);
  const langDir = path.join(ep.buildDir, lang);
  const qc = QcReport.parse(readJson(path.join(ep.buildDir, `qc.${lang}.json`)));
  if (!qc.passed) throw new Error(`qc.${lang}.json did not pass; export refused`);
  const out = ensureDir(path.join(langDir, `export${tag}`));
  const base = `${ep.id}.${lang}${tag}`;
  const validate = readJson<{ draft: boolean }>(path.join(ep.buildDir, "validate.json"));

  // video + implicit AI label
  const spec = loadImplicitSpec();
  const video = path.join(out, `${base}.mp4`);
  const tags = spec ? Object.entries(spec.mp4Tags).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]) : [];
  await ffmpeg(["-i", path.join(langDir, `${base}.mp4`), "-map", "0", "-c", "copy", ...tags, "-movflags", "+faststart+use_metadata_tags", video]);
  let implicit: string;
  if (spec) {
    const probe = (await run("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", video])).stdout;
    const written = (JSON.parse(probe).format?.tags ?? {}) as Record<string, string>;
    const missing = Object.keys(spec.mp4Tags).filter((k) => written[k] === undefined);
    if (missing.length) throw new Error(`implicit AI label not readable back from ${video}: ${missing.join(", ")}`);
    implicit = `written per ${spec.standard} (verified ${spec.verified.date} by ${spec.verified.by}); ffprobe confirms ${Object.keys(spec.mp4Tags).join(", ")}`;
  } else {
    if (ep.production.milestone === "M2") throw new Error("M2 export needs series/compliance/gb45438-2025.json (GB 45438-2025 Appendix E, checked against the standard text)");
    implicit = "pending: GB 45438-2025 Appendix E field names not yet verified against the standard text (spec §13); nothing written";
    ep.log.warn(`[export] ${lang} ${implicit}`);
  }

  // captions
  const srt = path.join(out, `${base}.srt`);
  fs.copyFileSync(path.join(langDir, `${base}.srt`), srt);

  // cover: last frame of S01 with the title
  const outputs: Record<string, string> = { video: path.relative(ep.dir, video), srt: path.relative(ep.dir, srt) };
  const first = ep.skeleton.shots[0].id;
  const platforms = Object.values(ep.meta[lang].platforms);
  if (timeline.selection.includes(first) && platforms.length) {
    const captions = CaptionsFile.parse(readJson(path.join(ep.buildDir, `captions.${lang}.json`)));
    const input = { ...renderInput(ep, lang, timeline, captions, validate.draft), shotId: first, cover: { title: platforms[0].title, seriesMark: ep.strings[lang].series_mark } };
    const serveUrl = await getBundle(ep);
    const inputProps = { input };
    const composition = await selectComposition({ serveUrl, id: "Shot", inputProps, browserExecutable: browserExecutable(), logLevel: "error" });
    const cover = path.join(out, `${base}.cover.png`);
    await renderStill({ composition, serveUrl, inputProps, output: cover, frame: composition.durationInFrames - 1, browserExecutable: browserExecutable(), logLevel: "error" });
    outputs.cover = path.relative(ep.dir, cover);
  }

  // platform metadata package
  const metaFile = path.join(out, `meta.${lang}.json`);
  writeJson(metaFile, ep.meta[lang]);
  outputs.meta = path.relative(ep.dir, metaFile);
  for (const [platform, m] of Object.entries(ep.meta[lang].platforms)) {
    const txt = [m.title, "", m.description, "", m.tags.map((t) => `#${t}`).join(" "), "", `[AI disclosure] ${m.aiDisclosure.setting} → ${m.aiDisclosure.value}`, ""].join("\n");
    const f = path.join(out, `${platform}.txt`);
    fs.writeFileSync(f, txt);
    outputs[platform] = path.relative(ep.dir, f);
  }

  // manifest
  const ttsIndex = TtsIndex.parse(readJson(path.join(langDir, "tts.json")));
  const renderLog = RenderLog.parse(readJson(path.join(langDir, `render${tag}.json`)));
  const voice = ep.bible.voice.narrator[lang];
  const used = new Set<string>(["grammar/Caption", "grammar/AILabel"]);
  for (const s of ep.skeleton.shots.filter((x) => timeline.selection.includes(x.id))) [s.component, ...(s.layers ?? []).map((l) => l.component)].forEach((c) => used.add(c));
  const waived = new Set(ep.production.claimWaivers.map((w) => w.id));
  // claims behind what this export actually contains: its narration, its on-screen documents, its metadata
  const segs = loadSegments(ep, lang);
  const docs = Object.entries(ep.skeleton.screenText)
    .filter(([slot, key]) => timeline.selection.includes(slot.split(".")[0]) && key.startsWith("doc:"))
    .flatMap(([, key]) => ep.documents.documents[key.slice(4)].claims);
  const metaClaims = Object.values(ep.meta[lang].platforms).flatMap((p) => p.claims);
  const cited = [...new Set([...segs.flatMap((s) => s.claims), ...docs, ...metaClaims])].sort();
  const manifest: Manifest = {
    episode: ep.id,
    lang,
    milestone: ep.production.milestone,
    createdAt: new Date().toISOString(),
    git: { commit: await git(["rev-parse", "HEAD"]), dirty: (await git(["status", "--porcelain", "--", "."])).length > 0 },
    bibleVersion: ep.bible.version,
    components: Object.fromEntries([...used].sort().map((c) => [c, componentSpecs[c as keyof typeof componentSpecs].version])),
    tts: {
      engine: voice.engine,
      engineVersion: readJson<{ engineVersion: string }>(path.join(ep.dir, ttsIndex.segments[0].file.replace(/\.wav$/, ".json"))).engineVersion,
      voice: voice.voice,
      characters: ttsIndex.segments.reduce((a, s) => a + s.characters, 0),
      license: voice.license ?? "unrecorded",
    },
    llmTokens: { input: null, output: null, note: "pipeline makes no LLM calls; review/verification subagent usage is not metered here" },
    renderMs: renderLog.totalRenderMs,
    humanMinutes: ep.production.humanMinutes,
    claims: cited.map((id) => ({ id, status: ep.claims.get(id)!.status, waived: waived.has(id) })),
    licenses: [
      ...Object.values(ep.bible.fonts).map((f) => ({ kind: "font", name: f.family, license: f.license, path: path.relative(ROOT, require_.resolve(f.licenseFile)) })),
      { kind: "tts-voice", name: `${voice.engine}/${voice.voice}`, license: voice.license ?? "unrecorded", path: "" },
      ...ep.production.assets,
    ],
    qc: { passed: qc.passed, report: path.relative(ep.dir, path.join(ep.buildDir, `qc.${lang}.json`)) },
    outputs,
    aiLabel: {
      explicit: [`on-screen strings.ai_label "${ep.strings[lang].ai_label}" 0–${ep.bible.aiLabel.showUntilSec}s and on the end card`, "first narration line"],
      implicit,
    },
  };
  writeJson(path.join(ep.buildDir, `manifest.${lang}.json`), Manifest.parse(manifest));
  ep.log.info(`[export] ${lang} → ${path.relative(ep.dir, out)} (${Object.keys(outputs).join(", ")}), manifest.${lang}.json`);
}
