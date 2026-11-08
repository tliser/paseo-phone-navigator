// A "Workspaces" header button on every workspace of the host serving the plugin. Header buttons are
// registered per workspace, so this follows that host's workspace list and adds or removes buttons.
// Workspaces of other hosts only get it where the plugin is installed on that host as well.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { createHostObserver } from "./host-observer";
import { SCREEN_ID, useAttentionCount } from "./runtime";
import { Badge } from "./visual";

function WorkspacesIcon({ theme, size, color }: PluginButtonIconProps) {
  const attention = useAttentionCount();
  return (
    <View style={{ width: size + 8, height: size + 8, alignItems: "center", justifyContent: "center" }}>
      <Icon name="Layers" size={size} color={color} />
      {attention > 0 ? (
        <View style={{ position: "absolute", top: -4, right: -6 }}>
          <Badge theme={theme} count={attention} small />
        </View>
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
