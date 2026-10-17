import { componentSpecs, type CaptionBlock, type Layer, type RenderInput } from "@ai-history/schemas";
import type { ShotContext } from "../lib/context";
import { computeLayout } from "../lib/layout";
import { typewriterBoxes } from "../grammar/Typewriter";
import { captionBoxes } from "../grammar/Caption";
import { aiLabelBox } from "../grammar/AILabel";
import type { TextBox } from "../lib/text";

export interface ResolvedPart {
  component: string;
  props: unknown;
  ctx: ShotContext;
}

export interface ResolvedShot {
  shotId: string;
  start: number;
  duration: number;
  parts: ResolvedPart[];
  captions: CaptionBlock[]; // frames relative to the shot
  base: ShotContext;
  // local frame until which the explicit AI label stays up (0 = not in this shot)
  aiLabelUntil: number;
  grade?: { saturation: number };
}

export function resolveText(input: RenderInput, key: string): string {
  if (key.startsWith("doc:")) return input.documents.documents[key.slice(4)].text;
  const s = input.strings[key];
  if (s === undefined) throw new Error(`strings.${input.lang}.json has no "${key}"`);
  return s;
}

// Turn skeleton + timeline into what each component sees: event frames relative to the shot start.
export function resolveShot(input: RenderInput, shotId: string): ResolvedShot {
  const { skeleton, timeline, bible, lang } = input;
  const shot = skeleton.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`no shot ${shotId}`);
  const range = timeline.shots[shotId];
  if (!range) throw new Error(`timeline has no ${shotId}`);
  const [start, end] = range;
  const layout = computeLayout(bible, bible.canvas.width, bible.canvas.height, lang);
  const texts: Record<string, string> = {};
  for (const [slot, key] of Object.entries(skeleton.screenText)) {
    const [sid, name] = slot.split(".");
    if (sid === shotId) texts[name] = resolveText(input, key);
  }
  const base: ShotContext = { bible, lang, layout, shotId, durationInFrames: end - start, events: {}, texts };
  const layers: Layer[] = [{ component: shot.component, props: shot.props, cueBindings: shot.cueBindings }, ...(shot.layers ?? [])];
  const parts = layers.map((l) => {
    const spec = componentSpecs[l.component as keyof typeof componentSpecs];
    const events: Record<string, number> = {};
    for (const [cue, event] of Object.entries(l.cueBindings)) if (timeline.cues[cue] !== undefined) events[event] = timeline.cues[cue] - start;
    return { component: l.component, props: spec ? spec.props.parse(l.props) : l.props, ctx: { ...base, events } };
  });
  const captions = input.captions.blocks
    .filter((b) => b.shot === shotId)
    .map((b) => ({ ...b, startFrame: b.startFrame - start, endFrame: b.endFrame - start }));
  const labelEnd = Math.round(bible.aiLabel.showUntilSec * bible.canvas.fps);
  return { shotId, start, duration: end - start, parts, captions, base, aiLabelUntil: Math.max(0, Math.min(end, labelEnd) - start), grade: shot.grade };
}

// Every text box drawn in a shot, for font loading and the text-overflow gate.
export function shotTextBoxes(input: RenderInput, shot: ResolvedShot): TextBox[] {
  const boxes: TextBox[] = [...captionBoxes(shot.base, shot.captions)];
  if (shot.aiLabelUntil > 0) boxes.push(aiLabelBox(shot.base, input.strings.ai_label));
  for (const p of shot.parts) {
    if (p.component === "grammar/Typewriter") boxes.push(...typewriterBoxes(p.props as Parameters<typeof typewriterBoxes>[0], p.ctx));
  }
  return boxes;
}
