import { useCurrentFrame } from "remotion";
import type { Bible, TuringMachineProps } from "@ai-history/schemas";
import type { ComponentProps, ShotContext } from "../lib/context";
import { withAlpha } from "../lib/color";
import { appear, ease, lerp, move, progress } from "../lib/motion";
import {
  BlankRows,
  cardGlyphCenter,
  cardHeight,
  GlyphView,
  geometry,
  Head,
  machineAt,
  RuleCard,
  Tape,
  type CellContent,
  type Geometry,
} from "./turing/parts";
import { encodeProgram, finalConfig, getProgram, initialConfig, readCell, run, stateGlyph, type Config, type Sym } from "./turing/sim";

type Props = TuringMachineProps;

const symGlyph = (v: Sym): CellContent => (v === "_" ? null : { kind: "sym", value: v });

// Tape contents of a machine at fractional step s, with the written cell cross-fading old -> new.
function tapeOf(m: ReturnType<typeof machineAt>) {
  return (i: number) => {
    if (m.writing && i === m.writing.at) {
      const showNew = m.flip >= 0.5;
      const v = (showNew ? m.writing.to : m.writing.from) as Sym;
      return { glyph: symGlyph(v), alpha: showNew ? m.flip * 2 - 1 : 1 - m.flip * 2 };
    }
    return { glyph: symGlyph(readCell(m.config, i)) };
  };
}

// ---------- build (S02): tape unrolls, head drops, rule card appears, binary increment runs ----------
const Build: React.FC<{ props: Props; ctx: ShotContext; g: Geometry; frame: number }> = ({ props, ctx, g, frame }) => {
  const { bible, layout, events } = ctx;
  const program = getProgram(props.program);
  const start = initialConfig(program, props.input);
  const steps = run(program, props.input, 64);
  const card = appear(frame, events.showRules, bible);
  const runFrom = events.showRules === undefined ? Infinity : events.showRules + bible.motion.appearFrames + bible.motion.minHoldFrames / 2;
  const m = machineAt(steps, start, (frame - runFrom) / bible.turing.stepFrames);
  // "an endless strip of tape": until the head arrives the tape glides, delivering the starting cell to it
  const tT = events.showTape;
  const tH = events.showHead;
  let viewHead = m.viewHead;
  if (tT !== undefined && tH !== undefined && tH > tT) {
    const distance = (tH - tT) / (bible.turing.stepFrames * 4);
    viewHead += distance * (1 - progress(frame, tT, tH - tT + bible.motion.moveFrames / 2));
  }
  // before the rules arrive, the head reads the cell under it (a slow pulse)
  const idle = tH !== undefined && frame >= tH + bible.motion.moveFrames && frame < runFrom;
  const pulse = idle ? 0.5 - 0.5 * Math.cos(((frame - tH - bible.motion.moveFrames) / (bible.motion.cursorBlinkFrames * 3)) * Math.PI * 2) : 0;
  const content = (i: number) => (i === start.head && pulse > 0 ? { ...tapeOf(m)(i), glow: pulse * 1.6 } : tapeOf(m)(i));
  return (
    <>
      <Tape bible={bible} layout={layout} g={g} viewHead={viewHead} content={content} reveal={progress(frame, events.showTape, bible.motion.moveFrames)} />
      <RuleCard bible={bible} g={g} program={program} active={m.active} opacity={card} />
      <Head bible={bible} g={g} state={stateGlyph(program, m.stateAfter ?? m.config.state)} drop={appear(frame, events.showHead, bible)} stem={card} />
    </>
  );
};

// ---------- universal (S03): another machine's rules are written onto the tape, read, then played ----------
const OUTLINE_STROKE = 0.045;

