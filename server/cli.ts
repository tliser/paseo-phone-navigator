// Runs this host's `paseo` CLI without a shell, so arguments are passed verbatim. Paseo has no plugin
// API for updating a plugin; the CLI is the same command a person would type.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;

interface Cli {
  file: string;
  /** Arguments before the CLI's own. */
  prefix: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * The desktop app runs plugins with its own executable and ships the CLI in its resources. An npm
 * install has `paseo` next to node or on PATH.
 */
function findCli(): Cli {
  const home = dirname(process.execPath);
  const resources = join(home, "resources");
  const runner = join(resources, "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js");
  const entry = join(resources, "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js");
  if (existsSync(runner)) {
    return {
      file: process.execPath,
      prefix: ["--disable-warning=DEP0040", runner, "node-script", entry],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PASEO_NODE_ENV: "production", PASEO_DESKTOP_MANAGED: "1" },
    };
  }
  if (process.platform === "win32") throw new Error("the Paseo CLI was not found next to this host's Paseo app");
  const beside = join(home, "paseo");
  return { file: existsSync(beside) ? beside : "paseo", prefix: [], env: process.env };
}

function fullArgs(cli: Cli, args: readonly string[]): string[] {
  const home = process.env.PASEO_HOME ? ["--home", process.env.PASEO_HOME] : [];
  return [...cli.prefix, ...args, ...home];
}

/** Runs the CLI and returns its standard output. */
export async function runCli(args: readonly string[]): Promise<string> {
  const cli = findCli();
  const { stdout } = await execFileAsync(cli.file, fullArgs(cli, args), { env: cli.env, timeout: TIMEOUT_MS, windowsHide: true });
  return stdout;
}

/** Starts the CLI so it outlives this process: a plugin update stops and reloads this plugin. */
export function startCliDetached(args: readonly string[]): void {
  const cli = findCli();
  spawn(cli.file, fullArgs(cli, args), { env: cli.env, detached: true, stdio: "ignore", windowsHide: true }).unref();
}
