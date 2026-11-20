// Header buttons on every workspace of the host serving the plugin: "Workspaces" opens the navigator (with a
// dot for what waits), "Mark read" marks the open chat read; it reads "Mark unread" while the workspace has
// nothing unread. Workspaces comes first: phones show
// only the first plugin button inline. Header buttons are registered per workspace, so this follows that
// host's workspace list and adds or removes buttons.
// Workspaces of other hosts only get it where the plugin is installed on that host as well.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { chatState, topLevelChats } from "../shared/tree";
import { createHostObserver } from "./host-observer";
import { ReadStateContent, ReadStateIcon } from "./read-button";
import { getStore, SCREEN_ID, useInboxTally } from "./runtime";
import { unreadColor } from "./colors";

function WorkspacesIcon({ theme, size, color }: PluginButtonIconProps) {
  const inbox = useInboxTally();
  const urgent = inbox.asking + inbox.error;
  // Paseo draws plugin button icons in a box exactly `size` wide that clips overflow (header and the
  // "More actions" menu alike), so the indicator must stay inside it: a dot in the top-right corner,
  // amber when a chat asks you or failed, blue for unread news.
  const dot = Math.max(6, Math.round(size * 0.45));
  const signal = urgent ? theme.colors.statusWarning : inbox.unread ? unreadColor(theme) : null;
  return (
    <View
      accessible
      style={{ width: size, height: size }}
      accessibilityLabel={urgent ? `${urgent} ask you or failed` : inbox.unread ? `${inbox.unread} unread` : undefined}
    >
      <Icon name="Layers" size={size} color={color} />
      {/* Urgent: a solid amber dot; unread only: a blue ring. Shape tells them apart, not colour alone. */}
      {signal ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            ...(urgent ? { backgroundColor: signal } : { borderWidth: 2, borderColor: signal }),
          }}
        />
      ) : null}
    </View>
  );
}

export function registerHeaderButtons(client: PluginClientContext): () => void {
  if (typeof client.addHeaderButton !== "function") return () => undefined;
  const buttons = new Map<string, PluginButtonRegistration[]>();
  const labels = new Map<string, string>();
  const open = () => client.openScreen({ screenId: SCREEN_ID });
  let selfId: string | null = null;
  let stopped = false;

  /** "Mark read" while a top-level chat of the workspace is unread (or nothing is known), else "Mark unread". */
  function labelOf(workspaceId: string): string {
    const snapshot = getStore().getSnapshot();
    const host = snapshot.hosts.find((entry) => entry.serverId === selfId);
    const workspace = host?.workspaces.find((entry) => entry.id === workspaceId);
    const states = topLevelChats(workspace?.agents ?? []).map((agent) => chatState(agent, host!.serverId, workspaceId, snapshot.reads, Date.now()));
    return states.includes("unread") || !states.includes("read") ? "Mark read" : "Mark unread";
  }
  /** Updates only labels that changed: every update makes Paseo redraw the headers. */
  function relabel() {
    if (!selfId) return;
    for (const [workspaceId, registrations] of buttons) {
      const label = labelOf(workspaceId);
      if (labels.get(workspaceId) === label) continue;
      labels.set(workspaceId, label);
      registrations[1]?.update({ title: label, label });
    }
  }
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      selfId = self.serverId;
      if (!stopped) relabel();
    })
    .catch(() => undefined);

  const observer = createHostObserver(
    client.paseo,
    (directory) => {
      if (directory.loading) return;
      const live = new Set<string>();
      for (const workspace of directory.workspaces) {
        if (workspace.archivingAt || workspace.background || workspace.internal) continue;
        live.add(workspace.id);
        if (buttons.has(workspace.id)) continue;
        const label = labelOf(workspace.id);
        labels.set(workspace.id, label);
        buttons.set(workspace.id, [
          client.addHeaderButton({
            id: "workspaces",
            workspaceId: workspace.id,
            button: { title: "Workspaces", icon: WorkspacesIcon, behavior: { kind: "action", onPress: open } },
          }),
          client.addHeaderButton({
            id: "read-state",
            workspaceId: workspace.id,
            button: { title: label, label, icon: ReadStateIcon, behavior: { kind: "popover", Content: ReadStateContent } },
          }),
        ]);
      }
      for (const [id, registrations] of buttons) {
        if (!live.has(id)) {
          for (const registration of registrations) registration.remove();
          buttons.delete(id);
          labels.delete(id);
        }
      }
      relabel();
    },
    { agents: false },
  );
  observer.start();
  const unsubscribe = getStore().subscribe(relabel);
  return () => {
    stopped = true;
    unsubscribe();
    observer.stop();
    for (const registrations of buttons.values()) for (const registration of registrations) registration.remove();
    buttons.clear();
  };
}