const Outline: React.FC<{ bible: Bible; g: Geometry; kind: string; cx: number; cy: number; w: number; h: number; opacity: number; frame: number }> = ({
  bible,
  g,
  kind,
  cx,
  cy,
  w,
  h,
  opacity,
  frame,
}) => {
  if (opacity <= 0 || kind === "frame") return null;
  const sw = g.cell * OUTLINE_STROKE;
  const R = Math.hypot(w / 2, h / 2) + g.cell * 0.15;
  const stroke = { fill: "none", stroke: bible.colors.blue, strokeWidth: sw, strokeLinejoin: "round" as const };
  let body: React.ReactNode = null;
  if (kind === "gear") {
    const teeth = 14;
    const d = g.cell * 0.28;
    const pts: string[] = [];
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2 + frame * 0.004;
      const span = (Math.PI * 2) / teeth;
      for (const [da, r] of [[0, R], [span * 0.12, R + d], [span * 0.45, R + d], [span * 0.57, R]] as const) {
        pts.push(`${cx + Math.cos(a + da) * r},${cy + Math.sin(a + da) * r}`);
      }
    }
    body = <polygon points={pts.join(" ")} {...stroke} />;
  } else if (kind === "dial") {
    const ticks = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2;
      const r1 = R + g.cell * 0.06;
      const r2 = R + g.cell * (i % 3 === 0 ? 0.3 : 0.18);
      return <line key={i} x1={cx + Math.cos(a) * r1} y1={cy + Math.sin(a) * r1} x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2} stroke={bible.colors.blue} strokeWidth={sw * 0.8} strokeLinecap="round" />;
    });
    const a = -Math.PI / 2 + Math.sin(frame * 0.05) * 0.9;
    body = (
      <>
        <circle cx={cx} cy={cy} r={R} {...stroke} />
        {ticks}
        <circle cx={cx + Math.cos(a) * (R + g.cell * 0.42)} cy={cy + Math.sin(a) * (R + g.cell * 0.42)} r={g.cell * 0.07} fill={bible.colors.text} />
      </>
    );
  } else if (kind === "keypad") {
    const kw = g.cell * 0.9;
    const W = w + 2 * kw + g.cell * 0.3;
    const H = h + g.cell * 0.5;
    const key = g.cell * 0.42;
    const keys = [];
    for (const side of [-1, 1]) {
      for (let r = 0; r < 3; r++) {
        const x = cx + side * (w / 2 + kw / 2 + g.cell * 0.08) - key / 2;
        const y = cy - H / 2 + g.cell * 0.25 + ((H - g.cell * 0.5) / 3) * (r + 0.5) - key / 2;
        keys.push(<rect key={`${side}${r}`} x={x} y={y} width={key} height={key} rx={key * 0.22} {...stroke} strokeWidth={sw * 0.8} />);
      }
    }
    body = (
      <>
        <rect x={cx - W / 2} y={cy - H / 2} width={W} height={H} rx={g.cell * 0.3} {...stroke} />
        {keys}
      </>
    );
  }
  return (
    <svg style={{ position: "absolute", inset: 0, opacity }} width="100%" height="100%">
      {body}
    </svg>
  );
};

