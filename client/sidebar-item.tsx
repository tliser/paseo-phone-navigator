import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SCREEN_ID, useTally } from "./runtime";
import { TallyBadge } from "./visual";

/** One row only: the native sidebar keeps its room for the project list. */
export function SidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const tally = useTally();
  return (
    <SidebarRow
      icon="Layers"
      label="Workspaces"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={<TallyBadge theme={theme} tally={tally} />}
    />
  );
}
