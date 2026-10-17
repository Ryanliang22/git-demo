import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import type { Bible, CaptionBlock } from "@ai-history/schemas";
import { AILabel } from "../grammar/AILabel";
import { Caption } from "../grammar/Caption";
import type { ShotContext } from "../lib/context";
import { loadFonts } from "../lib/fonts";
import { computeLayout } from "../lib/layout";
import { registry } from "../registry";

// One component on its own, for the library's preview stills (packages/components/previews/).
export interface PreviewInput {
  bible: Bible;
  lang: string;
  component: string;
  props: unknown;
  events: Record<string, number>;
  texts: Record<string, string>;
  caption: CaptionBlock | null;
  label: string;
  duration: number;
}

export const Preview: React.FC<{ preview?: PreviewInput }> = ({ preview }) => {
  const [handle] = useState(() => delayRender("preview fonts"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!preview) return continueRender(handle);
    loadFonts(preview.bible, [...Object.values(preview.texts), ...(preview.caption?.lines ?? []), preview.label, "0123456789"]).then(() => {
      setReady(true);
      continueRender(handle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!preview || !ready) return <AbsoluteFill />;
  const { bible, lang } = preview;
  const ctx: ShotContext = {
    bible,
    lang,
    layout: computeLayout(bible, bible.canvas.width, bible.canvas.height, lang),
    shotId: "preview",
    durationInFrames: preview.duration,
    events: preview.events,
    texts: preview.texts,
  };
  const C = registry[preview.component];
  return (
    <AbsoluteFill style={{ background: bible.colors.bg }}>
      {preview.component === "grammar/Caption" && preview.caption ? <Caption ctx={ctx} blocks={[preview.caption]} /> : null}
      {preview.component === "grammar/AILabel" ? <AILabel ctx={ctx} text={preview.label} untilFrame={preview.duration} /> : null}
      {C ? <C props={preview.props} ctx={ctx} /> : null}
    </AbsoluteFill>
  );
};