const Universal: React.FC<{ props: Props; ctx: ShotContext; g: Geometry; frame: number }> = ({ props, ctx, g, frame }) => {
  const { bible, layout, events, durationInFrames } = ctx;
  const base = getProgram(props.program);
  const start = finalConfig(base, props.input); // where S02's machine stopped
  const guest = getProgram(props.guest ?? props.program);
  const glyphs = encodeProgram(guest);
  const n = glyphs.length;
  const tE = events.encodeGuest ?? 0;
  const tM = events.morph ?? durationInFrames;
  const A = bible.motion.appearFrames;

  // phase A timing, scaled to the time the narration gives us
  // the guest card is complete for a beat before its symbols start to leave
  const writeStart = tE + A + bible.motion.minHoldFrames / 2;
  const per = Math.max(2, Math.min(9, Math.floor((tM - writeStart - A) / (2 * n + 2))));
  const flight = Math.min(10, per * 3);
  const writeEnd = writeStart + n * per;
  const readEnd = writeEnd + n * per;
  const head0 = start.head;

  const baseH = cardHeight(g, base.rules.length);
  const cardCy = g.cardBottom - baseH / 2;
  const guestScale = 0.75;
  const guestH = cardHeight(g, guest.rules.length) * guestScale;
  const guestCy = g.tapeY + g.cell * 0.62 + g.cell * 0.45 + guestH / 2;

  const morphT = move(frame, tM, bible);
  const cardScale = lerp(1, 0.75, morphT);
  const cy = lerp(cardCy, cardCy - g.cell * 0.5, morphT);

  if (frame < tM) {
    const wipe = appear(frame, tE, bible);
    const guestIn = appear(frame, tE, bible) * (1 - progress(frame, writeEnd, A));
    let viewHead = head0;
    if (frame >= writeStart && frame < writeEnd) viewHead = head0 + (frame - writeStart) / per;
    else if (frame >= writeEnd) viewHead = lerp(head0 + n - 1, head0, Math.min(1, (frame - writeEnd) / (readEnd - writeEnd)));
    const reading = frame >= writeEnd && frame < readEnd + per;
    const landed = (k: number) => frame >= writeStart + k * per;
    const content = (i: number) => {
      const k = i - head0;
      if (k >= 0 && k < n && landed(k)) return { glyph: glyphs[k], glow: reading ? Math.max(0, 1 - Math.abs(viewHead - i) * 1.4) : 0 };
      return { glyph: symGlyph(readCell(start, i)), alpha: 1 - wipe };
    };
    const flying = glyphs.map((gl, k) => {
      if (gl.kind === "sep") return null; // dividers are not on the card; they appear on landing
      const p = progress(frame, writeStart + k * per - flight, flight);
      if (p <= 0 || p >= 1) return null;
      const src = cardGlyphCenter(g, guest, Math.floor(k / 6) * 5 + (k % 6), guestCy, guestScale);
      const size = lerp(g.colW * guestScale, g.cell, p);
      return (
        <div key={k} style={{ position: "absolute", left: lerp(src.x, g.headX, p) - size / 2, top: lerp(src.y, g.tapeY, p) - size / 2 }}>
          <GlyphView glyph={gl} size={size} bible={bible} />
        </div>
      );
    });
    return (
      <>
        <Tape bible={bible} layout={layout} g={g} viewHead={viewHead} content={content} />
        {/* the machine's own table is not what matters now: its rows dissolve into blank slots */}
        <RuleCard bible={bible} g={g} program={base} active={-1} opacity={1} centerY={cardCy} hiddenGlyphs={() => 1 - wipe} />
        <BlankRows bible={bible} g={g} rows={base.rules.length} centerY={cardCy} opacity={wipe} />
        <Head bible={bible} g={g} state={stateGlyph(base, base.start)} drop={1} />
        <RuleCard
          bible={bible}
          g={g}
          program={guest}
          active={-1}
          opacity={guestIn}
          scale={guestScale}
          centerY={guestCy}
          muted
          hiddenGlyphs={(idx) => (frame >= writeStart + glyphIndexOf(idx) * per - flight ? 0 : 1)}
        />
        {flying}
      </>
    );
  }

  // phase B: the same machine plays three other machines in turn
  const morphs = props.morphs ?? [];
  const L = Math.max(1, (durationInFrames - tM) / Math.max(1, morphs.length));
  const i = Math.min(morphs.length - 1, Math.floor((frame - tM) / L));
  const seg = morphs[i];
  const segStart = tM + i * L;
  const prog = getProgram(seg.program);
  const st = initialConfig(prog, seg.input);
  const steps = run(prog, seg.input, 64);
  const swap = appear(frame, segStart, bible);
  const m = machineAt(steps, st, (frame - segStart - A) / (bible.turing.stepFrames / 2));
  const prev = i > 0 ? morphs[i - 1] : null;
  // universal tape: [description of the machine being played] _ [its input]
  const desc = encodeProgram(prog);
  const firstInput = Math.min(0, ...Object.keys(st.cells).map(Number));
  const descEnd = firstInput - 1;
  const describe = (c: number) => {
    const k = c - (descEnd - desc.length);
    return { glyph: k >= 0 && k < desc.length ? desc[k] : null, alpha: 0.45 * swap };
  };
  const progH = cardHeight(g, prog.rules.length);
  const ow = g.cardW * cardScale;
  const oh = progH * cardScale;
  return (
    <>
      <Tape bible={bible} layout={layout} g={g} viewHead={m.viewHead} content={(c) => (c < descEnd ? describe(c) : { ...tapeOf(m)(c), alpha: (tapeOf(m)(c).alpha ?? 1) * swap })} />
      {prev ? <Outline bible={bible} g={g} kind={prev.outline} cx={g.headX} cy={cy} w={ow} h={oh} opacity={1 - swap} frame={frame} /> : null}
      <Outline bible={bible} g={g} kind={seg.outline} cx={g.headX} cy={cy} w={ow} h={oh} opacity={swap} frame={frame} />
      <RuleCard bible={bible} g={g} program={prog} active={m.active} opacity={swap} scale={cardScale} centerY={cy} muted />
      <Head bible={bible} g={g} state={stateGlyph(prog, m.stateAfter ?? m.config.state)} drop={1} stemTop={cy + oh / 2} />
    </>
  );
};

