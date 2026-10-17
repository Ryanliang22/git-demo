import { useCurrentFrame } from "remotion";
import type { YearStampProps } from "@ai-history/schemas";
import type { z } from "zod";
import type { ComponentProps } from "../lib/context";
import { familyOf } from "../lib/fonts";
import { mix } from "../lib/color";
import { appear, lerp, move, progress } from "../lib/motion";

// A year: large in the centre on `show`, docked small in the top-left corner on `dock`. While it is
// held in the centre it pushes in slowly and a thin rule draws itself under the digits (time passing).
export const YearStamp: React.FC<ComponentProps<z.infer<typeof YearStampProps>>> = ({ props, ctx }) => {
  const frame = useCurrentFrame();
  const { bible, layout, events } = ctx;
  const a = appear(frame, events.show, bible);
  const gone = appear(frame, events.hide, bible);
  if (a <= 0 || gone >= 1) return null;
  const d = move(frame, events.dock, bible);
  const holdEnd = events.dock ?? events.hide ?? ctx.durationInFrames;
  const hold = events.show === undefined ? 0 : progress(frame, events.show + bible.motion.appearFrames, holdEnd - events.show - bible.motion.appearFrames);
  const big = layout.u * 22 * (1 + bible.motion.holdDrift * hold);
  const small = layout.u * 6;
  const fontSize = lerp(big, small, d);
  const text = String(props.year);
  // monospace digits: width = 0.6em per digit
  const w = fontSize * 0.6 * text.length;
  const inset = layout.u * 2.2;
  const x = lerp(layout.cx - w / 2, layout.safe.x + inset, d);
  const y = lerp(layout.stage.y + layout.stage.h * 0.42 - fontSize / 2 + (1 - a) * layout.u * 3, layout.safe.y + inset, d);
  return (
    <>
    <div
      style={{
        position: "absolute",
        left: layout.cx - (big * 0.6 * text.length) / 2,
        top: layout.stage.y + layout.stage.h * 0.42 + big * 0.62,
        width: big * 0.6 * text.length * hold,
        height: layout.u * 0.35,
        background: bible.colors.textMuted,
        opacity: a * (1 - progress(frame, events.dock, bible.motion.appearFrames / 2)) * (1 - gone),
      }}
    />
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontFamily: familyOf(bible, "mono"),
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        letterSpacing: 0,
        color: mix(bible.colors.text, bible.colors.textMuted, d),
        opacity: a * (1 - gone),
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </div>
    </>
  );
};
