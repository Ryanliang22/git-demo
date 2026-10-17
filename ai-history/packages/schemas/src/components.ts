import { z } from "zod";

// Props schemas, event names and versions of every component in the library.
// Props come from skeleton.json and are language-independent; on-screen words arrive via `slot`
// keys resolved from skeleton.screenText, never as literals.

const Slot = z.string().regex(/^[a-z_]+$/);
const ColorToken = z.enum(["text", "textMuted", "amber", "blue", "red"]);
const FontRole = z.enum(["quote", "mono", "body"]);

export const TypewriterProps = z.strictObject({
  font: FontRole,
  slot: Slot,
});
export const CursorProps = z.strictObject({ color: ColorToken.default("amber") });
export const YearStampProps = z.strictObject({ year: z.number().int().min(1000).max(2999) });
export const CaptionProps = z.strictObject({});
export const AILabelProps = z.strictObject({});
export const DocumentPageProps = z.strictObject({ font: FontRole, slot: Slot });
export const RedactionProps = z.strictObject({ lines: z.number().int().min(1).max(20) });
export const ImitationGameProps = z.strictObject({});
export const NetworkGrowProps = z.strictObject({ nodes: z.number().int().min(3).max(200), seed: z.number().int() });
export const EnigmaRotorsProps = z.strictObject({ rotors: z.number().int().min(1).max(5), seed: z.number().int() });
export const EndCardProps = z.strictObject({ seriesSlot: Slot, labelSlot: Slot });

export const TuringProgramId = z.enum(["binary_increment", "binary_counter", "bit_invert", "unary_add"]);
export const MachineOutline = z.enum(["frame", "gear", "keypad", "dial"]);
export const TuringMachineProps = z.strictObject({
  mode: z.enum(["build", "universal", "outro", "stop"]),
  program: TuringProgramId,
  input: z.string().regex(/^[01_]+$/),
  // universal mode: the machine whose rules get encoded onto the tape
  guest: TuringProgramId.optional(),
  // universal mode: the machines this one plays after reading the guest description
  morphs: z.array(z.strictObject({ program: TuringProgramId, outline: MachineOutline, input: z.string().regex(/^[01_]+$/) })).optional(),
});
export type TuringMachineProps = z.infer<typeof TuringMachineProps>;

type Spec = { version: string; props: z.ZodType; events: readonly string[]; overlay?: boolean };

export const componentSpecs = {
  "grammar/Cursor": { version: "0.1.0", props: CursorProps, events: ["show", "hide"] },
  "grammar/Typewriter": { version: "0.1.0", props: TypewriterProps, events: ["showCursor", "type", "newLine", "fadeOut"] },
  "grammar/YearStamp": { version: "0.1.0", props: YearStampProps, events: ["show", "dock", "hide"] },
  "grammar/Caption": { version: "0.1.0", props: CaptionProps, events: [], overlay: true },
  "grammar/AILabel": { version: "0.1.0", props: AILabelProps, events: [], overlay: true },
  "grammar/DocumentPage": { version: "0.1.0", props: DocumentPageProps, events: ["show", "type", "fadeOut"] },
  "grammar/Redaction": { version: "0.1.0", props: RedactionProps, events: ["redact"] },
  "grammar/ImitationGame": { version: "0.1.0", props: ImitationGameProps, events: ["show", "chat", "question"] },
  "grammar/NetworkGrow": { version: "0.1.0", props: NetworkGrowProps, events: ["grow", "collapseToCursor"] },
  "grammar/EnigmaRotors": { version: "0.1.0", props: EnigmaRotorsProps, events: ["show", "align"] },
  "grammar/EndCard": { version: "0.1.0", props: EndCardProps, events: ["show"] },
  "signature/TuringMachine": {
    version: "0.1.0",
    props: TuringMachineProps,
    events: ["showTape", "showHead", "showRules", "encodeGuest", "morph", "collapse", "halt"],
  },
} as const satisfies Record<string, Spec>;

export type RegisteredComponent = keyof typeof componentSpecs;
