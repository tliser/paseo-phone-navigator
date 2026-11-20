// Keeps a Git installation of this plugin on the newest commit, through the host's own
// `paseo plugin update`. A failed build keeps the installed version (Paseo's guarantee).
// Installations from a local folder (development) are not updated, but a folder that is a Git checkout
// reports its commit, so the other hosts' Git installs update as soon as it is loaded with a new one.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, sep } from "node:path";
import { promisify } from "node:util";
import type { InstalledVersion } from "../shared/updates";
import { runCli, startCliDetached } from "./cli";

const execFileAsync = promisify(execFile);
/** When this copy was loaded: a local folder counts as installed then (a reload loads new code). */
const loadedAt = Date.now();

const PLUGIN_ID = "workspace-organizer";

interface Listed {
  id: string;
  path: string;
  source?: string;
  commit?: string;
}

interface CheckResult {
  id: string;
  outcome: string;
  target?: { commit?: string };
}

async function listedSelf(): Promise<Listed | null> {
  const listed = JSON.parse(await runCli(["plugin", "ls", "--json"])) as Listed[];
  return listed.find((entry) => entry.id === PLUGIN_ID) ?? null;
}

async function ownInstallation(): Promise<Listed | null> {
  const own = await listedSelf();
  return own && own.source === "git" && own.commit ? own : null;
}

/** `<home>/plugins/<id>/<install folder>/…`: every update installs into a new folder. */
function installFolder(entry: Listed): string {
  const parts = entry.path.split(/[\\/]/);
  const at = parts.findIndex((part, index) => part === "plugins" && parts[index + 1] === entry.id);
  return at === -1 || !parts[at + 2] ? dirname(entry.path) : parts.slice(0, at + 3).join(sep);
}

/** The version installed from Git on this host; for a local folder, its checked-out commit (local), else null. */
export async function installedVersion(): Promise<InstalledVersion | null> {
  const own = await listedSelf();
  if (!own) return null;
  if (own.source === "git" && own.commit) return { commit: own.commit, installedAt: Math.round((await stat(installFolder(own))).mtimeMs) };
  const head = await execFileAsync("git", ["-C", own.path, "rev-parse", "HEAD"], { timeout: 10_000 }).catch(() => null);
  const commit = head?.stdout.trim();
  return commit && /^[0-9a-f]{40}$/.test(commit) ? { commit, installedAt: loadedAt, local: true } : null;
}

/** Checks once and starts the update when a newer commit exists. Returns what happened, for the log. */
export async function updateIfBehind(): Promise<string> {
  if (!(await ownInstallation())) return "not installed from Git; nothing to update";
  const [check] = JSON.parse(await runCli(["plugin", "update", PLUGIN_ID, "--check", "--json"])) as CheckResult[];
  if (check?.outcome !== "update") return `up to date (${check?.outcome ?? "no answer"})`;
  startCliDetached(["plugin", "update", PLUGIN_ID, "--yes"]);
  return `updating to ${check.target?.commit?.slice(0, 7) ?? "the newest commit"}`;
}