// glyph #idx on the card (5 per rule) -> its index in the encoded string (rules separated by a divider)
function glyphIndexOf(cardIdx: number): number {
  const rule = Math.floor(cardIdx / 5);
  return rule * 6 + (cardIdx % 5);
}
// ---------- outro (S04): the tape gathers into the outline of a phone ----------
function roundedRectPoint(cx: number, cy: number, w: number, h: number, r: number, s: number) {
  // perimeter walk starting at bottom-centre heading left (screen coordinates), s in [0,1)
  const straightH = w - 2 * r;
  const straightV = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const segs = [straightH / 2, arc, straightV, arc, straightH, arc, straightV, arc, straightH / 2];
  const total = segs.reduce((a, b) => a + b, 0);
  let d = (((s % 1) + 1) % 1) * total;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const corner = (ccx: number, ccy: number, a0: number, t: number) => {
    const a = a0 + (t * Math.PI) / 2;
    return { x: ccx + Math.cos(a) * r, y: ccy + Math.sin(a) * r, angle: a + Math.PI / 2 };
  };
  const pieces = [
    (t: number) => ({ x: cx - t * (straightH / 2), y: bottom, angle: 0 }),
    (t: number) => corner(left + r, bottom - r, Math.PI / 2, t),
    (t: number) => ({ x: left, y: bottom - r - t * straightV, angle: Math.PI / 2 }),
    (t: number) => corner(left + r, top + r, Math.PI, t),
    (t: number) => ({ x: left + r + t * straightH, y: top, angle: 0 }),
    (t: number) => corner(right - r, top + r, -Math.PI / 2, t),
    (t: number) => ({ x: right, y: top + r + t * straightV, angle: Math.PI / 2 }),
    (t: number) => corner(right - r, bottom - r, 0, t),
    (t: number) => ({ x: right - r - t * (straightH / 2), y: bottom, angle: 0 }),
  ];
  for (let k = 0; k < segs.length; k++) {
    if (d <= segs[k] || k === segs.length - 1) return { ...pieces[k](Math.min(1, d / segs[k])), total };
    d -= segs[k];
  }
  return { ...pieces[0](0), total };
}

const Outro: React.FC<{ props: Props; ctx: ShotContext; g: Geometry; frame: number }> = ({ props, ctx, g, frame }) => {
  const { bible, layout, events } = ctx;
  const program = getProgram(props.program);
  const start: Config = finalConfig(program, props.input);
  const tC = events.collapse ?? 0;
  const A = bible.motion.appearFrames;
  const machineOut = appear(frame, tC, bible);
  // quick enough that the phone is legible when the narration names it (a beat after the cue)
  const gatherFrames = bible.motion.appearFrames * 1.25;
  const gather = progress(frame, tC, gatherFrames);
  const settle = progress(frame, tC + gatherFrames - 6, A);

  const pw = layout.stage.w * 0.5;
  const ph = pw * 2.05;
  const pr = pw * 0.17;
  const pcx = g.headX;
  const pcy = layout.stage.y + layout.stage.h / 2;
  const N = 24;
  const stroke = g.cell * 0.09;
  const total = roundedRectPoint(pcx, pcy, pw, ph, pr, 0).total;
  const segLen = total / N;
  const first = start.head - N / 2;
  const cells = Array.from({ length: N }, (_, j) => {
    const i = first + j;
    const tx = g.headX + (i - start.head) * g.cell;
    // left part of the tape -> left side of the phone, middle (under the head) -> top, right -> right side: no crossings
    const p = roundedRectPoint(pcx, pcy, pw, ph, pr, (j + 0.5) / N);
    let angle = p.angle % Math.PI;
    if (angle > Math.PI / 2) angle -= Math.PI;
    const t = gather;
    const w = lerp(g.cell, segLen + 1, t);
    const h = lerp(g.cell, stroke, t);
    const x = lerp(tx, p.x, t);
    const y = lerp(g.tapeY, p.y, t);
    const sym = readCell(start, i);
    return (
      <div
        key={j}
        style={{
          position: "absolute",
          left: x - w / 2,
          top: y - h / 2,
          width: w,
          height: h,
          transform: `rotate(${lerp(0, angle, t)}rad)`,
          background: withAlpha(bible.colors.amber, lerp(0.07, 1, t)),
          boxSizing: "border-box",
          borderLeft: t < 0.5 ? `${g.cell * 0.025}px solid ${withAlpha(bible.colors.amber, 0.55 * (1 - t * 2))}` : undefined,
          opacity: 1 - settle,
        }}
      >
        <GlyphView glyph={symGlyph(sym)} size={g.cell} bible={bible} opacity={Math.max(0, 1 - t * 2.5)} />
      </div>
    );
  });
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - gather }}>
        <Tape bible={bible} layout={layout} g={g} viewHead={start.head} content={() => ({ glyph: null })} />
      </div>
      <RuleCard bible={bible} g={g} program={program} active={-1} opacity={1 - machineOut} />
      <Head bible={bible} g={g} state={stateGlyph(program, start.state)} drop={1 - machineOut} />
      {cells}
      <div
        style={{
          position: "absolute",
          left: pcx - pw / 2 - stroke / 2,
          top: pcy - ph / 2 - stroke / 2,
          width: pw + stroke,
          height: ph + stroke,
          borderRadius: pr + stroke / 2,
          boxSizing: "border-box",
          border: `${stroke}px solid ${bible.colors.amber}`,
          opacity: settle,
        }}
      />
      <PhoneTape bible={bible} layout={layout} g={g} frame={frame} from={tC + gatherFrames} cx={pcx} cy={pcy} w={pw} h={ph} r={pr} />
      <div
        style={{
          position: "absolute",
          left: pcx - pw * 0.11,
          top: pcy - ph / 2 + pw * 0.09,
          width: pw * 0.22,
          height: stroke * 0.8,
          borderRadius: stroke,
          background: bible.colors.amber,
          opacity: appear(frame, tC + gatherFrames, bible),
        }}
      />
    </>
  );
};

