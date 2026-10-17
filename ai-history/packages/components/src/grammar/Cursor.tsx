import { useCurrentFrame } from "remotion";
import type { CursorProps } from "@ai-history/schemas";
import type { z } from "zod";
import type { ComponentProps } from "../lib/context";
import { appear, blinkOn } from "../lib/motion";

// The narrator's avatar: a blinking amber block.
export const CursorGlyph: React.FC<{ x: number; y: number; w: number; h: number; color: string; opacity: number }> = ({ x, y, w, h, color, opacity }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: color, opacity, borderRadius: w * 0.08 }} />
);

export const Cursor: React.FC<ComponentProps<z.infer<typeof CursorProps>>> = ({ props, ctx }) => {
  const frame = useCurrentFrame();
  const { bible, layout, events } = ctx;
  const shown = appear(frame, events.show, bible) * (1 - appear(frame, events.hide, bible));
  if (shown <= 0) return null;
  const h = layout.u * 8;
  const w = h * 0.55;
  const on = blinkOn(frame, bible, events.show ?? 0);
  return (
    <CursorGlyph
      x={layout.cx - w / 2}
      y={layout.stage.y + layout.stage.h / 2 - h / 2}
      w={w}
      h={h}
      color={bible.colors[props.color]}
      opacity={shown * (on ? 1 : 0.12)}
    />
  );
};
