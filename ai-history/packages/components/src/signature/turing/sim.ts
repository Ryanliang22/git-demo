// A real Turing machine simulator. The TuringMachine component only draws what this computes:
// rule table, tape contents and head position at every step.

export type Sym = "0" | "1" | "_";
export type Move = "L" | "R";

export interface Rule {
  state: string;
  read: Sym;
  write: Sym;
  move: Move;
  next: string;
}

export interface Program {
  id: string;
  // drawing order of states; index picks the state color from bible.turing.stateColors
  states: string[];
  start: string;
  halt: string[];
  // where the head starts: on the leftmost or rightmost non-blank cell of the input
  startAt: "left" | "right";
  rules: Rule[];
}

export interface Config {
  cells: Record<number, Sym>;
  head: number;
  state: string;
}

export interface Step {
  rule: number; // index into program.rules
  before: Config;
  after: Config;
}

const r = (state: string, read: Sym, write: Sym, move: Move, next: string): Rule => ({ state, read, write, move, next });

export const programs: Record<string, Program> = {
  // Head starts on the last bit; turn trailing 1s into 0s until a 0 or blank takes the carry.
  binary_increment: {
    id: "binary_increment",
    states: ["carry", "done"],
    start: "carry",
    halt: ["done"],
    startAt: "right",
    rules: [r("carry", "1", "0", "L", "carry"), r("carry", "0", "1", "L", "done"), r("carry", "_", "1", "L", "done")],
  },
  // Counts forever: run to the right end, add one, run back to the right end, ...
  binary_counter: {
    id: "binary_counter",
    states: ["seek", "carry"],
    start: "seek",
    halt: [],
    startAt: "left",
    rules: [
      r("seek", "0", "0", "R", "seek"),
      r("seek", "1", "1", "R", "seek"),
      r("seek", "_", "_", "L", "carry"),
      r("carry", "1", "0", "L", "carry"),
      r("carry", "0", "1", "R", "seek"),
      r("carry", "_", "1", "R", "seek"),
    ],
  },
  bit_invert: {
    id: "bit_invert",
    states: ["flip", "done"],
    start: "flip",
    halt: ["done"],
    startAt: "left",
    rules: [r("flip", "0", "1", "R", "flip"), r("flip", "1", "0", "R", "flip"), r("flip", "_", "_", "L", "done")],
  },
  // Unary addition: 1^a 0 1^b -> 1^(a+b)
  unary_add: {
    id: "unary_add",
    states: ["scan", "trim", "done"],
    start: "scan",
    halt: ["done"],
    startAt: "left",
    rules: [r("scan", "1", "1", "R", "scan"), r("scan", "0", "1", "R", "scan"), r("scan", "_", "_", "L", "trim"), r("trim", "1", "_", "L", "done")],
  },
};

export function getProgram(id: string): Program {
  const p = programs[id];
  if (!p) throw new Error(`unknown Turing program ${id}`);
  return p;
}

export function initialConfig(program: Program, input: string): Config {
  const cells: Record<number, Sym> = {};
  [...input].forEach((c, i) => {
    if (c !== "_") cells[i] = c as Sym;
  });
  const filled = Object.keys(cells).map(Number);
  const head = filled.length ? (program.startAt === "left" ? Math.min(...filled) : Math.max(...filled)) : 0;
  return { cells, head, state: program.start };
}

export const readCell = (c: Config, i: number): Sym => c.cells[i] ?? "_";

export function step(program: Program, c: Config): Step | null {
  if (program.halt.includes(c.state)) return null;
  const sym = readCell(c, c.head);
  const idx = program.rules.findIndex((rule) => rule.state === c.state && rule.read === sym);
  if (idx < 0) return null; // no applicable rule: the machine stops
  const rule = program.rules[idx];
  const cells = { ...c.cells };
  if (rule.write === "_") delete cells[c.head];
  else cells[c.head] = rule.write;
  return { rule: idx, before: c, after: { cells, head: c.head + (rule.move === "L" ? -1 : 1), state: rule.next } };
}

export function run(program: Program, input: string, maxSteps: number): Step[] {
  const steps: Step[] = [];
  let c = initialConfig(program, input);
  for (let i = 0; i < maxSteps; i++) {
    const s = step(program, c);
    if (!s) break;
    steps.push(s);
    c = s.after;
  }
  return steps;
}

export function readTape(c: Config): string {
  const idx = Object.keys(c.cells).map(Number);
  if (!idx.length) return "";
  let s = "";
  for (let i = Math.min(...idx); i <= Math.max(...idx); i++) s += readCell(c, i);
  return s;
}

export function finalConfig(program: Program, input: string, maxSteps = 10_000): Config {
  const steps = run(program, input, maxSteps);
  return steps.length ? steps[steps.length - 1].after : initialConfig(program, input);
}

// Glyph encoding of a rule table ("standard description" in symbols only): per rule
// [state] [read] [write] [move] [next], rules separated by a divider glyph.
export type Glyph =
  | { kind: "state"; state: string; index: number; halt: boolean }
  | { kind: "sym"; value: Sym }
  | { kind: "move"; dir: Move }
  | { kind: "sep" };

export function stateGlyph(program: Program, state: string): Glyph {
  return { kind: "state", state, index: program.states.indexOf(state), halt: program.halt.includes(state) };
}

export function encodeProgram(program: Program): Glyph[] {
  const out: Glyph[] = [];
  program.rules.forEach((rule, i) => {
    if (i > 0) out.push({ kind: "sep" });
    out.push(
      stateGlyph(program, rule.state),
      { kind: "sym", value: rule.read },
      { kind: "sym", value: rule.write },
      { kind: "move", dir: rule.move },
      stateGlyph(program, rule.next),
    );
  });
  return out;
}
