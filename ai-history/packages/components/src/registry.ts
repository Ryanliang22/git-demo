import type { ComponentProps } from "./lib/context";
import { Cursor } from "./grammar/Cursor";
import { Typewriter } from "./grammar/Typewriter";
import { YearStamp } from "./grammar/YearStamp";
import { TuringMachine } from "./signature/TuringMachine";

// Shot components by skeleton name. Caption and AILabel are drawn by the shell on every shot.
// DocumentPage, Redaction, ImitationGame, NetworkGrow, EnigmaRotors and EndCard arrive with M1.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, React.FC<ComponentProps<any>>> = {
  "grammar/Cursor": Cursor,
  "grammar/Typewriter": Typewriter,
  "grammar/YearStamp": YearStamp,
  "signature/TuringMachine": TuringMachine,
};
