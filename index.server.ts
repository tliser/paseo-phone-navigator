import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installedVersion, updateIfBehind } from "./server/auto-update";
import { profilesSettings, readsSettings } from "./shared/settings";
import { checkForUpdateRpc, installedVersionRpc, updatesSettings, type InstalledVersion } from "./shared/updates";

/** First check a little after start, so a starting host is not slowed down; then every few hours. */
const FIRST_CHECK_MS = 2 * 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

// Storage for profiles and read state, and the update check that keeps a Git install current.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(profilesSettings);
  server.registerSettings(readsSettings);
  const updates = server.registerSettings(updatesSettings);

  let checking = false;
  const check = async (reason: string, force = false) => {
    if (checking) return "a check is already running";
    checking = true;
    try {
      if (!force) {
        const state = await updates.read();
        // An unreadable document keeps the default (on).
        if (state.status === "ready" && !state.values.autoUpdate) return "automatic updates are off";
      }
      const result = await updateIfBehind();
      console.log(`Phone Navigator update check (${reason}): ${result}`);
      return result;
    } catch (error) {
      console.error("Phone Navigator update check failed", error);
      return `failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      checking = false;
    }
  };
  server.handle(checkForUpdateRpc, async () => ({ result: await check("asked from the settings", true) }));

  // Only changes with an update, which restarts this process, so it is read once.
  const own: Promise<InstalledVersion | null> = installedVersion().catch((error: unknown) => {
    console.error("Phone Navigator: reading the installed version failed", error);
    return null;
  });
  server.handle(installedVersionRpc, () => own);

  // Another host installed a newer version (the app records it in the synced settings): check now
  // instead of at the next scheduled check.
  let followed: string | null = null;
  const follow = async (latest: InstalledVersion | null) => {
    const mine = await own;
    if (!latest || !mine || latest.commit === mine.commit || latest.installedAt <= mine.installedAt) return;
    if (followed === latest.commit) return;
    followed = latest.commit;
    await check(`another host has ${latest.commit.slice(0, 7)}`);
  };
  const unsubscribe = updates.subscribe((state) => (state.status === "ready" ? follow(state.values.latestVersion) : undefined));
  void updates.read().then((state) => (state.status === "ready" ? follow(state.values.latestVersion) : undefined));

  const first = setTimeout(() => void check("after start"), FIRST_CHECK_MS);
  const every = setInterval(() => void check("scheduled"), CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
    unsubscribe();
  };
}
