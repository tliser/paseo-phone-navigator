// Header buttons on every workspace of the host serving the plugin: "Workspaces" opens the navigator,
// "Done" marks the open chat read. Header buttons are registered per workspace, so this follows that
// host's workspace list and adds or removes buttons.
// Workspaces of other hosts only get it where the plugin is installed on that host as well.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { createHostObserver } from "./host-observer";
import { ReadStateContent, ReadStateIcon } from "./read-button";
import { SCREEN_ID, useInboxTally } from "./runtime";
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
  const open = () => client.openScreen({ screenId: SCREEN_ID });

  const observer = createHostObserver(
    client.paseo,
    (directory) => {
      if (directory.loading) return;
      const live = new Set<string>();
      for (const workspace of directory.workspaces) {
        if (workspace.archivingAt || workspace.background || workspace.internal) continue;
        live.add(workspace.id);
        if (buttons.has(workspace.id)) continue;
        buttons.set(workspace.id, [
          client.addHeaderButton({
            id: "read-state",
            workspaceId: workspace.id,
            button: { title: "Done", label: "Done", icon: ReadStateIcon, behavior: { kind: "popover", Content: ReadStateContent } },
          }),
          client.addHeaderButton({
            id: "workspaces",
            workspaceId: workspace.id,
            button: { title: "Workspaces", icon: WorkspacesIcon, behavior: { kind: "action", onPress: open } },
          }),
        ]);
      }
      for (const [id, registrations] of buttons) {
        if (!live.has(id)) {
          for (const registration of registrations) registration.remove();
          buttons.delete(id);
        }
      }
    },
    { agents: false },
  );
  observer.start();
  return () => {
    observer.stop();
    for (const registrations of buttons.values()) for (const registration of registrations) registration.remove();
    buttons.clear();
  };
}
