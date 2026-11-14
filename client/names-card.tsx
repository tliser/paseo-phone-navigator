// The full-names card: everything a workspace row cuts short, in full. Shown while hovering a row on
// desktop and while long-pressing it on phones. Draws over the list, never takes a touch itself.
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import { timeAgo } from "../shared/format";
import type { TreeRow } from "../shared/tree";
import { MONO_FONT } from "./font-scale";

export interface Peek {
  row: TreeRow;
  /** Bottom and top of the row in the list's visible area, px. */
  top: number;
  rowTop: number;
}

const STATE_LABEL = { needs_you: "Asking you", unread: "Unread", running: "Running", read: "Read" } as const;
const CARD_HEIGHT_GUESS = 150;

export function NamesCard({ theme, peek, scale, now, areaHeight }: { theme: PluginTheme; peek: Peek; scale: number; now: number; areaHeight: number }) {
  const { row } = peek;
  if (row.type !== "workspace") return null;
  const c = theme.colors;
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const { workspace } = row;
  const ago = timeAgo(workspace.activityAt, now);
  // Below the row, or above it when there is no room underneath.
  const above = areaHeight > 0 && peek.top + CARD_HEIGHT_GUESS > areaHeight && peek.rowTop > CARD_HEIGHT_GUESS;
  const line = (label: string, value: string, mono = false) => (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ width: 64, color: c.foregroundMuted, fontSize: fs(12) }}>{label}</Text>
      <Text style={{ flex: 1, color: c.foreground, fontSize: fs(12), ...(mono ? { fontFamily: MONO_FONT } : null) }} selectable>{value}</Text>
    </View>
  );
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Full names"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        ...(above ? { bottom: Math.max(4, areaHeight - peek.rowTop + 4) } : { top: Math.max(4, peek.top + 4) }),
        zIndex: 50,
        elevation: 12,
        padding: 12,
        gap: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Text style={{ color: c.foreground, fontSize: fs(14), fontWeight: "600" }}>{workspace.title}</Text>
      {line("Project", workspace.projectName)}
      {line("Host", row.hostLabel)}
      {workspace.branch ? line("Branch", workspace.branch, true) : null}
      {workspace.model ? line("Model", workspace.model, true) : null}
      {line("Status", `${STATE_LABEL[row.state]}${ago ? `, ${ago}` : ""}`)}
      {workspace.additions || workspace.deletions ? line("Changes", `+${workspace.additions} −${workspace.deletions}`) : null}
      {workspace.projectRootPath ? line("Folder", workspace.projectRootPath, true) : null}
      {(workspace.agents?.length ?? 0) > 1 ? line("Agents", (workspace.agents ?? []).map((agent) => `${agent.title} (${agent.status})`).join("\n")) : null}
    </View>
  );
}
