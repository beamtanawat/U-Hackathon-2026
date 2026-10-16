import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: ".playwright-browsers" },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
