// The ⋯ menu of a workspace row: mark read/unread, and archive after a confirmation that warns
// when an agent is still working or waiting for you.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { WorkspaceRow } from "../shared/tree";
import { useNavigatorStore } from "./runtime";

export function WorkspaceMenu({ theme, row, onClose }: { theme: PluginTheme; row: WorkspaceRow; onClose(): void }) {
  const { store } = useNavigatorStore();
  const c = theme.colors;
  const [confirm, setConfirm] = useState(false);
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

  return (
    <Modal title={workspace.title} open onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Content>
        {confirm ? (
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
