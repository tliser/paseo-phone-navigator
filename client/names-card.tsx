// The info card: everything a workspace, tab or project row may cut short, in full. Shown while hovering
// a row on desktop, and as the header of a row's action sheet. The hover card never takes a touch.
import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { timeAgo } from "../shared/format";
import type { ProjectRow, TabRow, TreeRow, WorkspaceRow } from "../shared/tree";
import { MONO_FONT } from "./font-scale";
import { MARK_LABEL } from "./marks";

export interface Peek {
  row: TreeRow;
  /** Bottom and top of the row in the list's visible area, px. */
  top: number;
  rowTop: number;
}

const STATE_LABEL = { needs_you: "Asks you", error: "Agent error", unread: "Unread", running: "Running", read: "Read" } as const;
const KIND_LABEL = { git: "Git repository", directory: "Folder", non_git: "Folder" } as const;
const CARD_HEIGHT_GUESS = 170;

type InfoRow = WorkspaceRow | TabRow | ProjectRow;

export const hasInfo = (row: TreeRow): row is InfoRow => row.type === "workspace" || row.type === "tab" || row.type === "project";

/** The card's content; `parentTitle` names a sub-agent's parent chat. */
export function InfoCard({ theme, row, scale, now, parentTitle }: { theme: PluginTheme; row: InfoRow; scale: number; now: number; parentTitle?: string }) {
  const c = theme.colors;
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const line = (label: string, value: string, mono = false) => (
    <View key={label} style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ width: 72, color: c.foregroundMuted, fontSize: fs(12) }}>{label}</Text>
      <Text style={{ flex: 1, color: c.foreground, fontSize: fs(12), ...(mono ? { fontFamily: MONO_FONT } : null) }} selectable>{value}</Text>
    </View>
  );
  let kind: string;
  let title: string;
  let lines: (ReactElement | null)[];
  if (row.type === "workspace") {
    const { workspace } = row;
    const ago = timeAgo(workspace.activityAt, now);
    kind = "Workspace";
    title = workspace.title;
    lines = [
      line("Status", STATE_LABEL[row.state]),
      line("Where", `${row.hostLabel} / ${workspace.projectName}`),
      workspace.branch ? line("Branch", workspace.branch, true) : null,
      workspace.model ? line("Model", workspace.model, true) : null,
      workspace.additions || workspace.deletions ? line("Changes", `+${workspace.additions} −${workspace.deletions}`) : null,
      ago ? line("Activity", `${ago} ago`) : null,
      row.tabs ? line("Tabs", row.tabs.summary) : null,
    ];
  } else if (row.type === "tab") {
    kind = row.kind === "terminal" ? "Terminal" : row.depth ? "Sub-agent" : "Agent";
    title = row.title;
    lines = [
      row.kind === "chat" ? line("Status", MARK_LABEL[row.mark]) : null,
      row.modelShort ? line("Model", row.modelShort, true) : null,
      parentTitle ? line("Parent", parentTitle) : null,
      line("Workspace", row.workspaceTitle),
    ];
  } else {
    const counts = [row.tally.asking ? `${row.tally.asking} ask you` : "", row.tally.error ? `${row.tally.error} failed` : "", row.tally.unread ? `${row.tally.unread} unread` : ""].filter(Boolean);
    kind = "Project";
    title = row.name;
    lines = [
      row.rootPath ? line("Folder", row.rootPath, true) : null,
      line("Type", KIND_LABEL[row.kind]),
      line("Workspaces", `${row.count}${counts.length ? ` · ${counts.join(", ")}` : ""}`),
    ];
  }
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: fs(10.5), fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>{kind}</Text>
      <Text style={{ color: c.foreground, fontSize: fs(14.5), fontWeight: "600", marginBottom: 4 }}>{title}</Text>
      {lines}
    </View>
  );
}

/** The hover card, below the row or above it when there is no room underneath. */
export function NamesCard({ theme, peek, scale, now, areaHeight }: { theme: PluginTheme; peek: Peek; scale: number; now: number; areaHeight: number }) {
  const { row } = peek;
  if (!hasInfo(row)) return null;
  const c = theme.colors;
  const above = areaHeight > 0 && peek.top + CARD_HEIGHT_GUESS > areaHeight && peek.rowTop > CARD_HEIGHT_GUESS;
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Details"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        ...(above ? { bottom: Math.max(4, areaHeight - peek.rowTop + 4) } : { top: Math.max(4, peek.top + 4) }),
        zIndex: 50,
        elevation: 12,
        padding: 12,
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
      <InfoCard theme={theme} row={row} scale={scale} now={now} />
    </View>
  );
}
