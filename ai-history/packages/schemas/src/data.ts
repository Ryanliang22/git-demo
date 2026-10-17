import { z } from "zod";

// Series- and episode-level data contracts. Fields may be added, never removed or re-purposed.

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const Id = z.string().regex(/^[a-z0-9_]+$/);
export const CueName = Id;
export const ShotId = z.string().regex(/^S\d{2}$/);
export const ClaimId = z.string().regex(/^C\d{2,}$/);
export const LangCode = z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/);
// component animation event, e.g. "showTape"
export const EventName = z.string().regex(/^[a-z][A-Za-z0-9]*$/);

// ---------- bible.json ----------

export const FontToken = z.strictObject({
  family: z.string(),
  package: z.string(),
  license: z.string(),
  licenseFile: z.string(),
  weights: z.array(z.number().int()),
});

export const VoiceConfig = z.strictObject({
  engine: z.string(),
  voice: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  license: z.string().optional(),
});

export const LanguageStyle = z.strictObject({
  font: z.string(),
  caption: z.strictObject({
    maxLineChars: z.number().int().positive(),
    maxLines: z.number().int().positive(),
    fontSize: z.number().positive(),
    minFontSize: z.number().positive(),
    // punctuation that is dropped at the end of a caption line (subtitle convention)
    dropLineEndPunct: z.string(),
  }),
  // how the mock engine / estimators count spoken units
  unit: z.enum(["char", "word"]),
});

