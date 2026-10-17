import fs from "node:fs";
import path from "node:path";
import { CaptionsFile, Timeline } from "@ai-history/schemas";
import { DataError, loadEpisode, type Episode } from "./context";
import { readJson } from "./lib/util";
import { captions } from "./stages/captions";
import { exportStage } from "./stages/export";
import { previews } from "./stages/previews";
import { qc } from "./stages/qc";
import { render } from "./stages/render";
import { stills } from "./stages/stills";
import { timing } from "./stages/timing";
import { tts } from "./stages/tts";
import { validate } from "./stages/validate";

// pnpm ep <stage> <episode> --lang zh|en|all [--shots S01-S04]
const STAGES = ["validate", "tts", "timing", "captions", "render", "stills", "qc", "export"] as const;
type Stage = (typeof STAGES)[number];

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
    } else positional.push(a);
  }
  return { positional, flags };
}

function loadTimeline(ep: Episode, lang: string) {
  const t = Timeline.parse(readJson(path.join(ep.buildDir, `timeline.${lang}.json`)));
  if (t.selection.join(",") !== ep.selection.join(","))
    throw new DataError(`timeline.${lang}.json was built for shots ${t.selection.join(",")}; re-run timing with the same --shots`);
  return t;
}
function loadCaptions(ep: Episode, lang: string) {
  return CaptionsFile.parse(readJson(path.join(ep.buildDir, `captions.${lang}.json`)));
}

async function runStage(stage: Stage, ep: Episode, draft: boolean) {
  for (const lang of ep.langs) {
    fs.mkdirSync(path.join(ep.buildDir, lang), { recursive: true });
    switch (stage) {
      case "tts":
        await tts(ep, lang);
        break;
      case "timing":
        await timing(ep, lang);
        break;
      case "captions": {
        const { violations } = captions(ep, lang, loadTimeline(ep, lang));
        if (violations.length) throw new Error(`caption rules violated:\n${violations.join("\n")}`);
        break;
      }
      case "render":
        await render(ep, lang, { timeline: loadTimeline(ep, lang), captions: loadCaptions(ep, lang), draft });
        break;
      case "stills":
        await stills(ep, lang, { timeline: loadTimeline(ep, lang), captions: loadCaptions(ep, lang) });
        break;
      case "qc": {
        const report = await qc(ep, lang, { timeline: loadTimeline(ep, lang), captions: loadCaptions(ep, lang) });
        if (!report.passed) throw new Error(`qc failed for ${lang}: ${report.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")}`);
        break;
      }
      case "export":
        await exportStage(ep, lang, { timeline: loadTimeline(ep, lang) });
        break;
      default:
        break;
    }
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, epId] = positional;
  if (!command || !epId) {
    console.log(`usage: pnpm ep <${[...STAGES, "build", "lint", "previews"].join("|")}> <episode> [--lang zh|en|all] [--shots S01-S04]`);
    process.exit(2);
  }
  const ep = loadEpisode(epId, { lang: flags.lang, shots: flags.shots, logName: command });
  ep.log.info(`[ep] ${command} ${ep.id} · langs ${ep.langs.join(",")} · shots ${ep.selection.join(",")} · milestone ${ep.production.milestone}`);
  const started = Date.now();

  if (command === "previews") return previews(ep);
  const v = await validate(ep, { forExport: command === "export" || command === "build" });
  if (!v.ok) throw new DataError(`validate failed with ${v.errors.length} error(s)`);
  if (command === "validate" || command === "lint") return;

  const stages: Stage[] = command === "build" ? [...STAGES.slice(1)] : [command as Stage];
  if (!STAGES.includes(command as Stage) && command !== "build") throw new DataError(`unknown command ${command}`);
  for (const stage of stages) await runStage(stage, ep, v.draft);
  ep.log.info(`[ep] done in ${((Date.now() - started) / 1000).toFixed(1)}s · log ${path.relative(process.cwd(), ep.log.file)}`);
}

main().catch((e) => {
  console.error(e instanceof DataError ? `\n✗ ${e.message}` : e);
  process.exit(1);
});
