export type TtsParams = Record<string, string | number | boolean>;

export interface TtsRequest {
  text: string;
  lang: string;
  voice: string;
  params: TtsParams;
  // spoken unit used by estimators: CJK-style characters or words
  unit: "char" | "word";
  // neighbouring segments, passed only to engines that support it
  context?: { previous?: string; next?: string };
}

export interface TtsOutput {
  // any format ffmpeg can read; the pipeline normalises it to 48 kHz mono PCM
  audio: Buffer;
  extension: "wav" | "mp3" | "ogg";
}

export interface TtsEngine {
  id: string;
  version: string;
  supportsContext: boolean;
  synthesize(req: TtsRequest): Promise<TtsOutput>;
}
