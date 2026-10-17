import type { ShotContext } from "../lib/context";
import { familyOf } from "../lib/fonts";

// Title block for the cover still (spec §5 export: S01 end frame + title). Wraps freely; no fitText.
export const CoverTitle: React.FC<{ ctx: ShotContext; title: string; mark: string }> = ({ ctx, title, mark }) => {
  const { bible, layout, lang } = ctx;
  const family = familyOf(bible, bible.languages[lang].font);
  const size = bible.languages[lang].caption.fontSize * 1.35;
  return (
    <div
      style={{
        position: "absolute",
        left: layout.safe.x + layout.u * 2.2,
        width: layout.safe.w - layout.u * 4.4,
        bottom: layout.height - (layout.caption.y + layout.caption.h),
        fontFamily: family,
        color: bible.colors.text,
      }}
    >
      <div style={{ fontSize: size * 0.5, fontWeight: 600, color: bible.colors.amber, marginBottom: size * 0.3 }}>{mark}</div>
      <div style={{ fontSize: size, fontWeight: 600, lineHeight: 1.25 }}>{title}</div>
    </div>
  );
};
