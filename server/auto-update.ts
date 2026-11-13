// Keeps a Git installation of this plugin on the newest commit, through the host's own
// `paseo plugin update`. A failed build keeps the installed version (Paseo's guarantee).
// Installations from a local folder (development) are left alone.
import { stat } from "node:fs/promises";
import { dirname, sep } from "node:path";
import type { InstalledVersion } from "../shared/updates";
import { runCli, startCliDetached } from "./cli";

const PLUGIN_ID = "phone-navigator";

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

async function ownInstallation(): Promise<Listed | null> {
  const listed = JSON.parse(await runCli(["plugin", "ls", "--json"])) as Listed[];
  const own = listed.find((entry) => entry.id === PLUGIN_ID);
  return own && own.source === "git" && own.commit ? own : null;
}

/** `<home>/plugins/<id>/<install folder>/…`: every update installs into a new folder. */
function installFolder(entry: Listed): string {
  const parts = entry.path.split(/[\\/]/);
  const at = parts.findIndex((part, index) => part === "plugins" && parts[index + 1] === entry.id);
  return at === -1 || !parts[at + 2] ? dirname(entry.path) : parts.slice(0, at + 3).join(sep);
}

/** The version installed from Git on this host, or null for a local folder. */
export async function installedVersion(): Promise<InstalledVersion | null> {
  const own = await ownInstallation();
  if (!own?.commit) return null;
  return { commit: own.commit, installedAt: Math.round((await stat(installFolder(own))).mtimeMs) };
}

/** Checks once and starts the update when a newer commit exists. Returns what happened, for the log. */
export async function updateIfBehind(): Promise<string> {
  if (!(await ownInstallation())) return "not installed from Git; nothing to update";
  const [check] = JSON.parse(await runCli(["plugin", "update", PLUGIN_ID, "--check", "--json"])) as CheckResult[];
  if (check?.outcome !== "update") return `up to date (${check?.outcome ?? "no answer"})`;
  startCliDetached(["plugin", "update", PLUGIN_ID, "--yes"]);
  return `updating to ${check.target?.commit?.slice(0, 7) ?? "the newest commit"}`;
}
