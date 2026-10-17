import { useCurrentFrame } from "remotion";
import type { CaptionBlock } from "@ai-history/schemas";
import type { ShotContext } from "../lib/context";
import { familyOf } from "../lib/fonts";
import { fitBox, type TextBox } from "../lib/text";

export function captionBoxes(ctx: ShotContext, blocks: CaptionBlock[]): TextBox[] {
  const { bible, layout, lang } = ctx;
  const style = bible.languages[lang].caption;
  return blocks.flatMap((b) =>
    b.lines.map((line, i) => ({
      id: `${b.shot}.caption.${b.index}.${i}`,
      text: line,
      fontFamily: familyOf(bible, bible.languages[lang].font),
      fontWeight: bible.caption.weight,
      maxWidth: layout.caption.w - 2 * bible.caption.paddingX,
      maxFontSize: style.fontSize,
      minFontSize: style.minFontSize,
    })),
  );
}

// Burned-in caption: bottom of the safe area, all lines of a block share one fitted size.
export const Caption: React.FC<{ ctx: ShotContext; blocks: CaptionBlock[] }> = ({ ctx, blocks }) => {
  const frame = useCurrentFrame();
  const block = blocks.find((b) => frame >= b.startFrame && frame < b.endFrame);
  if (!block) return null;
  const { bible, layout } = ctx;
  const boxes = captionBoxes(ctx, [block]);
  const fits = boxes.map(fitBox);
  const fontSize = Math.min(...fits.map((f) => f.fontSize));
  const lineH = fontSize * bible.caption.lineHeight;
  return (
    <div
      style={{
        position: "absolute",
        left: layout.caption.x,
        width: layout.caption.w,
        bottom: layout.height - (layout.caption.y + layout.caption.h),
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: bible.caption.background,
          borderRadius: bible.caption.radius,
          padding: `${bible.caption.paddingY}px ${bible.caption.paddingX}px`,
          fontFamily: boxes[0].fontFamily,
          fontWeight: bible.caption.weight,
          fontSize,
          lineHeight: `${lineH}px`,
          color: bible.colors.text,
          textAlign: "center",
          whiteSpace: "pre",
        }}
      >
        {block.lines.join("\n")}
      </div>
    </div>
  );
};
