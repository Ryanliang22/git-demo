import type { Bible } from "@ai-history/schemas";
import type { Layout } from "./layout";

// What every component receives besides its own props: event frames (relative to the shot start,
// derived from cueBindings), resolved screen text, and the shared design tokens.
export interface ShotContext {
  bible: Bible;
  lang: string;
  layout: Layout;
  shotId: string;
  durationInFrames: number;
  events: Record<string, number>;
  texts: Record<string, string>;
}

export interface ComponentProps<P> {
  props: P;
  ctx: ShotContext;
}
