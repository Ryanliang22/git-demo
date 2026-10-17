import type { Bible } from "@ai-history/schemas";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  safe: Rect;
  // caption band at the bottom of the safe area
  caption: Rect;
  // where shot content goes: safe area above the caption band
  stage: Rect;
  // safe-area centre
  cx: number;
  // em-like unit: 1% of the canvas width
  u: number;
}

export function computeLayout(bible: Bible, width: number, height: number, lang: string): Layout {
  const s = bible.safeArea;
  const safe = { x: s.left, y: s.top, w: width - s.left - s.right, h: height - s.top - s.bottom };
  const style = bible.languages[lang].caption;
  const capH = style.maxLines * style.fontSize * bible.caption.lineHeight + 2 * bible.caption.paddingY;
  const caption = { x: safe.x, y: safe.y + safe.h - capH, w: safe.w, h: capH };
  const stage = { x: safe.x, y: safe.y, w: safe.w, h: caption.y - safe.y - bible.caption.paddingY * 2 };
  return { width, height, safe, caption, stage, cx: safe.x + safe.w / 2, u: width / 100 };
}
