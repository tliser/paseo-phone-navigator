// New project: Paseo adds an existing folder on a host as a project and opens a workspace on it. With
// several online hosts the sheet asks which one. Plugins cannot create folders, so the folder must exist.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MONO_FONT } from "./font-scale";
import { useNavigatorStore } from "./runtime";
import { Sheet, type Anchor } from "./sheet";
import { useOwnField } from "./chat-nav";

export function NewProjectSheet({
  theme,
  compact,
  hosts,
  anchor,
  onAdded,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** Online hosts it can go to; the first is preselected. */
  hosts: readonly { serverId: string; label: string }[];
  anchor: Anchor | null;
  onAdded(serverId: string, workspaceId: string): void;
  onClose(): void;
}) {
  const { store } = useNavigatorStore();
  const c = theme.colors;
  const [serverId, setServerId] = useState(hosts[0]!.serverId);
  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? "";
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathField = useOwnField();
  const canAdd = !busy && path.trim().length > 0;
  const add = () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    store
      .addProject(serverId, path)
      .then((workspaceId) => onAdded(serverId, workspaceId))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };
  const button = { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const };

  return (
    <Sheet theme={theme} title={hosts.length > 1 ? "New project" : `New project on ${hostLabel}`} compact={compact} anchor={anchor} width={340} onClose={() => !busy && onClose()}>
      <View style={{ gap: 8, padding: 8 }}>
        {hosts.length > 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Host" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {hosts.map((host) => {
              const selected = host.serverId === serverId;
              return (
                <Pressable
                  key={host.serverId}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  disabled={busy}
                  onPress={() => setServerId(host.serverId)}
                  style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: selected ? c.foreground : c.border, backgroundColor: selected ? c.surface2 : "transparent" }}
                >
                  <Icon name="Server" size={13} color={c.foregroundMuted} />
                  <Text style={{ color: c.foreground, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{host.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0, paddingHorizontal: 12, justifyContent: "center" }}>
          <TextInput
            {...pathField}
            value={path}
            onChangeText={setPath}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={add}
            accessibilityLabel="Project folder"
            placeholder="~/dev/my-project"
            placeholderTextColor={c.foregroundMuted}
            style={{ color: c.foreground, fontSize: 16, paddingVertical: 10, fontFamily: MONO_FONT }}
          />
        </View>
        <Text style={{ color: c.foregroundMuted }}>{`An existing folder on ${hostLabel}. Paseo adds it as a project and opens a workspace on it.`}</Text>
        {error ? <Text style={{ color: c.statusDanger }}>{`Could not add: ${error}`}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{ ...button, backgroundColor: c.surface2 }}>
            <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!canAdd} onPress={add} style={{ ...button, backgroundColor: c.accent, opacity: canAdd ? 1 : 0.5 }}>
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>{busy ? "Adding…" : "Add project"}</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}
