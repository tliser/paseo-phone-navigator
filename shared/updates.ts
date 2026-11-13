// Auto-update: settings shared by every client of a host, and the RPCs the app uses.
// Pure contracts (zod), no daemon access, so client and server both import them.
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** The version installed from Git on a host: its commit and when it was installed (ms). */
export const installedVersionSchema = z.object({ commit: z.string(), installedAt: z.number() });
export type InstalledVersion = z.output<typeof installedVersionSchema>;

export const updatesDocumentSchema = z.object({
  /** Check for and install new versions of this plugin on its own. */
  autoUpdate: z.boolean().default(true),
});
export type UpdatesDocument = z.output<typeof updatesDocumentSchema>;

export const updatesSettings = defineSettings({ id: "updates", scope: "host", version: 1, schema: updatesDocumentSchema });

/** This host's installed version, or null when the plugin runs from a local folder. */
export const installedVersionRpc = defineRpc({
  name: "updates.installed",
  input: z.object({}),
  output: installedVersionSchema.nullable(),
});

/** Checks the plugin's Git source now and starts the update when it is behind. */
export const checkForUpdateRpc = defineRpc({
  name: "updates.check",
  input: z.object({}),
  output: z.object({ result: z.string() }),
});
