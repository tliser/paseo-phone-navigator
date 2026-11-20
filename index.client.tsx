import type { PluginClientContext, PluginScreenProps, PluginSidebarViewProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { listenForChatInput } from "./client/chat-input";
import { chatKey, publishOpener, usePublishActiveChat } from "./client/chat-nav";
import { registerComposerPills } from "./client/composer-pills";
import { GO_SCREEN_ID, GoScreen } from "./client/go-screen";
import { registerHeaderButtons } from "./client/header-buttons";
import { NavigatorScreen } from "./client/navigator-screen";
import { agentRef, workspaceRef } from "./client/refs";
import { getStore, PROFILES_SCREEN_ID, SCREEN_ID, SETTINGS_ID, setGoScreen, setStore, useTerminalTabs } from "./client/runtime";
import { watchSettings } from "./client/settings-watch";
import { SettingsLauncher } from "./client/settings-launcher";
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
  // Composer pills cannot navigate; outside the sidebar view they open chats through the go screen.
  setGoScreen((serverId, agentId) => client.openScreen({ screenId: GO_SCREEN_ID, params: { serverId, agentId } }));
  // Profile settings are a screen of their own: Paseo's settings page wraps plugin settings in its page
  // scroll with the plugin's description and source, so nothing there can stay on top.
  const openSettings = () => client.openScreen({ screenId: PROFILES_SCREEN_ID });
  const Launcher = (props: PluginSurfaceProps) => <SettingsLauncher {...props} openProfiles={openSettings} />;
  const Screen = (props: PluginScreenProps) => <NavigatorScreen {...props} surface="screen" openSettings={openSettings} />;
  // Paseo 0.16+: the navigator can replace the app's sidebar. Its navigation opens by entity ref.
  const SidebarView = ({ theme, layout, navigation, active, dismiss }: PluginSidebarViewProps) => {
    // Paseo knows which chat is open; the composer pills only guess (tabs and screens stay mounted when hidden).
    usePublishActiveChat(active.agent ? chatKey(active.agent.hostId, active.agent.id) : null);
    // While shown, the sidebar's own navigation opens chats for the composer pills and back/forward.
    useEffect(() => publishOpener((serverId, agentId) => navigation.openAgent(agentRef(serverId, agentId))), [navigation]);
    return (
      <NavigatorScreen
        surface="sidebar"
        terminals={useTerminalTabs()}
        theme={theme}
        layout={layout}
        host={{ id: active.workspace?.hostId ?? "", label: "" }}
        params={{}}
        // As Paseo's own sidebar navigation does: navigate, then dismiss (closes the drawer on phones, or the
        // settings open behind it).
        openSettings={() => {
          openSettings();
          dismiss();
        }}
        activeWorkspace={active.workspace ? { serverId: active.workspace.hostId, workspaceId: active.workspace.id } : null}
        navigation={{
          openWorkspace: ({ workspaceId, serverId }) => navigation.openWorkspace(workspaceRef(serverId ?? "", workspaceId)),
          openAgent: ({ agentId, serverId }) => navigation.openAgent(agentRef(serverId ?? "", agentId)),
          openTerminal: (ref) => navigation.openTerminal(ref),
        }}
      />
    );
  };

  const cleanups: (() => void | Promise<void>)[] = [
    client.addScreen({ id: SCREEN_ID, title: "Workspaces", Component: Screen }),
    client.addScreen({ id: PROFILES_SCREEN_ID, title: "Workspace Organizer settings", Component: SettingsScreen }),
    client.addScreen({ id: GO_SCREEN_ID, title: "Opening chat", Component: GoScreen }),
    client.addSettingsScreen({ id: SETTINGS_ID, title: "Workspace Organizer", icon: "Layers", Component: Launcher }),
    client.addSidebarHeaderItem({ id: "workspaces", title: "Workspaces", Component: SidebarItem }),
    ...(typeof client.addSidebarView === "function"
      ? [client.addSidebarView({ id: "navigator", title: "Workspace Organizer", description: "Hosts, projects and workspaces as a tree, with an inbox of what needs you.", Component: SidebarView })]
      : []),
    client.addCommandCenterItem({
      id: "open-workspaces",
      title: "Workspaces",
      icon: "Layers",
      keywords: ["workspaces", "navigator", "hosts", "projects", "tree"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN_ID }),
    }),
    registerHeaderButtons(client),
    registerComposerPills(client),
    listenForChatInput(),
    () => setGoScreen(null),
  ];

  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
    getStore().dispose();
    setStore(null);
  };
}
