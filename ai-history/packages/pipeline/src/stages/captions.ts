import fs from "node:fs";
import path from "node:path";
import { CaptionsFile, type CaptionBlock, type Timeline } from "@ai-history/schemas";
import { selectionTag, type Episode } from "../context";
import { layoutCaption, lineWidth } from "../lib/linebreak";
import { framesToSrtTime, writeJson } from "../lib/util";
import { loadSegments } from "./tts";

// One caption block per segment; long segments split at punctuation into several blocks of at most
// maxLines lines, timed within the segment by character count. Also writes the SRT file.
export function captions(ep: Episode, lang: string, timeline: Timeline): { file: CaptionsFile; violations: string[] } {
  const style = ep.bible.languages[lang];
  const rules = { maxLineChars: style.caption.maxLineChars, unit: style.unit, dropLineEndPunct: style.caption.dropLineEndPunct };
  const segments = loadSegments(ep, lang);
  const placed = new Map(timeline.segments.map((s) => [s.cue, s]));
  const holdFrames = Math.ceil((ep.bible.timing.beatGapMs / 1000) * timeline.fps);
  const blocks: CaptionBlock[] = [];
  const violations: string[] = [];

  segments.forEach((seg, k) => {
    const p = placed.get(seg.cue)!;
    const groups = layoutCaption(seg.text, rules, style.caption.maxLines);
    const weights = groups.map((g) => g.reduce((a, l) => a + lineWidth(l), 0));
    const total = weights.reduce((a, b) => a + b, 0);
    const span = p.endFrame - p.startFrame;
    // captions stay up through short pauses so they do not flicker between segments
    const next = placed.get(segments[k + 1]?.cue ?? "");
    const segEnd = next && next.startFrame - p.endFrame <= holdFrames ? next.startFrame : p.endFrame;
    let acc = 0;
    groups.forEach((g, i) => {
      const start = p.startFrame + Math.round((acc / total) * span);
      acc += weights[i];
      const end = i === groups.length - 1 ? segEnd : p.startFrame + Math.round((acc / total) * span);
      for (const l of g) if (lineWidth(l) > rules.maxLineChars) violations.push(`${seg.cue}: line "${l}" has ${lineWidth(l)} > ${rules.maxLineChars} chars`);
      if (g.length > style.caption.maxLines) violations.push(`${seg.cue}: block has ${g.length} lines`);
      blocks.push({ index: blocks.length + 1, cue: seg.cue, shot: seg.shot, startFrame: start, endFrame: end, lines: g });
    });
  });

  const file = CaptionsFile.parse({ lang, fps: timeline.fps, blocks });
  writeJson(path.join(ep.buildDir, `captions.${lang}.json`), file);
  const srt = blocks
    .map((b) => `${b.index}\n${framesToSrtTime(b.startFrame, timeline.fps)} --> ${framesToSrtTime(b.endFrame, timeline.fps)}\n${b.lines.join("\n")}\n`)
    .join("\n");
  fs.writeFileSync(path.join(ep.buildDir, lang, `${ep.id}.${lang}${selectionTag(ep)}.srt`), srt);
  ep.log.info(`[captions] ${lang}: ${blocks.length} blocks${violations.length ? `, ${violations.length} violations` : ""}`);
  return { file, violations };
}
