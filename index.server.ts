import type { PluginServerContext } from "@getpaseo/plugin/server";
import { profilesSettings } from "./shared/settings";

// No daemon logic: the server entry only enables storage for the profiles document.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(profilesSettings);
  return () => {};
}
