import { fitText, measureText } from "@remotion/layout-utils";

export interface TextBox {
  id: string;
  text: string;
  fontFamily: string;
  fontWeight: number;
  maxWidth: number;
  maxFontSize: number;
  minFontSize: number;
}

// Largest size <= maxFontSize at which the text fits maxWidth on one line.
export function fitBox(box: TextBox): { fontSize: number; width: number } {
  const fitted = fitText({ text: box.text, withinWidth: box.maxWidth, fontFamily: box.fontFamily, fontWeight: box.fontWeight, validateFontIsLoaded: true }).fontSize;
  const fontSize = Math.min(box.maxFontSize, Math.floor(fitted * 100) / 100);
  const { width } = measureText({ text: box.text, fontFamily: box.fontFamily, fontWeight: box.fontWeight, fontSize, validateFontIsLoaded: true });
  return { fontSize, width };
}
