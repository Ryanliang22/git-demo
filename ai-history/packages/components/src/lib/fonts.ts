import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import type { Bible } from "@ai-history/schemas";

// Every family is bundled (OFL). No stack falls back to system fonts.
export type FontRole = "quote" | "mono" | "body";

export function familyOf(bible: Bible, token: string): string {
  const font = bible.fonts[token];
  if (!font) throw new Error(`bible.fonts has no "${token}"`);
  return `"${font.family}"`;
}

export function roleFamily(bible: Bible, role: FontRole, lang: string): string {
  if (role === "body") return familyOf(bible, bible.languages[lang].font);
  return familyOf(bible, role);
}

// Load exactly the glyph subsets the given texts need, for every family/weight in use.
export async function loadFonts(bible: Bible, texts: string[]): Promise<void> {
  const sample = [...new Set(texts.join(""))].join("") || "0";
  const loads: Promise<unknown>[] = [];
  for (const font of Object.values(bible.fonts)) {
    for (const w of font.weights) loads.push(document.fonts.load(`${w} 32px "${font.family}"`, sample));
  }
  await Promise.all(loads);
  await document.fonts.ready;
}
