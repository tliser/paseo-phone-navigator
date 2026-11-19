// The navigator's top: Inbox and Running indicators, Options, the views control, and the search field.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useRef, useState, type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
import type { InboxTally } from "../shared/inbox";
import { FILTERS, type Filter } from "../shared/types";
import { Mark } from "./marks";
import { measureAnchor, type Anchor } from "./sheet";

export const VIEW_LABEL: Record<Filter, string> = { all: "All", recent: "Recent", active: "Active", pinned: "Pinned" };
const VIEW_HINT: Record<Filter, string> = {
  all: "Everything, read workspaces included",
  recent: "Active lately, plus anything ongoing",
  active: "Running, unread or asking you",
  pinned: "Workspaces you pinned",
};

/** Below this width the Inbox indicator drops the words and keeps glyphs and numbers. */
const NARROW_WIDTH = 310;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function TitleBar({
  theme,
  compact,
  inbox,
  running,
  scale,
  onInbox,
  onRunning,
  onOptions,
  inboxRef,
}: {
  theme: PluginTheme;
  /** The Inbox button, so focus can return to it when the Inbox closes. */
  inboxRef: RefObject<View | null>;
  compact: boolean;
  inbox: InboxTally;
  running: number;
  scale: number;
  onInbox(anchor: Anchor | null): void;
  onRunning(): void;
  onOptions(anchor: Anchor | null): void;
}) {
  const c = theme.colors;
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < NARROW_WIDTH;
  const optionsRef = useRef<View>(null);
  const size = compact ? 44 : 40;
  const label = [`Inbox, ${plural(inbox.total, "chat", "chats")}`, inbox.asking ? `${inbox.asking} ask${inbox.asking === 1 ? "s" : ""} you` : "", inbox.error ? `${inbox.error} failed` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4 }}>
      <Text accessibilityRole="header" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}>Workspaces</Text>
      <Pressable
        ref={inboxRef}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the list`}
        onPress={() => measureAnchor(inboxRef.current, onInbox)}
        style={({ pressed }) => ({ minHeight: size, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? c.surface1 : "transparent" })}
      >
        <Icon name="Inbox" size={18} color={c.foreground} />
        <Text style={{ color: c.foreground, fontSize: fs(15), fontWeight: "700" }}>Inbox</Text>
        <Text style={{ color: c.foreground, fontSize: fs(13), fontWeight: "600", fontVariant: ["tabular-nums"] }}>{inbox.total}</Text>
        {inbox.asking ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 4 }}>
            <Mark theme={theme} kind="asking" size={14} />
            <Text numberOfLines={1} style={{ color: c.statusWarning, fontSize: fs(12.5), fontWeight: "600" }}>{narrow ? inbox.asking : `${inbox.asking} ask${inbox.asking === 1 ? "s" : ""} you`}</Text>
          </View>
        ) : null}
        {inbox.error ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 4 }}>
            <Mark theme={theme} kind="error" size={14} />
            <Text numberOfLines={1} style={{ color: c.statusDanger, fontSize: fs(12.5), fontWeight: "600" }}>{narrow ? inbox.error : `${inbox.error} failed`}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={{ flex: 1 }} />
      {running ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${running} running. Show Active`}
          onPress={onRunning}
          style={({ pressed }) => ({ minWidth: size, height: size, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          <Mark theme={theme} kind="running" size={16} />
          <Text style={{ color: c.foreground, fontSize: fs(13), fontWeight: "600", fontVariant: ["tabular-nums"] }}>{running}</Text>
        </Pressable>
      ) : null}
      <Pressable
        ref={optionsRef}
        accessibilityRole="button"
        accessibilityLabel="Options"
        onPress={() => measureAnchor(optionsRef.current, onOptions)}
        style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: pressed ? c.surface1 : "transparent" })}
      >
        <Icon name="SlidersHorizontal" size={18} color={c.foreground} />
      </Pressable>
    </View>
  );
}

/** Segmented control: All · Recent · Active · Pinned, each with its count. */
export function ViewsControl({ theme, value, counts, compact, onChange }: { theme: PluginTheme; value: Filter; counts: Record<Filter, number>; compact: boolean; onChange(next: Filter): void }) {
  const c = theme.colors;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Show" style={{ flexDirection: "row", marginHorizontal: 8, padding: 3, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
      {FILTERS.map((key) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={`${VIEW_LABEL[key]}, ${counts[key]}`}
            accessibilityHint={VIEW_HINT[key]}
            onPress={() => onChange(key)}
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
            style={{ flex: 1, minHeight: compact ? 34 : 30, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 7, backgroundColor: selected ? c.surface2 : "transparent" }}
          >
            <Text numberOfLines={1} style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 12.5, fontWeight: "600" }}>{VIEW_LABEL[key]}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>{counts[key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchField({ theme, query, onChange }: { theme: PluginTheme; query: string; onChange(next: string): void }) {
  const c = theme.colors;
  return (
    <View style={{ height: 38, flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 8, paddingLeft: 10, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
      <Icon name="Search" size={14} color={c.foregroundMuted} />
      <TextInput
        value={query}
        onChangeText={onChange}
        accessibilityLabel="Search workspaces, chats and projects"
        placeholder="Search workspaces, chats, projects"
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 0 }}
      />
      {query ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange("")} hitSlop={3} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}>
          <Icon name="X" size={16} color={c.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
