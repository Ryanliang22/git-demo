import { Config } from "@remotion/cli/config";

Config.setEntryPoint("remotion/index.ts");
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
