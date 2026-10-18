import type { Bible } from "@ai-history/schemas";
import { familyOf } from "../../lib/fonts";
import { withAlpha } from "../../lib/color";
import type { Layout } from "../../lib/layout";
import { ease, lerp } from "../../lib/motion";
import type { Config, Glyph, Program, Step } from "./sim";
import { readCell } from "./sim";

// Geometry and drawing primitives shared by all TuringMachine modes. Every size derives from the
// viewport and bible.turing; nothing is a fixed pixel value.

export interface Geometry {
  cell: number;
  tapeY: number; // centre line of the tape
  headX: number;
  colW: number;
  pad: number;
  divider: number;
  cardW: number;
  stem: number;
  cardBottom: number;
  maxCardH: number;
}

export function geometry(bible: Bible, layout: Layout): Geometry {
  const cell = layout.width * bible.turing.cellWidthRatio;
  const tapeY = layout.height * bible.turing.tapeCenterRatio;
  const colW = cell * 0.78;
  const pad = cell * 0.35;
  const divider = cell * 0.35;
  const stem = cell * 0.9;
  const cardBottom = tapeY - cell * 0.62 - stem;
  // keep clear of the docked year stamp at the top of the safe area
  const top = layout.safe.y + layout.u * 11;
  return { cell, tapeY, headX: layout.cx, colW, pad, divider, cardW: 5 * colW + divider + 2 * pad, stem, cardBottom, maxCardH: cardBottom - top };
}

export function rowHeight(g: Geometry, rules: number): number {
  return Math.min(g.cell * 0.82, (g.maxCardH - 2 * g.pad) / rules);
}

export function cardHeight(g: Geometry, rules: number): number {
  return rowHeight(g, rules) * rules + 2 * g.pad;
}

export function stateColor(bible: Bible, index: number): string {
  const token = bible.turing.stateColors[index % bible.turing.stateColors.length] as keyof Bible["colors"];
  return bible.colors[token];
}

export const GlyphView: React.FC<{ glyph: Glyph | null; size: number; bible: Bible; opacity?: number }> = ({ glyph, size, bible, opacity = 1 }) => {
  if (!glyph) return null;
  const box: React.CSSProperties = { width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", opacity };
  if (glyph.kind === "state") {
    const c = stateColor(bible, glyph.index);
    const d = size * 0.46;
    return (
      <div style={box}>
        <div style={{ width: d, height: d, borderRadius: "50%", boxSizing: "border-box", background: glyph.halt ? "transparent" : c, border: glyph.halt ? `${size * 0.07}px solid ${c}` : "none" }} />
      </div>
    );
  }
  if (glyph.kind === "sym") {
    if (glyph.value === "_") {
      const d = size * 0.36;
      return (
        <div style={box}>
          <div style={{ width: d, height: d, boxSizing: "border-box", border: `${size * 0.05}px solid ${bible.colors.textMuted}` }} />
        </div>
      );
    }
    return (
      <div style={{ ...box, fontFamily: familyOf(bible, "mono"), fontWeight: 700, fontSize: size * 0.62, lineHeight: 1, color: bible.colors.text }}>{glyph.value}</div>
    );
  }
  if (glyph.kind === "move") {
    const w = size * 0.62;
    const s = size * 0.07;
    const flip = glyph.dir === "L" ? "scaleX(-1)" : undefined;
    return (
      <div style={box}>
        <svg width={w} height={w * 0.6} viewBox="0 0 100 60" style={{ transform: flip, overflow: "visible" }}>
          <path d="M6 30 H90 M66 8 L92 30 L66 52" fill="none" stroke={bible.colors.text} strokeWidth={(s / w) * 100} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ width: size * 0.06, height: size * 0.6, background: bible.colors.textMuted, borderRadius: size }} />
    </div>
  );
};

export type CellContent = Glyph | null;

