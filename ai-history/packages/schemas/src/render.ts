import { z } from "zod";
import { CaptionsFile, Timeline } from "./build";
import { Bible, DocumentsFile, LangCode, ShotId, Skeleton, Strings } from "./data";

// Input props of the Remotion compositions: skeleton + timeline + captions + strings + bible.
export const RenderInput = z.strictObject({
  lang: LangCode,
  bible: Bible,
  skeleton: Skeleton,
  timeline: Timeline,
  captions: CaptionsFile,
  strings: Strings,
  documents: DocumentsFile,
  // shot to render; null renders the whole selection (Studio preview)
  shotId: ShotId.nullable(),
  // watermark for builds that cite unverified claims
  draft: z.boolean(),
  debug: z.strictObject({ safeArea: z.boolean() }),
  // cover still: the shot's frame with the title instead of caption and AI label
  cover: z.strictObject({ title: z.string(), seriesMark: z.string() }).optional(),
});
export type RenderInput = z.infer<typeof RenderInput>;

// Result of the LayoutProbe composition: fitText results for every text box.
export const LayoutProbeResult = z.array(
  z.strictObject({ id: z.string(), text: z.string(), fontSize: z.number(), minFontSize: z.number(), width: z.number(), maxWidth: z.number() }),
);
export type LayoutProbeResult = z.infer<typeof LayoutProbeResult>;
