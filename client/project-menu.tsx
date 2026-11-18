// Action sheet of a project header (hold the name on phones, right-click on desktop): its info card,
// then New workspace, manual order and folder colour.
import type { PluginTheme } from "@getpaseo/plugin";
import type { ProjectRow } from "../shared/tree";
import { InfoCard } from "./names-card";
import { Sheet, SheetDivider, SheetItem, type Anchor } from "./sheet";
import { View } from "react-native";

export function ProjectMenu({
  theme,
  compact,
  scale,
  now,
  row,
  anchor,
  manual,
  siblings,
  onCreate,
  onMove,
  onPickColor,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  scale: number;
  now: number;
  row: ProjectRow;
  anchor: Anchor | null;
  manual: boolean;
  /** Project ids of its host in their current order. */
  siblings: readonly string[];
  onCreate(): void;
  onMove(direction: -1 | 1): void;
  onPickColor(): void;
  onClose(): void;
}) {
  const index = siblings.indexOf(row.projectId);
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Sheet theme={theme} title={row.name} compact={compact} anchor={anchor} width={320} onClose={onClose}>
      <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
        <InfoCard theme={theme} row={row} scale={scale} now={now} />
      </View>
      <SheetDivider theme={theme} />
      {row.rootPath ? <SheetItem theme={theme} compact={compact} icon="Plus" label={`New workspace in ${row.name}`} onPress={then(onCreate)} /> : null}
      {manual && index !== -1 ? (
        <>
          <SheetItem theme={theme} compact={compact} icon="ArrowUp" label="Move project up" disabled={index === 0} onPress={then(() => onMove(-1))} />
          <SheetItem theme={theme} compact={compact} icon="ArrowDown" label="Move project down" disabled={index === siblings.length - 1} onPress={then(() => onMove(1))} />
        </>
      ) : null}
      <SheetItem theme={theme} compact={compact} icon="Palette" label="Folder colour…" onPress={then(onPickColor)} />
    </Sheet>
  );
}
