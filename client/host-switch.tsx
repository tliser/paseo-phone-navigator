// Picking the hosts the tree shows: tabs above the tree, or a host button that opens a list. Only shown
// with more than one host. "All" draws every host with a thin divider row each. The profile picks "one"
// (a host shows only that host) or "several" (a host is added or removed; none left is All).
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { colorHex, hostColorKey } from "../shared/colors";
import type { HostSummary } from "../shared/tree";
import { TallyMarks } from "./marks";
import { measureAnchor, Sheet, SheetItem, type Anchor } from "./sheet";

const allTally = (hosts: readonly HostSummary[]) =>
  hosts.reduce((sum, host) => ({ asking: sum.asking + host.tally.asking, error: sum.error + host.tally.error, unread: sum.unread + host.tally.unread }), { asking: 0, error: 0, unread: 0 });

export type HostPick = "one" | "several";

/** The hosts shown after picking `serverId`. */
function picked(mode: HostPick, value: readonly string[], serverId: string): string[] {
  if (mode === "one") return [serverId];
  return value.includes(serverId) ? value.filter((id) => id !== serverId) : [...value, serverId];
}

/** Tabs: All, then each host with its icon colour and what waits there. Hold a host tab to colour its icon. */
export function HostTabs({
  theme,
  hosts,
  value,
  mode,
  compact,
  colors,
  onChange,
  onPickColor,
}: {
  theme: PluginTheme;
  hosts: readonly HostSummary[];
  value: readonly string[];
  mode: HostPick;
  compact: boolean;
  colors: Readonly<Record<string, string>>;
  onChange(serverIds: string[]): void;
  onPickColor(host: HostSummary): void;
}) {
  const c = theme.colors;
  const tab = (key: string, selected: boolean, label: string, a11y: string, onPress: () => void, extra: { icon?: { color: string; dim: boolean }; tally: HostSummary["tally"]; onLongPress?: () => void }) => (
    <Pressable
      key={key}
      accessibilityRole={mode === "several" && key !== "all" ? "checkbox" : "tab"}
      accessibilityState={mode === "several" && key !== "all" ? { checked: selected } : { selected }}
      accessibilityLabel={a11y}
      onPress={onPress}
      onLongPress={extra.onLongPress}
      delayLongPress={400}
      style={{ minHeight: compact ? 36 : 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: selected ? c.surface2 : "transparent", borderWidth: 1, borderColor: selected ? c.border : "transparent" }}
    >
      {extra.icon ? <View style={{ opacity: extra.icon.dim ? 0.45 : 1 }}><Icon name="Server" size={13} color={extra.icon.color} /></View> : null}
      <Text numberOfLines={1} style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 12.5, fontWeight: "600" }}>{label}</Text>
      <TallyMarks theme={theme} tally={extra.tally} size={11} />
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="Hosts" contentContainerStyle={{ gap: 4, paddingHorizontal: 8 }}>
      {tab("all", !value.length, "All", "All hosts", () => onChange([]), { tally: allTally(hosts) })}
      {hosts.map((host) =>
        tab(host.serverId, value.includes(host.serverId), host.label, `${host.label}${host.state === "offline" ? ", offline" : host.state === "loading" ? ", loading" : `, ${host.count} workspaces`}`, () => onChange(picked(mode, value, host.serverId)), {
          icon: { color: colorHex(colors[hostColorKey(host.serverId)], c.foregroundMuted), dim: host.state !== "online" },
          tally: host.tally,
          onLongPress: () => onPickColor(host),
        }),
      )}
    </ScrollView>
  );
}

/** Title bar button for the menu mode: the host shown (or "All hosts", or how many); opens the list. */
export function HostButton({ theme, hosts, value, compact, colors, onOpen }: { theme: PluginTheme; hosts: readonly HostSummary[]; value: readonly string[]; compact: boolean; colors: Readonly<Record<string, string>>; onOpen(anchor: Anchor | null): void }) {
  const c = theme.colors;
  const ref = useRef<View>(null);
  const host = value.length === 1 ? hosts.find((entry) => entry.serverId === value[0]) : undefined;
  const label = host ? host.label : value.length ? `${value.length} hosts` : "All hosts";
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`Hosts: ${host ? host.label : value.length ? hosts.filter((entry) => value.includes(entry.serverId)).map((entry) => entry.label).join(", ") : "all hosts"}. Choose`}
      onPress={() => measureAnchor(ref.current, onOpen)}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ minHeight: compact ? 36 : 32, maxWidth: 160, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: pressed ? c.surface1 : "transparent" })}
    >
      <Icon name="Server" size={15} color={host ? colorHex(colors[hostColorKey(host.serverId)], c.foregroundMuted) : c.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Icon name="ChevronDown" size={12} color={c.foregroundMuted} />
    </Pressable>
  );
}

/** The list behind the host button. With "several" a host row adds or removes it and the list stays open. */
export function HostMenu({
  theme,
  hosts,
  value,
  mode,
  compact,
  anchor,
  colors,
  onChange,
  onPickColor,
  onClose,
}: {
  theme: PluginTheme;
  hosts: readonly HostSummary[];
  value: readonly string[];
  mode: HostPick;
  compact: boolean;
  anchor: Anchor | null;
  colors: Readonly<Record<string, string>>;
  onChange(serverIds: string[]): void;
  onPickColor(host: HostSummary): void;
  onClose(): void;
}) {
  const c = theme.colors;
  const pick = (next: string[]) => {
    if (mode === "one" || !next.length) onClose();
    onChange(next);
  };
  const check = <Icon name="Check" size={16} color={c.accent} />;
  return (
    <Sheet theme={theme} title="Hosts" compact={compact} anchor={anchor} width={280} onClose={onClose}>
      <SheetItem theme={theme} compact={compact} icon="Layers" label="All hosts" onPress={() => pick([])} trailing={!value.length ? check : <TallyMarks theme={theme} tally={allTally(hosts)} />} />
      {hosts.map((host) => (
        <SheetItem
          key={host.serverId}
          theme={theme}
          compact={compact}
          icon="Server"
          label={`${host.label}${host.state === "offline" ? " · offline" : ""}`}
          onPress={() => pick(picked(mode, value, host.serverId))}
          trailing={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TallyMarks theme={theme} tally={host.tally} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Host colour of ${host.label}`}
                onPress={() => {
                  onClose();
                  onPickColor(host);
                }}
                hitSlop={8}
              >
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colorHex(colors[hostColorKey(host.serverId)], c.foregroundMuted) }} />
              </Pressable>
              {value.includes(host.serverId) ? check : null}
            </View>
          }
        />
      ))}
    </Sheet>
  );
}
