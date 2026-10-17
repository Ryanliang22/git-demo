import fs from "node:fs";
import path from "node:path";
import { selectComposition } from "@remotion/renderer";
import { LayoutProbeResult, QcReport, RenderLog, type CaptionsFile, type QcCheck, type Timeline } from "@ai-history/schemas";
import { selectionTag, type Episode } from "../context";
import { lineWidth } from "../lib/linebreak";
import { ffmpeg, probeDuration, readJson, run, writeJson } from "../lib/util";
import { browserExecutable, getBundle, renderInput } from "./render";
import { loadSegments } from "./tts";

// Spec §12: ten gates. Any "fail" stops the pipeline; "skipped" and "manual" say why in `detail`.
export async function qc(ep: Episode, lang: string, opts: { timeline: Timeline; captions: CaptionsFile }): Promise<QcReport> {
  const { timeline, captions } = opts;
  const { bible, skeleton } = ep;
  const tag = selectionTag(ep);
  const langDir = path.join(ep.buildDir, lang);
  const video = path.join(langDir, `${ep.id}.${lang}${tag}.mp4`);
  const fps = bible.canvas.fps;
  const full = timeline.selection.length === skeleton.shots.length;
  const checks: QcCheck[] = [];
  const add = (id: string, status: QcCheck["status"], detail: string, data?: unknown) => checks.push({ id, status, detail, data });
  const validate = readJson<{ ok: boolean; errors: string[]; draft: boolean; citedClaims: string[] }>(path.join(ep.buildDir, "validate.json"));

  // 1. duration
  const dur = await probeDuration(video);
  if (full) {
    const [lo, hi] = skeleton.format.targetSec;
    add("duration", dur > skeleton.format.maxSec ? "fail" : "pass", `${dur.toFixed(2)}s (target ${lo}–${hi}s, hard limit ${skeleton.format.maxSec}s)${dur < lo || dur > hi ? " — outside target" : ""}`);
  } else {
    const min = timeline.selection.reduce((a, id) => a + skeleton.shots.find((s) => s.id === id)!.minSec, 0);
    const max = timeline.selection.reduce((a, id) => a + skeleton.shots.find((s) => s.id === id)!.maxSec, 0);
    add("duration", dur > max ? "fail" : "skipped", `partial build ${timeline.selection.join(",")}: ${dur.toFixed(2)}s (shot limits sum ${min}–${max}s); episode target applies to full builds`);
  }

  // 2. loudness (two-pass loudnorm happened in timing; measure the delivered file)
  const voice = bible.voice.narrator[lang];
  const { stderr } = await ffmpeg(["-i", video, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const I = Number(/I:\s+(-?[\d.]+|-inf) LUFS\s*\n\s*Threshold/.exec(stderr)?.[1] ?? NaN);
  const TP = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(stderr.slice(stderr.lastIndexOf("True peak")))?.[1] ?? NaN);
  const L = bible.audio.loudness;
  if (voice.engine === "mock") add("loudness", "skipped", `mock TTS writes silence (measured I=${I} LUFS); gate applies once a real engine is configured`);
  else {
    const ok = Math.abs(I - L.integratedLufs) <= L.toleranceLu && TP <= L.truePeakDbtp;
    add("loudness", ok ? "pass" : "fail", `integrated ${I} LUFS (target ${L.integratedLufs}±${L.toleranceLu}), true peak ${TP} dBTP (≤ ${L.truePeakDbtp})`);
  }

  // 3. cue consistency (validate stage)
  const cueErrors = validate.errors.filter((e) => e.includes("cue sequence"));
  add("cue_consistency", validate.ok && !cueErrors.length ? "pass" : "fail", cueErrors.length ? cueErrors.join("; ") : `every script matches skeleton.cueOrder (${skeleton.cueOrder.length} cues)`);

  // 4. claims (validate stage enforces verified-only from M1)
  const segs = loadSegments(ep, lang);
  const pending = validate.citedClaims.filter((c) => ep.claims.get(c)?.status !== "verified");
  const uncited = segs.filter((s) => s.claims.length === 0).length;
  add(
    "claims",
    validate.ok ? "pass" : "fail",
    `${segs.length} lines checked, ${uncited} narrative [[N]]; ${validate.citedClaims.length} claims cited, ${pending.length} not verified` +
      (validate.draft ? ` — allowed in ${ep.production.milestone} with DRAFT watermark` : ""),
    { notVerified: pending },
  );

  // 5. caption length
  const style = bible.languages[lang].caption;
  const bad = captions.blocks.flatMap((b) => [
    ...b.lines.filter((l) => lineWidth(l) > style.maxLineChars).map((l) => `#${b.index} "${l}"`),
    ...(b.lines.length > style.maxLines ? [`#${b.index} has ${b.lines.length} lines`] : []),
  ]);
  add("caption_length", bad.length ? "fail" : "pass", bad.length ? bad.join("; ") : `${captions.blocks.length} blocks, ≤ ${style.maxLineChars} chars/line, ≤ ${style.maxLines} lines`);

  // 6. text overflow: fitText in the real browser, every box must keep its minimum size
  const input = { ...renderInput(ep, lang, timeline, captions, validate.draft), shotId: null };
  const serveUrl = await getBundle(ep);
  const comp = await selectComposition({ serveUrl, id: "LayoutProbe", inputProps: { input }, browserExecutable: browserExecutable(), logLevel: "error" });
  const probe = LayoutProbeResult.parse((comp.props as { probe: unknown }).probe);
  const small = probe.filter((p) => p.fontSize + 1e-6 < p.minFontSize);
  writeJson(path.join(langDir, `layout-probe${tag}.json`), probe);
  add(
    "text_overflow",
    small.length ? "fail" : "pass",
    small.length ? small.map((p) => `${p.id} "${p.text}" ${p.fontSize.toFixed(1)}px < ${p.minFontSize}px`).join("; ") : `${probe.length} text boxes fit at or above their minimum size`,
  );

  // 7. text inside safe area: M0 = contact sheet reviewed by an independent subagent
  const review = path.join(langDir, "review", `review-result${tag}.md`);
  add(
    "text_in_safe_area",
    "manual",
    fs.existsSync(review)
      ? `contact sheet reviewed: ${path.relative(ep.dir, review)}`
      : `pending subagent review of review/contact-sheet${tag}.png (automatic check is proposed for M1 in DECISIONS.md)`,
  );

  // 8. black / freeze frames
  const bd = bible.qc.blackdetect;
  const fd = bible.qc.freezedetect;
  const det = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", video, "-map", "0:v", "-vf", `blackdetect=d=${bd.minSec}:pix_th=${bd.pixTh},freezedetect=n=${fd.noiseDb}dB:d=${fd.minSec}`, "-f", "null", "-"]);
  const blacks = [...det.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const freezeStarts = [...det.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const freezeEnds = [...det.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const shotAt = (sec: number) => timeline.selection.find((id) => sec * fps >= timeline.shots[id][0] && sec * fps < timeline.shots[id][1]) ?? "?";
  const freezes = freezeStarts.map((s, i) => ({ start: s, end: freezeEnds[i] ?? dur, shot: shotAt(s) }));
  const badFreezes = freezes.filter((f) => !skeleton.shots.find((s) => s.id === f.shot)?.allowFreeze);
  add(
    "black_freeze",
    blacks.length || badFreezes.length ? "fail" : "pass",
    `${blacks.length} black interval(s)${blacks.length ? ` ${JSON.stringify(blacks)}` : ""}; ${freezes.length} freeze(s), ${badFreezes.length} outside whitelisted shots` +
      (badFreezes.length ? ` ${badFreezes.map((f) => `${f.shot} ${f.start.toFixed(2)}–${f.end.toFixed(2)}s`).join(", ")}` : ""),
    { blacks, freezes },
  );

  // 9. A/V sync: each shot's first frame in the output vs its startCue in the timeline
  const renderLog = RenderLog.parse(readJson(path.join(langDir, `render${tag}.json`)));
  const offsets = renderLog.shots.map((s) => {
    const cue = skeleton.shots.find((x) => x.id === s.id)!.startCue;
    return { shot: s.id, cueFrame: timeline.cues[cue], outputFrame: s.startFrameInOutput, diff: s.startFrameInOutput - timeline.cues[cue] };
  });
  const totalFrames = renderLog.shots.reduce((a, s) => a + s.frames, 0);
  const audioDur = Number((await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", video])).stdout.trim());
  const worst = Math.max(...offsets.map((o) => Math.abs(o.diff)));
  const syncOk = worst <= bible.qc.avSyncToleranceFrames && totalFrames === timeline.totalFrames && Math.abs(audioDur - totalFrames / fps) < 2 / fps;
  add("av_sync", syncOk ? "pass" : "fail", `max shot offset ${worst} frame(s); video ${totalFrames}/${timeline.totalFrames} frames; audio ${audioDur.toFixed(3)}s`, offsets);

  // 10. AI label: explicit (on screen 0–3 s and on the end card, first line says "I'm an AI"), implicit (export)
  const explicit: string[] = [];
  const problems: string[] = [];
  if (!ep.strings[lang].ai_label) problems.push("strings.ai_label empty");
  const firstShot = skeleton.shots[0].id;
  if (timeline.selection.includes(firstShot)) {
    if (timeline.shots[firstShot][1] < bible.aiLabel.showUntilSec * fps) problems.push("first shot shorter than the label window");
    explicit.push(`on-screen label frames 0–${Math.round(bible.aiLabel.showUntilSec * fps)}`);
    const first = segs.find((s) => s.cue === skeleton.cueOrder[0]);
    if (!first || !/\bAI\b|AI/.test(first.text)) problems.push(`first narration line does not identify the narrator as an AI`);
    else explicit.push(`first line "${first.text}"`);
  }
  const lastShot = skeleton.shots[skeleton.shots.length - 1];
  if (timeline.selection.includes(lastShot.id)) {
    const endCard = (lastShot.layers ?? []).find((l) => l.component === "grammar/EndCard");
    const labelSlot = endCard ? (endCard.props as { labelSlot?: string }).labelSlot : undefined;
    if (!labelSlot || skeleton.screenText[`${lastShot.id}.${labelSlot}`] !== "ai_label") problems.push("end card does not show strings.ai_label");
    else explicit.push("end card label");
  }
  add(
    "ai_label",
    problems.length ? "fail" : "pass",
    problems.length ? problems.join("; ") : `explicit: ${explicit.join(", ")}; implicit MP4 metadata is written and verified by export`,
  );

  const report: QcReport = { lang, milestone: ep.production.milestone, video: path.relative(ep.dir, video), checks, passed: !checks.some((c) => c.status === "fail") };
  writeJson(path.join(ep.buildDir, `qc.${lang}.json`), QcReport.parse(report));
  for (const c of checks) ep.log[c.status === "fail" ? "error" : "info"](`[qc] ${lang} ${c.status.toUpperCase().padEnd(7)} ${c.id}: ${c.detail}`);
  return report;
}
