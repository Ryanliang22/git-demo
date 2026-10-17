import fs from "node:fs";
import path from "node:path";
import { Timeline, TtsIndex } from "@ai-history/schemas";
import { decodeWav, encodeWav } from "@ai-history/tts";
import type { Episode } from "../context";
import { ffmpeg, hashOf, readJson, writeJson } from "../lib/util";
import { loadSegments } from "./tts";

// Lay the segment audio end to end: 150 ms between segments, 400 ms between beats, shots padded to
// minSec with silence after their last segment, a warning (no truncation) above maxSec.
export async function timing(ep: Episode, lang: string): Promise<Timeline> {
  const { bible, skeleton } = ep;
  const fps = bible.canvas.fps;
  const sampleRate = bible.audio.sampleRate;
  const samplesPerFrame = sampleRate / fps;
  if (!Number.isInteger(samplesPerFrame)) throw new Error("sampleRate must be a multiple of fps");
  const langDir = path.join(ep.buildDir, lang);
  const ttsIndex = TtsIndex.parse(readJson(path.join(langDir, "tts.json")));
  const segments = loadSegments(ep, lang);
  const shots = skeleton.shots.filter((s) => ep.selection.includes(s.id));

  const key = hashOf({ tts: ttsIndex.segments.map((s) => s.hash), segments, timing: bible.timing, loudness: bible.audio, fps, shots });
  const timelineFile = path.join(ep.buildDir, `timeline.${lang}.json`);
  const stampFile = path.join(langDir, "timing.stamp.json");
  if (fs.existsSync(timelineFile) && fs.existsSync(stampFile) && fs.existsSync(path.join(langDir, "narration.wav"))) {
    if (readJson<{ key?: string }>(stampFile).key === key) {
      ep.log.info(`[timing] ${lang} cache HIT ${key}`);
      return Timeline.parse(readJson(timelineFile));
    }
  }

  const toFrames = (ms: number) => Math.ceil((ms / 1000) * fps);
  const ttsByCue = new Map(ttsIndex.segments.map((s) => [s.cue, s]));
  const cues: Record<string, number> = {};
  const shotRanges: Record<string, [number, number]> = {};
  const placed: Timeline["segments"] = [];
  const warnings: string[] = [];
  let frame = 0;
  for (const shot of shots) {
    const start = frame;
    const segs = segments.filter((s) => s.shot === shot.id);
    for (const seg of segs) {
      const t = ttsByCue.get(seg.cue);
      if (!t) throw new Error(`no TTS for ${lang} ${seg.cue}`);
      cues[seg.cue] = frame;
      const end = frame + Math.ceil(t.durationSec * fps);
      placed.push({ cue: seg.cue, shot: shot.id, startFrame: frame, endFrame: end, ttsHash: t.hash });
      const next = segments[segments.indexOf(seg) + 1];
      frame = end + toFrames(!next || next.beat !== seg.beat ? bible.timing.beatGapMs : bible.timing.segmentGapMs);
    }
    const minFrames = Math.ceil(shot.minSec * fps);
    if (frame - start < minFrames) frame = start + minFrames;
    if (frame - start > shot.maxSec * fps) {
      const msg = `${shot.id} runs ${((frame - start) / fps).toFixed(2)}s > maxSec ${shot.maxSec}s`;
      warnings.push(msg);
      ep.log.warn(`[timing] ${lang} ${msg}`);
    }
    shotRanges[shot.id] = [start, frame];
  }

  // narration track: every segment starts exactly on its cue frame
  const pcm = new Int16Array(frame * samplesPerFrame);
  for (const p of placed) {
    const { samples } = decodeWav(fs.readFileSync(path.join(ep.dir, ttsByCue.get(p.cue)!.file)));
    pcm.set(samples.subarray(0, (p.endFrame - p.startFrame) * samplesPerFrame), p.startFrame * samplesPerFrame);
  }
  const rawWav = path.join(langDir, "narration.raw.wav");
  const wav = path.join(langDir, "narration.wav");
  fs.writeFileSync(rawWav, encodeWav(pcm, sampleRate));
  await loudnorm(ep, lang, rawWav, wav);

  const timeline: Timeline = {
    fps,
    cues,
    shots: shotRanges,
    totalFrames: frame,
    audio: path.relative(ep.dir, wav),
    lang,
    selection: ep.selection,
    segments: placed,
    warnings,
  };
  writeJson(timelineFile, Timeline.parse(timeline));
  writeJson(stampFile, { key });
  ep.log.info(`[timing] ${lang} cache MISS ${key} → ${frame} frames (${(frame / fps).toFixed(2)}s)`);
  return timeline;
}

// Two-pass EBU R128 normalisation. Pure silence (mock TTS) has no measurable loudness and is copied as is.
async function loudnorm(ep: Episode, lang: string, input: string, output: string) {
  const { integratedLufs: I, truePeakDbtp: TP } = ep.bible.audio.loudness;
  const sr = String(ep.bible.audio.sampleRate);
  const pass1 = await ffmpeg(["-i", input, "-af", `loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const json = /\{[^{}]*"input_i"[^{}]*\}/s.exec(pass1.stderr);
  const m = json ? (JSON.parse(json[0]) as Record<string, string>) : null;
  if (!m || !Number.isFinite(Number(m.input_i)) || Number(m.input_i) < -70) {
    ep.log.warn(`[timing] ${lang} narration is silent (input_i=${m?.input_i}); loudnorm skipped`);
    fs.copyFileSync(input, output);
    return;
  }
  const filter =
    `loudnorm=I=${I}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
  await ffmpeg(["-i", input, "-af", filter, "-ar", sr, "-ac", "1", "-c:a", "pcm_s16le", output]);
  // resampling inside loudnorm can shift the length by a few samples: restore the exact frame grid
  const want = decodeWav(fs.readFileSync(input)).samples.length;
  const got = decodeWav(fs.readFileSync(output));
  if (got.samples.length !== want) {
    const fixed = new Int16Array(want);
    fixed.set(got.samples.subarray(0, want));
    fs.writeFileSync(output, encodeWav(fixed, got.sampleRate));
  }
  ep.log.info(`[timing] ${lang} loudnorm: ${m.input_i} LUFS → ${I} LUFS`);
}
