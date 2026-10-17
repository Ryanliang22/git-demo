import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import type { RenderInput } from "@ai-history/schemas";
import { AILabel } from "../grammar/AILabel";
import { Caption } from "../grammar/Caption";
import { CoverTitle } from "../grammar/CoverTitle";
import { familyOf, loadFonts } from "../lib/fonts";
import { registry } from "../registry";
import { resolveShot, shotTextBoxes } from "./resolve";

// One shot: background, the shot's components, then overlays that every shot
// carries: caption, explicit AI label (first seconds of the episode), DRAFT mark.
export const ShotFrame: React.FC<{ input: RenderInput; shotId: string }> = ({ input, shotId }) => {
  const shot = resolveShot(input, shotId);
  const { bible } = input;
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender(`fonts for ${shotId}`));
  useEffect(() => {
    const texts = [...shotTextBoxes(input, shot).map((b) => b.text), input.strings.draft_mark, "0123456789", input.cover?.title ?? "", input.cover?.seriesMark ?? ""];
    loadFonts(bible, texts)
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((e) => {
        throw e;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <AbsoluteFill style={{ background: bible.colors.bg }} />;

  const { layout } = shot.base;
  return (
    <AbsoluteFill style={{ background: bible.colors.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: shot.grade ? `saturate(${shot.grade.saturation})` : undefined }}>
        {shot.parts.map((p, i) => {
          const C = registry[p.component];
          if (!C) throw new Error(`${p.component} is not implemented yet (needed by ${shotId})`);
          return <C key={i} props={p.props} ctx={p.ctx} />;
        })}
      </AbsoluteFill>
      {input.cover ? <CoverTitle ctx={shot.base} title={input.cover.title} mark={input.cover.seriesMark} /> : <Caption ctx={shot.base} blocks={shot.captions} />}
      {shot.aiLabelUntil > 0 && !input.cover ? <AILabel ctx={shot.base} text={input.strings.ai_label} untilFrame={shot.aiLabelUntil} /> : null}
      {input.draft ? (
        <div
          style={{
            position: "absolute",
            right: layout.width - (layout.safe.x + layout.safe.w) + layout.u * 2.2,
            top: layout.safe.y + layout.u * 2.2,
            fontFamily: familyOf(bible, "mono"),
            fontWeight: 700,
            fontSize: bible.draftMark.fontSize,
            letterSpacing: bible.draftMark.fontSize * 0.2,
            color: bible.colors.textMuted,
            opacity: bible.draftMark.opacity,
          }}
        >
          {input.strings.draft_mark}
        </div>
      ) : null}
      {input.debug.safeArea ? (
        <div
          style={{
            position: "absolute",
            left: layout.safe.x,
            top: layout.safe.y,
            width: layout.safe.w,
            height: layout.safe.h,
            outline: `2px dashed ${bible.colors.textMuted}`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
