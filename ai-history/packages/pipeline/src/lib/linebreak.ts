// Caption line breaking. Text is cut into unbreakable tokens (a CJK character, a Latin/digit run, an
// English word; punctuation sticks to its neighbour), then a DP picks breaks that minimise the line count
// first, then raggedness, preferring breaks right after punctuation.

export interface BreakRules {
  maxLineChars: number;
  unit: "char" | "word";
  dropLineEndPunct: string;
}

const STRONG = /[，。、；：？！,.;:?!]["'”’]?$/u;
const CLOSING = /^[，。、；：？！）》」』”’,.;:?!)]/u;

export function tokenize(text: string, unit: "char" | "word"): { tokens: string[]; joiner: string } {
  if (unit === "word") return { tokens: text.split(/\s+/).filter(Boolean), joiner: " " };
  const tokens: string[] = [];
  let quoteOpen = false;
  let pendingOpen = "";
  for (const m of text.matchAll(/[A-Za-z0-9]+|\s+|./gu)) {
    let t = m[0];
    if (/^\s+$/.test(t)) {
      if (tokens.length) tokens[tokens.length - 1] += t;
      continue;
    }
    if (t === '"') {
      quoteOpen = !quoteOpen;
      if (quoteOpen) {
        pendingOpen += t; // opening quote binds to the next token
        continue;
      }
    }
    if ((CLOSING.test(t) || t === '"') && tokens.length) {
      tokens[tokens.length - 1] += t;
      continue;
    }
    t = pendingOpen + t;
    pendingOpen = "";
    tokens.push(t);
  }
  if (pendingOpen) tokens.push(pendingOpen);
  return { tokens, joiner: "" };
}

export function displayLine(raw: string, rules: BreakRules): string {
  let s = raw.trim();
  while (s && rules.dropLineEndPunct.includes(s[s.length - 1])) s = s.slice(0, -1);
  return s;
}

export function lineWidth(line: string): number {
  return [...line].length;
}

// a comma is a weaker place to break than a colon, full stop or question mark
const WEAK_PUNCT = /[，、,]["'”’]?$/u;
const WEAK_END = /^(a|an|the|of|to|in|on|at|by|for|and|or|but|that|with|from|his|her|its|this|one)$/i;

function breakCost(token: string, isLast: boolean, unit: "char" | "word", inQuote: boolean): number {
  if (isLast) return 0;
  const quote = inQuote ? 300 : 0; // never split a quoted term such as "人工智能" if avoidable
  if (STRONG.test(token.trim())) return quote + (WEAK_PUNCT.test(token.trim()) ? 20 : 0);
  if (unit === "char") return 80 + quote;
  return (WEAK_END.test(token.trim()) ? 200 : 40) + quote;
}

// insideQuote[k] = the boundary after tokens[k] lies inside a straight or curly quotation
function quoteState(tokens: string[]): boolean[] {
  let open = false;
  return tokens.map((t) => {
    for (const ch of t) {
      if (ch === '"') open = !open;
      else if (ch === "“" || ch === "「") open = true;
      else if (ch === "”" || ch === "」") open = false;
    }
    return open;
  });
}

// Best line layout of tokens[from..to); cost = sum of squared slack + break penalties.
function layoutLines(tokens: string[], joiner: string, from: number, to: number, rules: BreakRules): { lines: string[]; cost: number } {
  const quoted = quoteState(tokens);
  const join = (i: number, j: number) => displayLine(tokens.slice(i, j).join(joiner), rules);
  const best = Array.from({ length: to - from + 1 }, () => ({ cost: Infinity, lines: Infinity, prev: -1 }));
  best[0] = { cost: 0, lines: 0, prev: -1 };
  for (let j = 1; j <= to - from; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const w = lineWidth(join(from + i, from + j));
      if (w > rules.maxLineChars && j - i > 1) break;
      const slack = Math.max(0, rules.maxLineChars - w);
      const lines = best[i].lines + 1;
      const cost = best[i].cost + slack * slack + breakCost(tokens[from + j - 1], j === to - from, rules.unit, quoted[from + j - 1]);
      if (lines < best[j].lines || (lines === best[j].lines && cost < best[j].cost)) best[j] = { cost, lines, prev: i };
    }
  }
  const lines: string[] = [];
  for (let j = to - from; j > 0; j = best[j].prev) lines.unshift(join(from + best[j].prev, from + j));
  return { lines: lines.filter(Boolean), cost: best[to - from].cost };
}

export function breakLines(text: string, rules: BreakRules): string[] {
  const { tokens, joiner } = tokenize(text, rules.unit);
  return layoutLines(tokens, joiner, 0, tokens.length, rules).lines;
}

// Split a segment into caption blocks of at most maxLines lines. One scalar cost: each block costs
// BLOCK, a block boundary that is not at punctuation costs far more, plus the line layout inside each block.
const BLOCK = 400;
export function layoutCaption(text: string, rules: BreakRules, maxLines: number): string[][] {
  const { tokens, joiner } = tokenize(text, rules.unit);
  const n = tokens.length;
  const quoted = quoteState(tokens);
  const best: { blocks: number; cost: number; prev: number; lines: string[] }[] = Array.from({ length: n + 1 }, () => ({
    blocks: Infinity,
    cost: Infinity,
    prev: -1,
    lines: [],
  }));
  best[0] = { blocks: 0, cost: 0, prev: -1, lines: [] };
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      if (best[i].blocks === Infinity) continue;
      const block = layoutLines(tokens, joiner, i, j, rules);
      if (block.lines.length > maxLines) break;
      // a caption block that ends mid-phrase is far worse than a short line
      const boundary = j < n ? (STRONG.test(tokens[j - 1].trim()) ? 0 : 1000) + (quoted[j - 1] ? 300 : 0) : 0;
      const blocks = best[i].blocks + 1;
      const cost = best[i].cost + BLOCK + block.cost + boundary;
      if (cost < best[j].cost) best[j] = { blocks, cost, prev: i, lines: block.lines };
    }
  }
  const out: string[][] = [];
  for (let j = n; j > 0; j = best[j].prev) out.unshift(best[j].lines);
  return out;
}
