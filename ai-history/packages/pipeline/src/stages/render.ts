import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { componentSpecs, RenderLog, type CaptionsFile, type RenderInput, type Timeline } from "@ai-history/schemas";
import { ROOT, selectionTag, type Episode } from "../context";
import { ensureDir, ffmpeg, hashFiles, hashOf, probeFrames, readJson, writeJson } from "../lib/util";

const require_ = (await import("node:module")).createRequire(import.meta.url);
const REMOTION_VERSION: string = require_("@remotion/renderer/package.json").version;

export function browserExecutable(): string | null {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const base = "/opt/pw-browsers";
  if (!fs.existsSync(base)) return null; // Remotion downloads its own headless shell
  const dir = fs.readdirSync(base).find((d) => d.startsWith("chromium_headless_shell-"));
  const exe = dir ? path.join(base, dir, "chrome-linux", "headless_shell") : null;
  return exe && fs.existsSync(exe) ? exe : null;
}

// Hash of everything that changes how a frame looks given the same props.
export function codeHash(): string {
  return hashOf([
    hashFiles([path.join(ROOT, "packages/components/src"), path.join(ROOT, "packages/schemas/src"), path.join(ROOT, "remotion")]),
    REMOTION_VERSION,
  ]);
}

let bundled: string | null = null;
export async function getBundle(ep: Episode): Promise<string> {
  if (bundled) return bundled;
  const outDir = path.join(ROOT, ".remotion-cache", `bundle-${codeHash()}`);
  if (fs.existsSync(path.join(outDir, "index.html"))) {
    ep.log.info(`[render] bundle cache HIT ${path.basename(outDir)}`);
  } else {
    ep.log.info(`[render] bundling remotion/index.ts → ${path.basename(outDir)}`);
    await bundle({ entryPoint: path.join(ROOT, "remotion/index.ts"), outDir });
  }
  bundled = outDir;
  return outDir;
}

export function renderInput(ep: Episode, lang: string, timeline: Timeline, captions: CaptionsFile, draft: boolean): RenderInput {
  return {
    lang,
    bible: ep.bible,
    skeleton: ep.skeleton,
    timeline,
    captions,
    strings: ep.strings[lang],
    documents: ep.documents,
    shotId: null,
    draft,
    debug: { safeArea: false },
  };
}

// Everything that determines a shot's pixels, in shot-relative frames: changing one narration line
// shifts later shots in time but leaves their keys (and renders) untouched.
export function shotKey(ep: Episode, lang: string, input: RenderInput, shotId: string, code: string) {
  const shot = ep.skeleton.shots.find((s) => s.id === shotId)!;
  const [start, end] = input.timeline.shots[shotId];
  const cues = Object.fromEntries(Object.entries(input.timeline.cues).filter(([, f]) => f >= start && f < end).map(([c, f]) => [c, f - start]));
  const captions = input.captions.blocks.filter((b) => b.shot === shotId).map((b) => ({ s: b.startFrame - start, e: b.endFrame - start, l: b.lines }));
  const texts = Object.fromEntries(Object.entries(ep.skeleton.screenText).filter(([k]) => k.startsWith(`${shotId}.`)).map(([k, v]) => [k, v.startsWith("doc:") ? ep.documents.documents[v.slice(4)] : input.strings[v]]));
  const labelEnd = Math.round(ep.bible.aiLabel.showUntilSec * ep.bible.canvas.fps);
  const versions = [shot.component, ...(shot.layers ?? []).map((l) => l.component)].map((c) => `${c}@${componentSpecs[c as keyof typeof componentSpecs]?.version}`);
  return hashOf({
    lang,
    shot,
    duration: end - start,
    cues,
    captions,
    texts,
    aiLabel: start < labelEnd ? [labelEnd - start, input.strings.ai_label] : null,
    draft: input.draft ? input.strings.draft_mark : null,
    // the parts of the bible that reach pixels (voice, timing, audio and qc act through other stages)
    bible: { ...ep.bible, voice: null, timing: null, audio: null, qc: null },
    versions,
    code,
  });
}

export async function render(ep: Episode, lang: string, opts: { timeline: Timeline; captions: CaptionsFile; draft: boolean }): Promise<RenderLog> {
  const input = renderInput(ep, lang, opts.timeline, opts.captions, opts.draft);
  const code = codeHash();
  const shotsDir = ensureDir(path.join(ep.buildDir, lang, "shots"));
  const log: RenderLog = { lang, shots: [], totalRenderMs: 0, output: "" };
  let offset = 0;
  for (const shotId of opts.timeline.selection) {
    const hash = shotKey(ep, lang, input, shotId, code);
    const file = path.join(shotsDir, `${shotId}-${hash}.mp4`);
    const started = Date.now();
    const cached = fs.existsSync(file);
    const timing = `${file}.json`;
    if (cached) {
      ep.log.info(`[render] ${lang} ${shotId} cache HIT ${hash}`);
    } else {
      ep.log.info(`[render] ${lang} ${shotId} cache MISS ${hash} → rendering`);
      const serveUrl = await getBundle(ep);
      const inputProps = { input: { ...input, shotId } };
      const browser = browserExecutable();
      const composition = await selectComposition({ serveUrl, id: "Shot", inputProps, browserExecutable: browser, logLevel: "error" });
      const tmp = `${file}.part.mp4`;
      let last = -1;
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: tmp,
        inputProps,
        muted: true,
        enforceAudioTrack: false,
        crf: 18,
        pixelFormat: "yuv420p",
        colorSpace: "bt709",
        imageFormat: "jpeg",
        jpegQuality: 92,
        concurrency: Math.max(1, os.cpus().length),
        browserExecutable: browser,
        logLevel: "error",
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 10) * 10;
          if (pct !== last) {
            last = pct;
            process.stdout.write(`\r[render] ${lang} ${shotId} ${pct}%   `);
          }
        },
      });
      process.stdout.write("\n");
      fs.renameSync(tmp, file);
      writeJson(timing, { renderMs: Date.now() - started });
      // older renders of this shot stay: the cache is content-addressed, so reverting an edit is a HIT
    }
    const frames = await probeFrames(file);
    const renderMs = fs.existsSync(timing) ? readJson<{ renderMs: number }>(timing).renderMs : 0; // time of the original render
    log.shots.push({ id: shotId, hash, cached, frames, startFrameInOutput: offset, renderMs, file: path.relative(ep.dir, file) });
    offset += frames;
  }

  const tag = selectionTag(ep);
  const langDir = path.join(ep.buildDir, lang);
  const list = path.join(langDir, `concat${tag}.txt`);
  fs.writeFileSync(list, log.shots.map((s) => `file '${path.join(ep.dir, s.file)}'`).join("\n") + "\n");
  const silent = path.join(langDir, `video${tag}.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  const out = path.join(langDir, `${ep.id}.${lang}${tag}.mp4`);
  await ffmpeg([
    "-i", silent, "-i", path.join(ep.dir, opts.timeline.audio),
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", String(ep.bible.audio.sampleRate),
    "-movflags", "+faststart", out,
  ]);
  log.totalRenderMs = log.shots.reduce((a, s) => a + s.renderMs, 0);
  log.output = path.relative(ep.dir, out);
  writeJson(path.join(langDir, `render${tag}.json`), RenderLog.parse(log));
  const fresh = log.shots.filter((s) => !s.cached).map((s) => s.id);
  ep.log.info(`[render] ${lang}: ${log.shots.length} shots (${fresh.length ? `re-rendered ${fresh.join(",")}` : "all cached"}) → ${log.output}`);
  return log;
}
