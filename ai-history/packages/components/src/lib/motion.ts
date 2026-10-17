import { Easing, interpolate } from "remotion";
import type { Bible } from "@ai-history/schemas";

export const ease = Easing.inOut(Easing.cubic);

// 0 -> 1 over `duration` frames starting at `start`; 0 before, 1 after. Unset events never start.
export function progress(frame: number, start: number | undefined, duration: number): number {
  if (start === undefined) return 0;
  return interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

export const appear = (frame: number, at: number | undefined, bible: Bible) => progress(frame, at, bible.motion.appearFrames);
export const move = (frame: number, at: number | undefined, bible: Bible) => progress(frame, at, bible.motion.moveFrames);

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// cursor blink: on for half the period, starting "on" at frame `from`
export function blinkOn(frame: number, bible: Bible, from = 0): boolean {
  const p = bible.motion.cursorBlinkFrames;
  return Math.floor((frame - from) / p) % 2 === 0;
}
