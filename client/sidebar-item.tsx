import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SCREEN_ID, useAttentionCount } from "./runtime";
import { Badge } from "./visual";

/** One row only: the native sidebar keeps its room for the project list. */
export function SidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const attention = useAttentionCount();
  return (
    <SidebarRow
      icon="Layers"
      label="Workspaces"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={<Badge theme={theme} count={attention} />}
    />
  );
}
