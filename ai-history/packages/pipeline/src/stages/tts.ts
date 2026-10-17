import fs from "node:fs";
import path from "node:path";
import { SegmentsFile, TtsResult, type Segment, type TtsIndex } from "@ai-history/schemas";
import { decodeWav, getEngine } from "@ai-history/tts";
import type { Episode } from "../context";
import { ensureDir, ffmpeg, hashOf, readJson, writeJson } from "../lib/util";

export function loadSegments(ep: Episode, lang: string): Segment[] {
  const file = path.join(ep.buildDir, `segments.${lang}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}; run validate first`);
  return SegmentsFile.parse(readJson(file)).filter((s) => ep.selection.includes(s.shot));
}

// Synthesise each segment; cache key = hash(text, engine, voice, params, context).
export async function tts(ep: Episode, lang: string): Promise<TtsIndex> {
  const voice = ep.bible.voice.narrator[lang];
  const engine = getEngine(voice.engine);
  const unit = ep.bible.languages[lang].unit;
  const sampleRate = ep.bible.audio.sampleRate;
  const cacheDir = ensureDir(path.join(ep.buildDir, "cache", "tts"));
  const segments = loadSegments(ep, lang);
  const out: TtsIndex = { lang, segments: [] };
  let hits = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const context = engine.supportsContext ? { previous: segments[i - 1]?.text, next: segments[i + 1]?.text } : undefined;
    const key = { engine: engine.id, engineVersion: engine.version, voice: voice.voice, params: voice.params, lang, unit, text: seg.text, context, sampleRate };
    const hash = hashOf(key);
    const wav = path.join(cacheDir, `${hash}.wav`);
    const metaFile = path.join(cacheDir, `${hash}.json`);
    let result: TtsResult;
    if (fs.existsSync(wav) && fs.existsSync(metaFile)) {
      result = TtsResult.parse(readJson(metaFile));
      hits++;
      ep.log.info(`[tts] ${lang} ${seg.cue} cache HIT ${hash}`);
    } else {
      ep.log.info(`[tts] ${lang} ${seg.cue} cache MISS ${hash} → ${engine.id}/${voice.voice}`);
      const res = await engine.synthesize({ text: seg.text, lang, voice: voice.voice, params: voice.params, unit, context });
      const raw = path.join(cacheDir, `${hash}.raw.${res.extension}`);
      fs.writeFileSync(raw, res.audio);
      // normalise every engine's output to mono PCM16 at the series sample rate
      await ffmpeg(["-i", raw, "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", wav]);
      fs.rmSync(raw);
      const { samples } = decodeWav(fs.readFileSync(wav));
      result = {
        hash,
        engine: engine.id,
        engineVersion: engine.version,
        voice: voice.voice,
        text: seg.text,
        durationSec: samples.length / sampleRate,
        characters: [...seg.text].length,
        file: path.relative(ep.dir, wav),
      };
      writeJson(metaFile, result);
    }
    out.segments.push({ cue: seg.cue, hash, file: result.file, durationSec: result.durationSec, characters: result.characters });
  }
  writeJson(path.join(ep.buildDir, lang, "tts.json"), out);
  ep.log.info(`[tts] ${lang}: ${segments.length} segments, ${hits} cached, ${segments.length - hits} synthesised`);
  return out;
}
