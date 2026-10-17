import { mockEngine } from "./engines/mock";
import type { TtsEngine } from "./types";

export * from "./types";
export * from "./wav";
export * from "./units";

// Real engines are registered here once Ryan picks one (spec §15).
const engines: Record<string, TtsEngine> = {
  [mockEngine.id]: mockEngine,
};

export function getEngine(id: string): TtsEngine {
  const engine = engines[id];
  if (!engine) throw new Error(`unknown TTS engine "${id}" (registered: ${Object.keys(engines).join(", ")})`);
  return engine;
}