// Inside the phone the same paper machine keeps counting, at a smaller scale.
const PhoneTape: React.FC<{ bible: Bible; layout: ShotContext["layout"]; g: Geometry; frame: number; from: number; cx: number; cy: number; w: number; h: number; r: number }> = ({
  bible,
  layout,
  g,
  frame,
  from,
  cx,
  cy,
  w,
  h,
  r,
}) => {
  const shown = appear(frame, from, bible);
  if (shown <= 0) return null;
  const program = getProgram("binary_counter");
  const input = "1";
  const steps = run(program, input, 400);
  const small: Geometry = { ...g, cell: g.cell * 0.8, headX: cx, tapeY: cy };
  const m = machineAt(steps, initialConfig(program, input), (frame - from) / (bible.turing.stepFrames / 3));
  const inset = `inset(${cy - h / 2}px ${layout.width - (cx + w / 2)}px ${layout.height - (cy + h / 2)}px ${cx - w / 2}px round ${r}px)`;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: shown, clipPath: inset }}>
      <Tape bible={bible} layout={layout} g={small} viewHead={m.viewHead} content={tapeOf(m)} />
      <Head bible={bible} g={small} state={stateGlyph(program, m.stateAfter ?? m.config.state)} drop={1} stem={0} />
    </div>
  );
};

// ---------- stop (S10): the counter slows down, stops, and the head lifts off the tape ----------
const Stop: React.FC<{ props: Props; ctx: ShotContext; g: Geometry; frame: number }> = ({ props, ctx, g, frame }) => {
  const { bible, layout, events, durationInFrames } = ctx;
  const program = getProgram(props.program);
  const start = initialConfig(program, props.input);
  const steps = run(program, props.input, 400);
  const fast = bible.turing.stepFrames / 2;
  const tH = events.halt ?? Math.round(durationInFrames * 0.6);
  const tau = bible.motion.moveFrames * 1.2;
  const s = frame < tH ? frame / fast : tH / fast + (tau / fast) * (1 - Math.exp(-(frame - tH) / tau));
  const m = machineAt(steps, start, s);
  const lift = progress(frame, tH + tau * 3, bible.motion.moveFrames * 1.5);
  return (
    <>
      <Tape bible={bible} layout={layout} g={g} viewHead={m.viewHead} content={tapeOf(m)} />
      <RuleCard bible={bible} g={g} program={program} active={lift > 0 ? -1 : m.active} opacity={1} />
      <Head bible={bible} g={g} state={stateGlyph(program, m.stateAfter ?? m.config.state)} drop={1} lift={lift} />
    </>
  );
};

export const TuringMachine: React.FC<ComponentProps<Props>> = ({ props, ctx }) => {
  const frame = useCurrentFrame();
  const g = geometry(ctx.bible, ctx.layout);
  const Mode = { build: Build, universal: Universal, outro: Outro, stop: Stop }[props.mode];
  return <Mode props={props} ctx={ctx} g={g} frame={frame} />;
};
