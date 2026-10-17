import { useCurrentFrame } from "remotion";
import type { ShotContext } from "../lib/context";
import { familyOf } from "../lib/fonts";
import { progress } from "../lib/motion";

// Explicit AI label, top-left of the safe area. The shell decides the window (spec: 0–3 s and end card).
export const AILabel: React.FC<{ ctx: ShotContext; text: string; untilFrame: number; inline?: boolean }> = ({ ctx, text, untilFrame, inline }) => {
  const frame = useCurrentFrame();
  const { bible, layout } = ctx;
  const out = progress(frame, untilFrame, bible.motion.appearFrames);
  if (out >= 1) return null;
  const size = bible.aiLabel.fontSize;
  const inset = layout.u * 2.2;
  return (
    <div
      style={{
        position: inline ? "relative" : "absolute",
        left: inline ? undefined : layout.safe.x + inset,
        top: inline ? undefined : layout.safe.y + inset,
        display: "flex",
        alignItems: "center",
        gap: size * 0.45,
        opacity: bible.aiLabel.opacity * (1 - out),
        fontFamily: familyOf(bible, bible.languages[ctx.lang].font),
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1,
        color: bible.colors.text,
      }}
    >
      <div style={{ width: size * 0.42, height: size * 0.42, borderRadius: "50%", background: bible.colors.blue }} />
      {text}
    </div>
  );
};

export function aiLabelBox(ctx: ShotContext, text: string) {
  return {
    id: `${ctx.shotId}.ai_label`,
    text,
    fontFamily: familyOf(ctx.bible, ctx.bible.languages[ctx.lang].font),
    fontWeight: 600,
    maxWidth: ctx.layout.safe.w / 2,
    maxFontSize: ctx.bible.aiLabel.fontSize,
    minFontSize: ctx.bible.aiLabel.fontSize,
  };
}