export const Tape: React.FC<{
  bible: Bible;
  layout: Layout;
  g: Geometry;
  viewHead: number;
  content: (i: number) => { glyph: CellContent; alpha?: number; glow?: number };
  reveal?: number; // 0..1, unrolls from left to right
  opacity?: number;
}> = ({ bible, layout, g, viewHead, content, reveal = 1, opacity = 1 }) => {
  const span = Math.ceil(layout.width / g.cell / 2) + 2;
  const first = Math.floor(viewHead) - span;
  const cells = [];
  for (let i = first; i <= Math.floor(viewHead) + span; i++) {
    const x = g.headX + (i - viewHead) * g.cell - g.cell / 2;
    const c = content(i);
    cells.push(
      <div key={i} style={{ position: "absolute", left: x, top: g.tapeY - g.cell / 2, width: g.cell, height: g.cell, boxSizing: "border-box", borderLeft: `${g.cell * 0.025}px solid ${withAlpha(bible.colors.amber, 0.55)}` }}>
        {c.glow ? <div style={{ position: "absolute", inset: 0, background: withAlpha(bible.colors.amber, 0.25 * c.glow) }} /> : null}
        <GlyphView glyph={c.glyph} size={g.cell} bible={bible} opacity={c.alpha ?? 1} />
      </div>,
    );
  }
  const band = g.cell * 0.03;
  // the tape runs off both edges; outside the safe area it fades, so nothing essential sits under platform UI
  const { x: sx, w: sw } = layout.safe;
  // a mask only reads alpha: the bible color is incidental
  const edge = withAlpha(bible.colors.bg, 0.15);
  const solid = withAlpha(bible.colors.bg, 1);
  const fade = `linear-gradient(to right, ${edge} 0px, ${solid} ${sx + g.cell}px, ${solid} ${sx + sw - g.cell}px, ${edge} ${layout.width}px)`;
  return (
    <div style={{ position: "absolute", inset: 0, opacity, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, WebkitMaskImage: fade, maskImage: fade }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: g.tapeY - g.cell / 2, height: g.cell, background: withAlpha(bible.colors.amber, 0.07) }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: g.tapeY - g.cell / 2 - band, height: band, background: bible.colors.amber }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: g.tapeY + g.cell / 2, height: band, background: bible.colors.amber }} />
      {cells}
    </div>
  );
};

export const Head: React.FC<{ bible: Bible; g: Geometry; state: Glyph | null; drop: number; lift?: number; stem?: number; stemTop?: number }> = ({
  bible,
  g,
  state,
  drop,
  lift = 0,
  stem = 1,
  stemTop,
}) => {
  if (drop <= 0) return null;
  const size = g.cell * 1.16;
  const offset = (1 - drop) * -g.cell * 1.6 - lift * g.cell * 2.2;
  const y = g.tapeY - size / 2 + offset;
  const opacity = drop * (1 - lift);
  const dot = g.cell * 0.34;
  const glyphBox = (dot * 0.82) / 0.46; // GlyphView draws a state dot at 46% of its box
  const stemFrom = stemTop ?? g.cardBottom;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {stem > 0 ? (
        <div style={{ position: "absolute", left: g.headX - g.cell * 0.02, top: stemFrom, width: g.cell * 0.04, height: Math.max(0, (y - stemFrom) * stem), background: bible.colors.blue }} />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: g.headX - size / 2,
          top: y,
          width: size,
          height: size,
          boxSizing: "border-box",
          border: `${g.cell * 0.065}px solid ${bible.colors.amber}`,
          borderRadius: g.cell * 0.14,
        }}
      />
      {/* state indicator sits on the stem, just above the bracket, centred on the head */}
      <div style={{ position: "absolute", left: g.headX - dot / 2, top: y - dot * 0.75, width: dot, height: dot, borderRadius: "50%", background: bible.colors.bg }} />
      <div style={{ position: "absolute", left: g.headX - glyphBox / 2, top: y - dot * 0.25 - glyphBox / 2 }}>
        <GlyphView glyph={state} size={glyphBox} bible={bible} />
      </div>
    </div>
  );
};

// A rule card whose rows are blank slots: a machine whose own table is not the point (the universal machine).
// `blank` 0..1 cross-fades from the program's glyphs to the empty slots.
export const BlankRows: React.FC<{ bible: Bible; g: Geometry; rows: number; centerY: number; opacity: number }> = ({ bible, g, rows, centerY, opacity }) => {
  if (opacity <= 0) return null;
  const rh = rowHeight(g, rows);
  const h = cardHeight(g, rows);
  const slot = g.colW * 0.34;
  return (
    <div style={{ position: "absolute", left: g.headX - g.cardW / 2, top: centerY - h / 2, width: g.cardW, height: h, opacity }}>
      {Array.from({ length: rows }, (_, i) =>
        Array.from({ length: 5 }, (_, k) => (
          <div
            key={`${i}-${k}`}
            style={{
              position: "absolute",
              top: g.pad + i * rh + rh / 2 - slot / 2,
              left: g.pad + k * g.colW + (k >= 2 ? g.divider : 0) + g.colW / 2 - slot / 2,
              width: slot,
              height: slot,
              borderRadius: slot * 0.2,
              boxSizing: "border-box",
              border: `${g.cell * 0.02}px solid ${withAlpha(bible.colors.textMuted, 0.7)}`,
            }}
          />
        )),
      )}
    </div>
  );
};

