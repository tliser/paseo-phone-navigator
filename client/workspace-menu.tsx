// Action sheet of a workspace row, or of one of its tabs (held on phones, ⋯ on desktop). The header is
// the row's info card; labels name their target. Archive asks first and warns when an agent still works
// or waits for you.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { removedFromRecent, type ReadMap } from "../shared/reads";
import type { TabRow, WorkspaceRow } from "../shared/tree";
import { InfoCard } from "./names-card";
import { useNavigatorStore } from "./runtime";
import { Sheet, SheetDivider, SheetItem, type Anchor } from "./sheet";
import type { Store } from "./store";
import type { ToastMessage } from "./toast";
import { useOwnField } from "./chat-nav";

export interface MenuTarget {
  row: WorkspaceRow;
  /** Set when a tab row was held: its actions come first. */
  tab?: TabRow;
  anchor: Anchor | null;
}

/** Reads are per chat; a workspace without chats keeps its own mark. */
export function canMarkWorkspaceRead(row: WorkspaceRow): boolean {
  return (row.workspace.agents ?? []).length ? row.unreadChats.length > 0 : row.state === "unread";
}

/** Mark read for a whole workspace (menu and swipe left), with Undo. */
export function markWorkspaceRead(store: Store, row: WorkspaceRow, onToast: (message: ToastMessage) => void): void {
  const { workspace } = row;
  if (!(workspace.agents ?? []).length) {
    store.markRead(row.serverId, [workspace.id]);
    onToast({ text: `Marked "${workspace.title}" read`, undo: () => store.markUnread(row.serverId, workspace.id) });
    return;
  }
  const ids = row.unreadChats;
  const changes = store.markChatsRead(row.serverId, ids);
  onToast({ text: `Marked ${ids.length} ${ids.length === 1 ? "chat" : "chats"} in "${workspace.title}" read`, undo: () => store.undoReads(changes) });
}

/** Remove from Recent or put back (menu and swipe right), with Undo. */
export function toggleRecent(store: Store, reads: ReadMap, row: WorkspaceRow, onToast: (message: ToastMessage) => void): void {
  const { workspace } = row;
  const offRecent = removedFromRecent(reads, row.serverId, workspace);
  const changes = store.setInRecent(row.serverId, workspace.id, offRecent);
  onToast({ text: offRecent ? `"${workspace.title}" is back in Recent` : `Removed "${workspace.title}" from Recent`, undo: () => store.undoReads(changes) });
}

