import type { PluginServerContext } from "@getpaseo/plugin/server";
import { profilesSettings, readsSettings } from "./shared/settings";

// No daemon logic: the server entry only enables storage for the profiles and read-state documents.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(profilesSettings);
  server.registerSettings(readsSettings);
  return () => {};
}
