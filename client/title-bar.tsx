// The navigator's top: the Inbox, host button, search (phones), New project, Options, the views control and the search field.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useRef, type ReactNode, type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
import type { InboxTally } from "../shared/inbox";
import { FILTERS, type Filter } from "../shared/types";
import { TallyMarks } from "./marks";
import { measureAnchor, type Anchor } from "./sheet";
import { useOwnField } from "./chat-nav";

export const VIEW_LABEL: Record<Filter, string> = { all: "All", recent: "Recent", active: "Active", pinned: "Pinned" };
const VIEW_HINT: Record<Filter, string> = {
  all: "Everything, read workspaces included",
  recent: "Active lately, plus anything ongoing",
  active: "Running, unread or asking you",
  pinned: "Workspaces you pinned",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function TitleBar({
  theme,
  compact,
  inbox,
  scale,
  onInbox,
  onOptions,
  inboxRef,
  host,
  onNewProject,
  onSearch,
}: {
  theme: PluginTheme;
  /** The Inbox button, so focus can return to it when the Inbox closes. */
  inboxRef: RefObject<View | null>;
  compact: boolean;
  inbox: InboxTally;
  scale: number;
  onInbox(anchor: Anchor | null): void;
  onOptions(anchor: Anchor | null): void;
  /** The host button (menu mode with several hosts). */
  host?: ReactNode;
  /** Set while an online host can take a project. */
  onNewProject?(anchor: Anchor | null): void;
  /** Phones: the search icon opens the search field under the title bar. */
  onSearch?(): void;
}) {
  const c = theme.colors;
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const optionsRef = useRef<View>(null);
  const newProjectRef = useRef<View>(null);
  // Same height as the host tabs and the views control below it; taps reach a little past the edges.
  const size = compact ? 36 : 32;
  const slop = { top: 4, bottom: 4 };
  const label = [
    `Inbox, ${plural(inbox.total, "chat", "chats")}`,
    inbox.asking ? `${inbox.asking} ask${inbox.asking === 1 ? "s" : ""} you` : "",
    inbox.error ? `${inbox.error} failed` : "",
    inbox.unread ? `${inbox.unread} unread` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4 }}>
      <Text accessibilityRole="header" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}>Workspaces</Text>
      <Pressable
        ref={inboxRef}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the list`}
        onPress={() => measureAnchor(inboxRef.current, onInbox)}
        hitSlop={slop}
        style={({ pressed }) => ({ minHeight: size, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: pressed ? c.surface1 : "transparent" })}
      >
        <Icon name="Inbox" size={16} color={c.foreground} />
        <Text style={{ color: c.foreground, fontSize: fs(13.5), fontWeight: "600" }}>Inbox</Text>
        {/* The same glyph-and-number marks as folded groups: asks you, failed, unread, each in its colour. */}
        {inbox.total ? (
          <View style={{ marginLeft: 4 }}>
            <TallyMarks theme={theme} tally={inbox} size={12} />
          </View>
        ) : (
          <Text style={{ color: c.foregroundMuted, fontSize: fs(12.5) }}>0</Text>
        )}
      </Pressable>
      <View style={{ flex: 1 }} />
      {host}
      {onSearch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={onSearch}
          hitSlop={slop}
          style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          <Icon name="Search" size={16} color={c.foreground} />
        </Pressable>
      ) : null}
      {onNewProject ? (
        <Pressable
          ref={newProjectRef}
          accessibilityRole="button"
          accessibilityLabel="New project"
          onPress={() => measureAnchor(newProjectRef.current, onNewProject)}
          hitSlop={slop}
          style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          <Icon name="FolderPlus" size={16} color={c.foreground} />
        </Pressable>
      ) : null}
      <Pressable
        ref={optionsRef}
        accessibilityRole="button"
        accessibilityLabel="Options"
        onPress={() => measureAnchor(optionsRef.current, onOptions)}
        hitSlop={slop}
        style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: pressed ? c.surface1 : "transparent" })}
      >
        <Icon name="SlidersHorizontal" size={16} color={c.foreground} />
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

/** `onClose` (phones): the field was opened from the search icon; it takes focus and its X closes it. */
export function SearchField({ theme, query, onChange, onClose }: { theme: PluginTheme; query: string; onChange(next: string): void; onClose?(): void }) {
  const c = theme.colors;
  const field = useOwnField();
  return (
    <View style={{ height: 38, flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 8, paddingLeft: 10, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
      <Icon name="Search" size={14} color={c.foregroundMuted} />
      <TextInput
        {...field}
        value={query}
        autoFocus={!!onClose}
        onChangeText={onChange}
        accessibilityLabel="Search workspaces, chats and projects"
        placeholder="Search workspaces, chats, projects"
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 0 }}
      />
      {query || onClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel={onClose ? "Close search" : "Clear search"} onPress={onClose ?? (() => onChange(""))} hitSlop={3} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}>
          <Icon name="X" size={16} color={c.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
