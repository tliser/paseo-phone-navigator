// The ⋯ menu of a workspace row: rename, pin, mark read/unread, and archive after a confirmation
// that warns when an agent is still working or waiting for you.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { WorkspaceRow } from "../shared/tree";
import { useNavigatorStore } from "./runtime";

export function WorkspaceMenu({ theme, row, profileId, onClose }: { theme: PluginTheme; row: WorkspaceRow; profileId: string; onClose(): void }) {
  const { store, snapshot } = useNavigatorStore();
  const c = theme.colors;
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(row.workspace.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { workspace } = row;
  const item = { minHeight: 52, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 4 };
  const warning =
    row.state === "needs_you"
      ? "An agent in this workspace is waiting for your answer. Archiving stops it."
      : workspace.status === "running"
        ? "An agent in this workspace is still working. Archiving stops it."
        : null;

  const archive = () => {
    setBusy(true);
    setError(null);
    store
      .archiveWorkspace(row.serverId, workspace.id)
      .then(onClose)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  const pinned = snapshot.pinsFor(profileId).has(`${row.serverId}:${workspace.id}`);
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

  return (
    <Modal title={workspace.title} open onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Content>
        {renaming ? (
          <>
            <View style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, paddingHorizontal: 12, justifyContent: "center" }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={rename}
                placeholder="Workspace name"
                placeholderTextColor={c.foregroundMuted}
                style={{ color: c.foreground, fontSize: 16, paddingVertical: 10 }}
              />
            </View>
            {error ? <Text style={{ color: c.statusDanger }}>{`Could not rename: ${error}`}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setRenaming(false)} style={{ ...button, backgroundColor: c.surface2 }}>
                <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!canSave} onPress={rename} style={{ ...button, backgroundColor: c.accent, opacity: canSave ? 1 : 0.5 }}>
                <Text style={{ color: c.accentForeground, fontWeight: "600" }}>{busy ? "Saving…" : "Rename"}</Text>
              </Pressable>
            </View>
          </>
        ) : confirm ? (
          <>
            <Text style={{ color: c.foreground, fontSize: 16 }}>{`Archive "${workspace.title}"?`}</Text>
            {warning ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Icon name="TriangleAlert" size={18} color={c.statusWarning} />
                <Text style={{ flex: 1, color: c.statusWarning }}>{warning}</Text>
              </View>
            ) : null}
            <Text style={{ color: c.foregroundMuted }}>It disappears from the list. Paseo keeps archived workspaces in its history.</Text>
            {error ? <Text style={{ color: c.statusDanger }}>{`Could not archive: ${error}`}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirm(false)} style={{ flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
                <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={archive} style={{ flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.statusDanger, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: "#ffffff", fontWeight: "600" }}>{busy ? "Archiving…" : "Archive"}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => setRenaming(true)} style={item}>
              <Icon name="Pencil" size={18} color={c.foregroundMuted} />
              <Text style={{ flex: 1, color: c.foreground, fontSize: 16 }}>Rename</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Pinned workspaces lead their project in the All view on this device"
              onPress={() => {
                store.setPinned(profileId, row.serverId, workspace.id, !pinned);
                onClose();
              }}
              style={item}
            >
              <Icon name={pinned ? "PinOff" : "Pin"} size={18} color={c.foregroundMuted} />
              <Text style={{ flex: 1, color: c.foreground, fontSize: 16 }}>{pinned ? "Unpin" : "Pin to top"}</Text>
            </Pressable>
            {row.state === "unread" || row.state === "read" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (row.state === "unread") store.markRead(row.serverId, [workspace.id]);
                  else store.markUnread(row.serverId, workspace.id);
                  onClose();
                }}
                style={item}
              >
                <Icon name={row.state === "unread" ? "MailOpen" : "Mail"} size={18} color={c.foregroundMuted} />
                <Text style={{ flex: 1, color: c.foreground, fontSize: 16 }}>{row.state === "unread" ? "Mark as read" : "Mark as unread"}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setConfirm(true)} style={item}>
              <Icon name="Archive" size={18} color={c.statusDanger} />
              <Text style={{ flex: 1, color: c.statusDanger, fontSize: 16 }}>Archive workspace</Text>
            </Pressable>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}
