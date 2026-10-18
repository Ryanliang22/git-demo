import { useCurrentFrame } from "remotion";
import { measureText } from "@remotion/layout-utils";
import type { TypewriterProps } from "@ai-history/schemas";
import type { z } from "zod";
import type { ComponentProps, ShotContext } from "../lib/context";
import { roleFamily } from "../lib/fonts";
import { appear, blinkOn, lerp, progress } from "../lib/motion";
import { fitBox, type TextBox } from "../lib/text";
import { CursorGlyph } from "./Cursor";

type Props = z.infer<typeof TypewriterProps>;

export function typewriterBoxes(props: Props, ctx: ShotContext): TextBox[] {
  const { layout } = ctx;
  return [
    {
      id: `${ctx.shotId}.typewriter.${props.slot}`,
      text: ctx.texts[props.slot],
      fontFamily: roleFamily(ctx.bible, props.font, ctx.lang),
      fontWeight: 400,
      maxWidth: layout.stage.w * 0.8,
      maxFontSize: layout.u * 7,
      minFontSize: layout.u * 4,
    },
  ];
}

// A blinking cursor waits in the centre; on `type` it hops to the start of the line and types it;
// `newLine` sends it to an empty line below.
export const Typewriter: React.FC<ComponentProps<Props>> = ({ props, ctx }) => {
  const frame = useCurrentFrame();
  const { bible, layout, events } = ctx;
  const [box] = typewriterBoxes(props, ctx);
  const { fontSize, width } = fitBox(box);
  const lineH = fontSize * 1.3;
  const x0 = layout.cx - width / 2;
  const y0 = layout.stage.y + layout.stage.h / 2 - lineH;

  const chars = [...box.text];
  const slide = bible.motion.appearFrames / 2;
  const toStart = progress(frame, events.type, slide);
  const typeFrom = events.type === undefined ? undefined : events.type + slide;
  // type at the bible's pace, slowed (up to 3x) so the line finishes with the sentence that introduces it
  const until = events.newLine ?? events.fadeOut ?? ctx.durationInFrames;
  const perChar = typeFrom === undefined ? 1 : Math.min(bible.motion.typeFramesPerChar * 3, Math.max(bible.motion.typeFramesPerChar, ((until - typeFrom) * 0.75) / chars.length));
  const typing = typeFrom === undefined ? 0 : Math.max(0, Math.floor((frame - typeFrom) / perChar));
  const typed = chars.slice(0, Math.min(chars.length, typing)).join("");
  const isTyping = typeFrom !== undefined && frame >= events.type! && typing < chars.length;
  const typedW = typed ? measureText({ text: typed, fontFamily: box.fontFamily, fontWeight: box.fontWeight, fontSize }).width : 0;

  const nl = appear(frame, events.newLine, bible);
  const curH = fontSize * 1.05;
  const curW = fontSize * 0.55;
  const curX = lerp(lerp(layout.cx - curW / 2, x0 + fontSize * 0.08, toStart) + typedW, x0, nl);
  const curY = lerp(y0 + (lineH - curH) / 2, y0 + lineH * 1.5 + (lineH - curH) / 2, nl);
  const shown = appear(frame, events.showCursor ?? events.type, bible);
  const fade = 1 - appear(frame, events.fadeOut, bible);
  const blinkFrom = events.newLine !== undefined && frame >= events.newLine ? events.newLine : (events.showCursor ?? 0);
  const on = isTyping || blinkOn(frame, bible, blinkFrom);

  return (
    <div style={{ position: "absolute", inset: 0, opacity: fade }}>
      <div
        style={{
          position: "absolute",
          left: x0,
          top: y0,
          height: lineH,
          lineHeight: `${lineH}px`,
          fontFamily: box.fontFamily,
          fontSize,
          color: bible.colors.text,
          whiteSpace: "pre",
          opacity: lerp(1, 0.78, nl),
        }}
      >
        {typed}
      </div>
      <CursorGlyph x={curX} y={curY} w={curW} h={curH} color={bible.colors.amber} opacity={shown * (on ? 1 : 0.12)} />
    </div>
  );
};