export function WorkspaceMenu({
  theme,
  compact,
  scale,
  now,
  target,
  profileId,
  manual,
  siblings,
  onMove,
  onArchive,
  onToast,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  scale: number;
  now: number;
  target: MenuTarget;
  profileId: string;
  manual: boolean;
  /** Workspace ids of its project in their current order (manual order only). */
  siblings: readonly string[];
  onMove(direction: -1 | 1): void;
  onArchive(): void;
  onToast(message: ToastMessage): void;
  onClose(): void;
}) {
  const { store, snapshot } = useNavigatorStore();
  const c = theme.colors;
  const { row, tab } = target;
  const { workspace } = row;
  const [mode, setMode] = useState<"menu" | "rename" | "archive">("menu");
  const [title, setTitle] = useState(workspace.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleField = useOwnField();
  const pinned = snapshot.pinsFor(profileId).has(`${row.serverId}:${workspace.id}`);
  const offRecent = removedFromRecent(snapshot.reads, row.serverId, workspace);
  const index = siblings.indexOf(workspace.id);
  const then = (action: () => void) => () => {
    onClose();
    action();
  };

  const canMarkRead = canMarkWorkspaceRead(row);
  const tabAction = tab && tab.kind === "chat" && (tab.mark === "unread" || tab.mark === "read") ? tab : null;
  const toggleTab = () => {
    if (!tabAction) return;
    if (tabAction.mark === "unread") {
      const changes = store.markChatsRead(row.serverId, [tabAction.id]);
      onToast({ text: `Marked "${tabAction.title}" read`, undo: () => store.undoReads(changes) });
    } else {
      const changes = store.markChatUnread(row.serverId, tabAction.id);
      onToast({ text: `Marked "${tabAction.title}" unread`, undo: () => store.undoReads(changes) });
    }
  };

  const canSave = !busy && title.trim().length > 0 && title.trim() !== workspace.title;
  const rename = () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    store
      .renameWorkspace(row.serverId, workspace.id, title)
      .then(onClose)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };
  const button = { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const };
  const warning =
    row.state === "needs_you"
      ? "An agent in this workspace is waiting for your answer. Archiving stops it."
      : workspace.status === "running"
        ? "An agent in this workspace is still working. Archiving stops it."
        : null;
  const agents = workspace.agents ?? [];
  const parentId = tab?.depth ? agents.find((agent) => agent.id === tab.id)?.parentId : null;
  const parentTitle = parentId ? agents.find((agent) => agent.id === parentId)?.title : undefined;

  return (
    <Sheet theme={theme} title={tab ? tab.title : workspace.title} compact={compact} anchor={target.anchor} width={320} onClose={() => !busy && onClose()}>
      <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
        <InfoCard theme={theme} row={tab ?? row} scale={scale} now={now} parentTitle={parentTitle} />
      </View>
      <SheetDivider theme={theme} />
      {mode === "rename" ? (
        <View style={{ gap: 8, padding: 8 }}>
          <View style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0, paddingHorizontal: 12, justifyContent: "center" }}>
            <TextInput
              {...titleField}
              value={title}
              onChangeText={setTitle}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={rename}
              accessibilityLabel="Workspace name"
              placeholder="Workspace name"
              placeholderTextColor={c.foregroundMuted}
              style={{ color: c.foreground, fontSize: 16, paddingVertical: 10 }}
            />
          </View>
          {error ? <Text style={{ color: c.statusDanger }}>{`Could not rename: ${error}`}</Text> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setMode("menu")} style={{ ...button, backgroundColor: c.surface2 }}>
              <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!canSave} onPress={rename} style={{ ...button, backgroundColor: c.accent, opacity: canSave ? 1 : 0.5 }}>
              <Text style={{ color: c.accentForeground, fontWeight: "600" }}>{busy ? "Saving…" : "Rename"}</Text>
            </Pressable>
          </View>
        </View>
      ) : mode === "archive" ? (
        <View style={{ gap: 10, padding: 8 }}>
          <Text style={{ color: c.foreground, fontSize: 15 }}>{`Archive "${workspace.title}"?`}</Text>
          {warning ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Icon name="TriangleAlert" size={18} color={c.statusWarning} />
              <Text style={{ flex: 1, color: c.statusWarning }}>{warning}</Text>
            </View>
          ) : null}
          <Text style={{ color: c.foregroundMuted }}>It disappears from the list. Paseo keeps archived workspaces in its history.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => setMode("menu")} style={{ ...button, backgroundColor: c.surface2 }}>
              <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={then(onArchive)} style={{ ...button, backgroundColor: c.statusDanger }}>
              <Text style={{ color: c.accentForeground, fontWeight: "600" }}>Archive</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {tabAction ? (
            <>
              <SheetItem
                theme={theme}
                compact={compact}
                icon={tabAction.mark === "unread" ? "Check" : "Undo2"}
                label={tabAction.mark === "unread" ? `Mark "${tabAction.title}" read` : `Mark "${tabAction.title}" unread`}
                onPress={then(toggleTab)}
              />
              <SheetDivider theme={theme} />
            </>
          ) : null}
          <SheetItem theme={theme} compact={compact} icon={pinned ? "PinOff" : "Pin"} label={pinned ? "Unpin workspace" : "Pin workspace"} onPress={then(() => store.setPinned(profileId, row.serverId, workspace.id, !pinned))} />
          {canMarkRead ? <SheetItem theme={theme} compact={compact} icon="CheckCheck" label="Mark workspace read" onPress={then(() => markWorkspaceRead(store, row, onToast))} /> : null}
          <SheetItem theme={theme} compact={compact} icon={offRecent ? "History" : "EyeOff"} label={offRecent ? "Show in Recent again" : "Remove from Recent"} onPress={then(() => toggleRecent(store, snapshot.reads, row, onToast))} />
          <SheetItem theme={theme} compact={compact} icon="Pencil" label="Rename workspace" onPress={() => setMode("rename")} />
          {manual && index !== -1 ? (
            <>
              <SheetItem theme={theme} compact={compact} icon="ArrowUp" label="Move up" disabled={index === 0} onPress={then(() => onMove(-1))} />
              <SheetItem theme={theme} compact={compact} icon="ArrowDown" label="Move down" disabled={index === siblings.length - 1} onPress={then(() => onMove(1))} />
            </>
          ) : null}
          <SheetDivider theme={theme} />
          <SheetItem theme={theme} compact={compact} icon="Archive" label="Archive workspace…" danger onPress={() => setMode("archive")} />
        </>
      )}
    </Sheet>
  );
}