export const RuleCard: React.FC<{
  bible: Bible;
  g: Geometry;
  program: Program;
  active: number;
  opacity: number;
  scale?: number;
  borderOpacity?: number;
  centerY?: number;
  muted?: boolean;
  hiddenGlyphs?: (index: number) => number; // per-glyph opacity, for the dissolve into the tape
}> = ({ bible, g, program, active, opacity, scale = 1, borderOpacity = 1, centerY, muted, hiddenGlyphs }) => {
  if (opacity <= 0) return null;
  const rh = rowHeight(g, program.rules.length);
  const h = cardHeight(g, program.rules.length);
  const cy = centerY ?? g.cardBottom - h / 2;
  const glyph = (state: string) => ({ kind: "state" as const, state, index: program.states.indexOf(state), halt: program.halt.includes(state) });
  const border = muted ? bible.colors.textMuted : bible.colors.blue;
  return (
    <div
      style={{
        position: "absolute",
        left: g.headX - g.cardW / 2,
        top: cy - h / 2,
        width: g.cardW,
        height: h,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "50% 50%",
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: g.cell * 0.18, boxSizing: "border-box", border: `${g.cell * 0.04}px solid ${withAlpha(border, borderOpacity)}`, background: withAlpha(bible.colors.text, 0.035) }} />
      <div style={{ position: "absolute", top: g.pad, bottom: g.pad, left: g.pad + 2 * g.colW + g.divider / 2 - g.cell * 0.015, width: g.cell * 0.03, background: withAlpha(bible.colors.textMuted, 0.6) }} />
      {program.rules.map((rule, i) => {
        const cells: Glyph[] = [glyph(rule.state), { kind: "sym", value: rule.read }, { kind: "sym", value: rule.write }, { kind: "move", dir: rule.move }, glyph(rule.next)];
        return (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, top: g.pad + i * rh, height: rh }}>
            {i === active ? <div style={{ position: "absolute", left: g.pad * 0.4, right: g.pad * 0.4, top: rh * 0.06, bottom: rh * 0.06, borderRadius: g.cell * 0.1, background: withAlpha(bible.colors.amber, 0.2) }} /> : null}
            {cells.map((c, k) => (
              <div key={k} style={{ position: "absolute", top: (rh - g.colW) / 2, left: g.pad + k * g.colW + (k >= 2 ? g.divider : 0), width: g.colW, height: g.colW }}>
                <GlyphView glyph={c} size={g.colW} bible={bible} opacity={hiddenGlyphs ? hiddenGlyphs(i * 5 + k) : 1} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

// Position of glyph #k (rule-major order, 5 per rule) inside a card drawn by RuleCard.
export function cardGlyphCenter(g: Geometry, program: Program, k: number, centerY: number, scale: number): { x: number; y: number } {
  const rh = rowHeight(g, program.rules.length);
  const h = cardHeight(g, program.rules.length);
  const row = Math.floor(k / 5);
  const col = k % 5;
  const lx = g.pad + col * g.colW + (col >= 2 ? g.divider : 0) + g.colW / 2 - g.cardW / 2;
  const ly = g.pad + row * rh + rh / 2 - h / 2;
  return { x: g.headX + lx * scale, y: centerY + ly * scale };
}

// The machine at fractional step position s: which config, which rule is active, how far the head has moved.
export function machineAt(steps: Step[], start: Config, s: number) {
  const pos = Math.max(0, s);
  const k = Math.floor(pos);
  if (s < 0 || k >= steps.length) {
    const last = s < 0 || !steps.length ? start : steps[steps.length - 1].after;
    return { config: last, viewHead: last.head, active: -1, flip: 1, writing: null as null | { at: number; from: string; to: string } };
  }
  const st = steps[k];
  const phi = pos - k;
  const flip = ease(Math.min(1, phi * 3));
  const travel = ease(Math.min(1, Math.max(0, (phi - 1 / 3) * 1.5)));
  return {
    config: st.before,
    viewHead: lerp(st.before.head, st.after.head, travel),
    active: st.rule,
    flip,
    writing: { at: st.before.head, from: readCell(st.before, st.before.head), to: readCell(st.after, st.before.head) },
    stateAfter: travel >= 1 ? st.after.state : st.before.state,
  };
}
