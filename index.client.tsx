import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { registerHeaderButtons } from "./client/header-buttons";
import { NavigatorScreen } from "./client/navigator-screen";
import { getStore, SCREEN_ID, SETTINGS_ID, setStore } from "./client/runtime";
import { watchSettings } from "./client/settings-watch";
import { SettingsScreen } from "./client/settings-screen";
import { SidebarItem } from "./client/sidebar-item";
import { createStore } from "./client/store";
import { profilesSettings, readsSettings } from "./shared/settings";
import { updatesSettings } from "./shared/updates";

export default function contribute(client: PluginClientContext) {
  setStore(
    createStore(
      (contract, input) => client.rpc(contract, input),
      (changed) => watchSettings(client, [profilesSettings.id, readsSettings.id, updatesSettings.id], changed),
      { resolveSelf: async () => (await client.paseo.hosts.list()).self.serverId },
    ),
  );
  const openSettings = () => client.openSettings(SETTINGS_ID);
  const Screen = (props: PluginScreenProps) => <NavigatorScreen {...props} openSettings={openSettings} />;

  const cleanups: (() => void | Promise<void>)[] = [
    client.addScreen({ id: SCREEN_ID, title: "Workspaces", Component: Screen }),
    client.addSettingsScreen({ id: SETTINGS_ID, title: "Phone Navigator", icon: "Layers", Component: SettingsScreen }),
    client.addSidebarHeaderItem({ id: "workspaces", title: "Workspaces", Component: SidebarItem }),
    client.addCommandCenterItem({
      id: "open-workspaces",
      title: "Workspaces",
      icon: "Layers",
      keywords: ["workspaces", "navigator", "hosts", "projects", "tree"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN_ID }),
    }),
    registerHeaderButtons(client),
  ];

  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
    getStore().dispose();
    setStore(null);
  };
}
