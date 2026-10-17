import type { LayoutProbeResult, RenderInput } from "@ai-history/schemas";
import { loadFonts } from "../lib/fonts";
import { fitBox } from "../lib/text";
import { resolveShot, shotTextBoxes } from "./resolve";

// Runs inside the renderer's browser (calculateMetadata): fitText for every text box in the selection.
export async function probeLayout(input: RenderInput): Promise<LayoutProbeResult> {
  const shots = input.timeline.selection.map((id) => resolveShot(input, id));
  const boxes = shots.flatMap((s) => shotTextBoxes(input, s));
  await loadFonts(input.bible, boxes.map((b) => b.text));
  return boxes.map((b) => {
    const { fontSize, width } = fitBox(b);
    return { id: b.id, text: b.text, fontSize, minFontSize: b.minFontSize, width, maxWidth: b.maxWidth };
  });
}
