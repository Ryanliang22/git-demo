// Parser for script.<lang>.txt:
//   ## B2
//   {#y1936} 1936年，现代计算机还不存在。 [[C03]]
// Every line starts with a cue; the text up to the next cue is one segment; every line ends with
// [[claim IDs]] or [[N]] (narrative sentence, states no fact).

export interface ParsedLine {
  cue: string;
  text: string;
  claims: string[];
  beat: string;
  line: number;
}

const BEAT = /^##\s+(B\d+)\s*$/;
const LINE = /^\{#([a-z0-9_]+)\}\s*(.*?)\s*\[\[([^\]]*)\]\]\s*$/;

export function parseScript(source: string): { lines: ParsedLine[]; errors: string[] } {
  const lines: ParsedLine[] = [];
  const errors: string[] = [];
  let beat: string | null = null;
  source.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const text = raw.trim();
    if (!text) return;
    const b = BEAT.exec(text);
    if (b) {
      beat = b[1];
      return;
    }
    if (!text.startsWith("{#")) {
      errors.push(`line ${n}: does not start with a {#cue}`);
      return;
    }
    const m = LINE.exec(text);
    if (!m) {
      errors.push(`line ${n}: missing trailing [[claim IDs]] or [[N]]`);
      return;
    }
    const [, cue, body, refs] = m;
    if (!beat) errors.push(`line ${n}: cue ${cue} appears before any "## B<n>" beat header`);
    if (!body) errors.push(`line ${n}: cue ${cue} has no text`);
    const ids = refs.split(",").map((s) => s.trim()).filter(Boolean);
    let claims: string[] = [];
    if (ids.length === 1 && ids[0] === "N") claims = [];
    else if (ids.length === 0 || ids.includes("N")) errors.push(`line ${n}: [[${refs}]] must be claim IDs or exactly [[N]]`);
    else claims = ids;
    lines.push({ cue, text: body, claims, beat: beat ?? "", line: n });
  });
  return { lines, errors };
}
