import { z } from "zod";
import { ClaimId, ClaimStatus, CueName, LangCode, ShotId } from "./data";

// Contracts between pipeline stages (files under episodes/<ep>/build/).

export const Segment = z.strictObject({
  cue: CueName,
  text: z.string().min(1),
  claims: z.array(ClaimId), // empty array = narrative line [[N]]
  beat: z.string(),
  shot: ShotId,
});
export type Segment = z.infer<typeof Segment>;
export const SegmentsFile = z.array(Segment);

export const TtsResult = z.strictObject({
  hash: z.string(),
  engine: z.string(),
  engineVersion: z.string(),
  voice: z.string(),
  text: z.string(),
  durationSec: z.number(),
  characters: z.number().int(),
  file: z.string(),
});
export type TtsResult = z.infer<typeof TtsResult>;

export const TtsIndex = z.strictObject({
  lang: LangCode,
  segments: z.array(z.strictObject({ cue: CueName, hash: z.string(), file: z.string(), durationSec: z.number(), characters: z.number().int() })),
});
export type TtsIndex = z.infer<typeof TtsIndex>;

export const Timeline = z.strictObject({
  fps: z.number().int(),
  cues: z.record(CueName, z.number().int()),
  shots: z.record(ShotId, z.tuple([z.number().int(), z.number().int()])), // [start, end) frames
  totalFrames: z.number().int(),
  audio: z.string(),
  lang: LangCode,
  selection: z.array(ShotId),
  segments: z.array(
    z.strictObject({ cue: CueName, shot: ShotId, startFrame: z.number().int(), endFrame: z.number().int(), ttsHash: z.string() }),
  ),
  warnings: z.array(z.string()),
});
export type Timeline = z.infer<typeof Timeline>;

export const CaptionBlock = z.strictObject({
  index: z.number().int(),
  cue: CueName,
  shot: ShotId,
  startFrame: z.number().int(),
  endFrame: z.number().int(),
  lines: z.array(z.string()).min(1),
});
export type CaptionBlock = z.infer<typeof CaptionBlock>;
export const CaptionsFile = z.strictObject({ lang: LangCode, fps: z.number().int(), blocks: z.array(CaptionBlock) });
export type CaptionsFile = z.infer<typeof CaptionsFile>;

export const QcCheck = z.strictObject({
  id: z.string(),
  status: z.enum(["pass", "fail", "skipped", "manual"]),
  detail: z.string(),
  data: z.unknown().optional(),
});
export type QcCheck = z.infer<typeof QcCheck>;
export const QcReport = z.strictObject({
  lang: LangCode,
  milestone: z.string(),
  video: z.string(),
  checks: z.array(QcCheck),
  passed: z.boolean(),
});
export type QcReport = z.infer<typeof QcReport>;

export const RenderLog = z.strictObject({
  lang: LangCode,
  shots: z.array(
    z.strictObject({
      id: ShotId,
      hash: z.string(),
      cached: z.boolean(),
      frames: z.number().int(),
      startFrameInOutput: z.number().int(),
      renderMs: z.number(),
      file: z.string(),
    }),
  ),
  totalRenderMs: z.number(),
  output: z.string(),
});
export type RenderLog = z.infer<typeof RenderLog>;

export const Manifest = z.strictObject({
  episode: z.string(),
  lang: LangCode,
  milestone: z.string(),
  createdAt: z.string(),
  git: z.strictObject({ commit: z.string(), dirty: z.boolean() }),
  bibleVersion: z.string(),
  components: z.record(z.string(), z.string()),
  tts: z.strictObject({ engine: z.string(), engineVersion: z.string(), voice: z.string(), characters: z.number().int(), license: z.string() }),
  llmTokens: z.strictObject({ input: z.number().nullable(), output: z.number().nullable(), note: z.string() }),
  renderMs: z.number(),
  humanMinutes: z.number().nullable(),
  claims: z.array(z.strictObject({ id: ClaimId, status: ClaimStatus, waived: z.boolean() })),
  licenses: z.array(z.strictObject({ kind: z.string(), name: z.string(), license: z.string(), path: z.string() })),
  qc: z.strictObject({ passed: z.boolean(), report: z.string() }),
  outputs: z.record(z.string(), z.string()),
  aiLabel: z.strictObject({ explicit: z.array(z.string()), implicit: z.string() }),
});
export type Manifest = z.infer<typeof Manifest>;
