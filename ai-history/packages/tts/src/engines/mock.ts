import type { TtsEngine } from "../types";
import { countUnits } from "../units";
import { encodeWav } from "../wav";

// Silent audio whose length follows an estimated speaking rate (params.unitsPerSec).
// Lets the whole pipeline run without any API key.
export const mockEngine: TtsEngine = {
  id: "mock",
  version: "1",
  supportsContext: false,
  async synthesize(req) {
    const rate = Number(req.params.unitsPerSec);
    if (!(rate > 0)) throw new Error("mock engine needs params.unitsPerSec > 0");
    const sampleRate = 48000;
    const seconds = countUnits(req.text, req.unit) / rate;
    const samples = new Int16Array(Math.round(seconds * sampleRate));
    return { audio: encodeWav(samples, sampleRate), extension: "wav" };
  },
};
