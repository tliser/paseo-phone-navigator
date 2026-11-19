// The Inbox: every chat that asks you, failed or is unread, on every host. An entry opens that chat.
import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { timeAgo } from "../shared/format";
import type { Inbox, InboxEntry } from "../shared/inbox";
import { Mark, MARK_LABEL, markColor } from "./marks";
import { Sheet, SheetDivider, SheetItem, SheetNote, type Anchor } from "./sheet";

const ENTRY_HEIGHT = 52;

/** Offline and loading hosts, named so a short Inbox is never mistaken for an empty one. */
function hostsNote(inbox: Inbox): string | null {
  const parts: string[] = [];
  const say = (labels: string[], what: string) => {
    if (!labels.length) return;
    const one = labels.length === 1;
    parts.push(`${labels.join(", ")} ${one ? "is" : "are"} ${what}, so ${one ? "its" : "their"} chats are not checked${what === "loading" ? " yet" : ""}.`);
  };
  say(inbox.offlineHosts, "offline");
  say(inbox.loadingHosts, "loading");
  return parts.length ? parts.join(" ") : null;
}

export function InboxSheet({
  theme,
  compact,
  anchor,
  inbox,
  now,
  onOpen,
  onMarkUnreadRead,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  anchor: Anchor | null;
  inbox: Inbox;
  now: number;
  onOpen(entry: InboxEntry): void;
  onMarkUnreadRead(): void;
  onClose(): void;
}) {
  const c = theme.colors;
  const { entries } = inbox;
  const unread = entries.filter((entry) => entry.state === "unread").length;
  const note = hostsNote(inbox);
  const renderItem = ({ item }: { item: InboxEntry }) => {
    const ago = timeAgo(item.at, now);
    const where = `${item.hostLabel} / ${item.projectName}`;
    const tint = item.state === "unread" ? "transparent" : `${markColor(theme, item.state)}14`;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.chatTitle} in ${item.workspaceTitle}. ${MARK_LABEL[item.state]}, ${where}${ago ? `, ${ago} ago` : ""}. Opens the chat`}
        onPress={() => onOpen(item)}
        style={({ pressed }) => ({ height: ENTRY_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pressed ? c.surface2 : tint })}
      >
        <Mark theme={theme} kind={item.state} size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 14 }}>
            <Text style={{ fontWeight: "700" }}>{item.chatTitle}</Text>
            {` · ${item.workspaceTitle}`}
          </Text>
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {[MARK_LABEL[item.state], where, ago].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </Pressable>
    );
  };
  return (
    <Sheet theme={theme} title="Inbox" compact={compact} anchor={anchor} width={380} onClose={onClose}>
      <SheetNote theme={theme}>{entries.length ? `${entries.length} ${entries.length === 1 ? "chat" : "chats"} · questions and errors first` : "All caught up. Nothing waits for you."}</SheetNote>
      {entries.length ? (
        <FlatList
          data={entries}
          keyExtractor={(entry) => `${entry.serverId}:${entry.agentId}`}
          renderItem={renderItem}
          getItemLayout={(_data, index) => ({ index, offset: index * ENTRY_HEIGHT, length: ENTRY_HEIGHT })}
          style={{ flexGrow: 0, flexShrink: 1 }}
        />
      ) : null}
      {note ? <SheetNote theme={theme}>{note}</SheetNote> : null}
      {unread ? (
        <>
          <SheetDivider theme={theme} />
          <SheetItem theme={theme} compact={compact} icon="CheckCheck" label={`Mark ${unread} unread as read`} onPress={onMarkUnreadRead} />
        </>
      ) : null}
    </Sheet>
  );
}
