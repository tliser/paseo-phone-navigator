// A "Workspaces" header button on every workspace of the host serving the plugin. Header buttons are
// registered per workspace, so this follows that host's workspace list and adds or removes buttons.
// Workspaces of other hosts only get it where the plugin is installed on that host as well.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { createHostObserver } from "./host-observer";
import { SCREEN_ID, useTally } from "./runtime";
import { UNREAD_BLUE } from "./visual";

function WorkspacesIcon({ theme, size, color }: PluginButtonIconProps) {
  const tally = useTally();
  // Paseo draws plugin button icons in a box exactly `size` wide that clips overflow (header and the
  // "More actions" menu alike), so the indicator must stay inside it: a dot in the top-right corner,
  // amber when something asks you, blue for unread news.
  const dot = Math.max(6, Math.round(size * 0.45));
  const signal = tally.needsYou ? theme.colors.statusWarning : tally.unread ? UNREAD_BLUE : null;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityLabel={tally.needsYou ? `${tally.needsYou} asking you` : tally.unread ? `${tally.unread} unread` : undefined}
    >
      <Icon name="Layers" size={size} color={color} />
      {signal ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: signal,
          }}
        />
      ) : null}
    </View>
  );
}

export function registerHeaderButtons(client: PluginClientContext): () => void {
  if (typeof client.addHeaderButton !== "function") return () => undefined;
  const buttons = new Map<string, PluginButtonRegistration>();
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
        buttons.set(
          workspace.id,
          client.addHeaderButton({
            id: "workspaces",
            workspaceId: workspace.id,
            button: { title: "Workspaces", icon: WorkspacesIcon, behavior: { kind: "action", onPress: open } },
          }),
        );
      }
      for (const [id, button] of buttons) {
        if (!live.has(id)) {
          button.remove();
          buttons.delete(id);
        }
      }
    },
    { agents: false },
  );
  observer.start();
  return () => {
    observer.stop();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
