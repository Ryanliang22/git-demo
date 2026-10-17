import fs from "node:fs";
import path from "node:path";
import type { CaptionsFile, Timeline } from "@ai-history/schemas";
import { selectionTag, type Episode } from "../context";
import { ensureDir, ffmpeg } from "../lib/util";
import { loadSegments } from "./tts";

// Spec §11 visual checklist, handed to the independent reviewer together with the sheet.
const CHECKLIST = [
  "文字是否都在安全区内？有没有被截断或互相重叠？",
  "每个 cue 帧的画面，是否在表达对应的那句旁白？",
  "同一时刻是否只有一个视觉焦点？",
  "有没有出现禁区内容：肖像、苹果、对死因的暗示？",
  "字幕在手机尺寸下是否看得清？",
];

const SCALE = 0.4;
const COLS = 5;

export interface Still {
  n: number;
  shot: string;
  kind: "cue" | "mid";
  cue?: string;
  frame: number;
  narration: string;
}

// A still at every cue (taken once its entrance has settled: cue + bible.motion.appearFrames) and at
// every shot midpoint, safe area drawn on top, tiled into a contact sheet for review.
export async function stills(ep: Episode, lang: string, opts: { timeline: Timeline; captions: CaptionsFile }) {
  const { timeline } = opts;
  const tag = selectionTag(ep);
  const video = path.join(ep.buildDir, lang, `${ep.id}.${lang}${tag}.mp4`);
  if (!fs.existsSync(video)) throw new Error(`missing ${video}; run render first`);
  const dir = ensureDir(path.join(ep.buildDir, lang, "review"));
  const raw = ensureDir(path.join(dir, `stills${tag}`));
  for (const f of fs.readdirSync(raw)) fs.rmSync(path.join(raw, f));

  const segments = loadSegments(ep, lang);
  const narrationAt = (frame: number) => {
    const seg = timeline.segments.filter((s) => s.startFrame <= frame).pop();
    return seg ? (segments.find((s) => s.cue === seg.cue)?.text ?? "") : "";
  };
  const list: Omit<Still, "n">[] = [];
  for (const shotId of timeline.selection) {
    const [a, b] = timeline.shots[shotId];
    for (const seg of timeline.segments.filter((s) => s.shot === shotId)) {
      const f = Math.min(b - 1, seg.startFrame + ep.bible.motion.appearFrames);
      list.push({ shot: shotId, kind: "cue", cue: seg.cue, frame: f, narration: segments.find((s) => s.cue === seg.cue)?.text ?? "" });
    }
    const mid = Math.floor((a + b) / 2);
    list.push({ shot: shotId, kind: "mid", frame: mid, narration: narrationAt(mid) });
  }
  list.sort((x, y) => x.frame - y.frame || (x.kind === "cue" ? -1 : 1));
  const items: Still[] = list.map((s, i) => ({ ...s, n: i + 1 }));

  const W = Math.round(ep.bible.canvas.width * SCALE);
  const H = Math.round(ep.bible.canvas.height * SCALE);
  const sa = ep.bible.safeArea;
  const safe = {
    x: Math.round(sa.left * SCALE),
    y: Math.round(sa.top * SCALE),
    w: Math.round((ep.bible.canvas.width - sa.left - sa.right) * SCALE),
    h: Math.round((ep.bible.canvas.height - sa.top - sa.bottom) * SCALE),
  };
  const font = ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find((f) => fs.existsSync(f));
  for (const s of items) {
    const full = path.join(raw, `${String(s.n).padStart(2, "0")}-${s.shot}-${s.cue ?? "mid"}.png`);
    await ffmpeg(["-i", video, "-vf", `select=eq(n\\,${s.frame})`, "-vsync", "0", "-frames:v", "1", full]);
    const label = `#${s.n} ${s.shot} ${s.cue ?? "midpoint"} f${s.frame}`.replace(/:/g, "\\:");
    const filters = [
      `scale=${W}:${H}`,
      `drawbox=x=${safe.x}:y=${safe.y}:w=${safe.w}:h=${safe.h}:color=magenta@0.85:t=2`,
      `pad=${W}:${H + 40}:0:0:color=0x1a1a1a`,
      font ? `drawtext=fontfile=${font}:text='${label}':x=10:y=${H + 10}:fontsize=20:fontcolor=white` : "",
    ].filter(Boolean);
    await ffmpeg(["-i", full, "-vf", filters.join(","), path.join(raw, `tile-${String(s.n).padStart(3, "0")}.png`)]);
  }
  const rows = Math.ceil(items.length / COLS);
  const sheet = path.join(dir, `contact-sheet${tag}.png`);
  await ffmpeg([
    "-framerate", "1", "-i", path.join(raw, "tile-%03d.png"),
    "-vf", `tile=${COLS}x${rows}:padding=8:margin=8:color=0x000000`, "-frames:v", "1", sheet,
  ]);
  for (const f of fs.readdirSync(raw)) if (f.startsWith("tile-")) fs.rmSync(path.join(raw, f));

  const packet = [
    `# 审图包 ${ep.id} · ${lang}${tag}`,
    "",
    `Contact sheet: \`${path.relative(ep.dir, sheet)}\`（每格下方标注 #编号、镜头、cue、帧号；洋红色框为安全区）`,
    "",
    "## 每张静帧对应的旁白",
    "",
    "| # | 镜头 | 时刻 | 旁白 |",
    "|---|---|---|---|",
    ...items.map((s) => `| ${s.n} | ${s.shot} | ${s.kind === "cue" ? `cue \`${s.cue}\`` : "镜头中点"} | ${s.narration} |`),
    "",
    "## 视觉检查表（规格第 11 节）",
    "",
    ...CHECKLIST.map((c, i) => `${i + 1}. ${c}`),
    "",
    "请逐条回答检查表，再列出问题清单（每条注明静帧编号）。",
    "",
  ].join("\n");
  const packetFile = path.join(dir, `review-packet${tag}.md`);
  fs.writeFileSync(packetFile, packet);
  ep.log.info(`[stills] ${lang}: ${items.length} stills → ${path.relative(ep.dir, sheet)}, ${path.relative(ep.dir, packetFile)}`);
  return { sheet, packet: packetFile, items };
}