export const Bible = z.strictObject({
  version: z.string(),
  canvas: z.strictObject({ width: z.number().int(), height: z.number().int(), fps: z.number().int() }),
  colors: z.strictObject({
    bg: Hex,
    text: Hex,
    textMuted: Hex,
    amber: Hex,
    blue: Hex,
    red: Hex,
  }),
  // color token -> shots where it may be used (absent = everywhere)
  colorRules: z.record(z.string(), z.array(ShotId)),
  fonts: z.record(z.string(), FontToken),
  motion: z.strictObject({
    easing: z.literal("cubicInOut"),
    appearFrames: z.number().int().positive(),
    moveFrames: z.number().int().positive(),
    minHoldFrames: z.number().int().positive(),
    typeFramesPerChar: z.number().positive(),
    cursorBlinkFrames: z.number().int().positive(),
    // scale a held element gains over its hold (slow push-in) so holds never read as frozen frames
    holdDrift: z.number(),
  }),
  safeArea: z.strictObject({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  languages: z.record(LangCode, LanguageStyle),
  caption: z.strictObject({
    weight: z.number().int(),
    lineHeight: z.number(),
    paddingX: z.number(),
    paddingY: z.number(),
    radius: z.number(),
    background: z.string(),
  }),
  aiLabel: z.strictObject({ fontSize: z.number(), showUntilSec: z.number(), opacity: z.number() }),
  draftMark: z.strictObject({ fontSize: z.number(), opacity: z.number() }),
  voice: z.strictObject({ narrator: z.record(LangCode, VoiceConfig) }),
  timing: z.strictObject({ segmentGapMs: z.number(), beatGapMs: z.number() }),
  audio: z.strictObject({
    sampleRate: z.number().int(),
    loudness: z.strictObject({ integratedLufs: z.number(), toleranceLu: z.number(), truePeakDbtp: z.number() }),
  }),
  turing: z.strictObject({
    cellWidthRatio: z.number(),
    tapeCenterRatio: z.number(),
    stateColors: z.array(z.string()),
    stepFrames: z.number().int(),
  }),
  qc: z.strictObject({
    blackdetect: z.strictObject({ pixTh: z.number(), minSec: z.number() }),
    freezedetect: z.strictObject({ noiseDb: z.number(), minSec: z.number() }),
    avSyncToleranceFrames: z.number().int(),
  }),
});
export type Bible = z.infer<typeof Bible>;

// ---------- skeleton.json ----------

export const ComponentName = z.string().regex(/^(grammar|signature)\/[A-Z][A-Za-z]+$/);

export const Layer = z.strictObject({
  component: ComponentName,
  props: z.record(z.string(), z.unknown()),
  cueBindings: z.record(CueName, EventName),
});
export type Layer = z.infer<typeof Layer>;

export const Shot = z.strictObject({
  id: ShotId,
  beat: z.string().regex(/^B\d+$/),
  startCue: CueName,
  component: ComponentName,
  props: z.record(z.string(), z.unknown()),
  cueBindings: z.record(CueName, EventName),
  minSec: z.number().positive(),
  maxSec: z.number().positive(),
  // additional components drawn above the main one (same cue-binding mechanism)
  layers: z.array(Layer).optional(),
  // freeze frames are tolerated in this shot by the freezedetect gate
  allowFreeze: z.boolean().optional(),
  // whole-shot grade, e.g. desaturation in S10
  grade: z.strictObject({ saturation: z.number().min(0).max(1) }).optional(),
});
export type Shot = z.infer<typeof Shot>;

export const Skeleton = z.strictObject({
  episode: z.string().regex(/^ep\d{3}$/),
  format: z.strictObject({
    width: z.number().int(),
    height: z.number().int(),
    fps: z.number().int(),
    targetSec: z.tuple([z.number(), z.number()]),
    maxSec: z.number(),
  }),
  cueOrder: z.array(CueName).min(1),
  shots: z.array(Shot).min(1),
  // "<shot>.<slot>" -> strings key, or "doc:<id>" for language-invariant document text
  screenText: z.record(z.string().regex(/^S\d{2}\.[a-z_]+$/), z.string()),
});
export type Skeleton = z.infer<typeof Skeleton>;

// ---------- claims.json ----------

export const ClaimStatus = z.enum(["pending", "verified", "rejected"]);
export const Claim = z.strictObject({
  id: ClaimId,
  text: z.string(),
  textZh: z.string().optional(),
  sources: z.array(z.strictObject({ title: z.string(), url: z.string(), excerpt: z.string() })).min(1),
  risk: z.enum(["low", "medium", "high"]),
  status: ClaimStatus,
  notes: z.string(),
});
export type Claim = z.infer<typeof Claim>;
export const ClaimsFile = z.strictObject({ claims: z.array(Claim) });

// ---------- entities.json / glossary.json ----------

const Localized = z.record(LangCode, z.string());
export const EntitiesFile = z.strictObject({
  entities: z.array(
    z.strictObject({
      id: Id,
      kind: z.enum(["person", "work", "organization", "place", "event", "object"]),
      names: Localized,
      notes: z.string().optional(),
    }),
  ),
});
export const GlossaryFile = z.strictObject({
  terms: z.array(z.strictObject({ id: Id, terms: Localized, notes: z.string().optional() })),
});

// ---------- strings.<lang>.json / documents.json ----------

export const Strings = z.record(Id, z.string());
export type Strings = z.infer<typeof Strings>;

// Text of historical documents shown verbatim in every language version (e.g. Turing's 1950 lines).
export const DocumentsFile = z.strictObject({
  documents: z.record(Id, z.strictObject({ text: z.string(), claims: z.array(ClaimId).min(1), entity: Id })),
});
export type DocumentsFile = z.infer<typeof DocumentsFile>;

// ---------- meta.<lang>.json ----------

export const PlatformMeta = z.strictObject({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  // claims the title/description rely on: they pass through the fact gate like script lines
  claims: z.array(ClaimId),
  aiDisclosure: z.strictObject({ required: z.literal(true), setting: z.string(), value: z.string() }),
});
export const MetaFile = z.strictObject({
  lang: LangCode,
  platforms: z.partialRecord(z.enum(["douyin", "bilibili", "youtube_shorts", "tiktok", "x"]), PlatformMeta),
});
export type MetaFile = z.infer<typeof MetaFile>;

// ---------- production.json ----------

export const Production = z.strictObject({
  milestone: z.enum(["M0", "M1", "M2"]),
  // hand-filled: minutes a human spent on this episode
  humanMinutes: z.number().nullable(),
  // claims Ryan explicitly exempted from the verified-only gate
  claimWaivers: z.array(z.strictObject({ id: ClaimId, by: z.string(), date: z.string(), reason: z.string() })),
  assets: z.array(z.strictObject({ kind: z.string(), name: z.string(), license: z.string(), path: z.string() })),
});
export type Production = z.infer<typeof Production>;
