// Pills under every chat's message field, for the chats of the host serving this copy of the plugin:
// - "Inbox" with what waits for you on every host; it opens the Inbox (answer from there, open a chat) with
//   back and forward through the chats you visited.
// - "Mark read" on an unread chat, "Mark unread" on a read one: either marks the chat and opens the next chat
//   in the Inbox, so you can work through it without going back to the tree.
// Pills are registered per chat, so this follows the host's chat list and adds or removes them.
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { buildInbox, inboxTally, type Inbox, type InboxTally } from "../shared/inbox";
import { chatState } from "../shared/tree";
import type { ChatState } from "../shared/types";
import { chatKey, currentChat, historyStep, reportShownChat, splitChatKey, travelTo, useHistorySteps, type ShownChat } from "./chat-nav";
import { unreadColor } from "./colors";
import { createHostObserver } from "./host-observer";
import { hostsNote, InboxList, inboxSummary } from "./inbox-sheet";
import { getStore, openChat, useInbox, useNavigatorStore } from "./runtime";
import type { StoreSnapshot } from "./store";

const INBOX_TITLE = "Inbox";

/**
 * A chat that is not on screen lays out with no size: on the web another tab has no width; on phones a
 * hidden screen may collapse (best effort: some keep their size).
 */
const shownWhen = ({ width, height }: { width: number; height: number }) => (Platform.OS === "web" ? width > 0 : width > 0 && height > 0);

let cachedInbox: { snapshot: StoreSnapshot; inbox: Inbox; tally: InboxTally } | null = null;

/** The Inbox of a store snapshot, built once for every pill rather than per chat. */
function inboxOf(snapshot: StoreSnapshot): { inbox: Inbox; tally: InboxTally } {
  const cached = cachedInbox;
  if (cached && cached.snapshot.hosts === snapshot.hosts && cached.snapshot.reads === snapshot.reads) return cached;
  const inbox = buildInbox(snapshot.hosts, snapshot.reads, Date.now());
  cachedInbox = { snapshot, inbox, tally: inboxTally(inbox.entries) };
  return cachedInbox;
}

/** The Inbox pill's icon: the Inbox glyph with a dot for what waits, and the report of which chat is on screen. */
function InboxPillIcon({ theme, size, color, host, ...context }: PluginButtonIconProps) {
  const { snapshot } = useNavigatorStore();
  const { tally } = inboxOf(snapshot);
  const agentId = context.context === "agent" ? context.agentId : null;
  const shown = useRef<ShownChat | null>(null);
  useEffect(() => {
    if (!agentId) return;
    const handle = reportShownChat(chatKey(host.id, agentId));
    shown.current = handle;
    return () => {
      handle.remove();
      shown.current = null;
    };
  }, [host.id, agentId]);
  const urgent = tally.asking + tally.error;
  const signal = urgent ? theme.colors.statusWarning : tally.unread ? unreadColor(theme) : null;
  const dot = Math.max(6, Math.round(size * 0.45));
  return (
    <View
      // The web input listener finds the chat of a message field by this marker in its composer.
      testID={agentId ? `wo-chat:${chatKey(host.id, agentId)}` : undefined}
      onLayout={(event) => shown.current?.setVisible(shownWhen(event.nativeEvent.layout))}
      style={{ width: size, height: size }}
    >
      <Icon name="Inbox" size={size} color={color} />
      {/* Urgent: a solid amber dot; unread only: a blue ring. Shape tells them apart, not colour alone. */}
      {signal ? (
        <View style={{ position: "absolute", top: 0, right: 0, width: dot, height: dot, borderRadius: dot / 2, ...(urgent ? { backgroundColor: signal } : { borderWidth: 2, borderColor: signal }) }} />
      ) : null}
    </View>
  );
}

const ReadIcon = ({ size, color }: PluginButtonIconProps) => <Icon name="Check" size={size} color={color} />;
const UnreadIcon = ({ size, color }: PluginButtonIconProps) => <Icon name="CircleDot" size={size} color={color} />;

/** The Inbox pill's popover: back and forward through visited chats, then the Inbox. */
function InboxPopover({ theme, layout, close }: PluginButtonContentProps) {
  const { snapshot } = useNavigatorStore();
  const inbox = useInbox(snapshot);
  const steps = useHistorySteps();
  const c = theme.colors;
  const note = hostsNote(inbox);
  const go = (by: -1 | 1) => {
    const key = historyStep(by);
    if (!key) return;
    close();
    travelTo(key);
    const { serverId, agentId } = splitChatKey(key);
    openChat(serverId, agentId);
  };
  const step = (by: -1 | 1, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={by < 0 ? "Back to the previous chat" : "Forward to the next chat"}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => go(by)}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({ flex: 1, minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, backgroundColor: pressed ? c.surface2 : c.surface1, opacity: enabled ? 1 : 0.4 })}
    >
      {by < 0 ? <Icon name="ArrowLeft" size={15} color={c.foreground} /> : null}
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{by < 0 ? "Back" : "Forward"}</Text>
      {by > 0 ? <Icon name="ArrowRight" size={15} color={c.foreground} /> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: 8, padding: 10, width: layout.compact ? undefined : 400, maxHeight: 560 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {step(-1, steps.back)}
        {step(1, steps.forward)}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{inboxSummary(inbox)}</Text>
      <InboxList
        theme={theme}
        inbox={inbox}
        now={Date.now()}
        compact={layout.compact}
        onOpen={(entry) => {
          close();
          openChat(entry.serverId, entry.agentId);
        }}
      />
      {note ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{note}</Text> : null}
    </View>
  );
}

/** The state of one of this host's chats in the store, or null while unknown. */
function stateOf(serverId: string, agentId: string): ChatState | null {
  const host = getStore().getSnapshot().hosts.find((entry) => entry.serverId === serverId);
  for (const workspace of host?.workspaces ?? []) {
    const agent = workspace.agents?.find((entry) => entry.id === agentId);
    if (agent) return chatState(agent, serverId, workspace.id, getStore().getSnapshot().reads, Date.now());
  }
  return null;
}

/** Opens the first chat in the Inbox other than `except`; nothing when the Inbox has no other chat. */
function openNext(except: string) {
  const next = inboxOf(getStore().getSnapshot()).inbox.entries.find((entry) => chatKey(entry.serverId, entry.agentId) !== except);
  if (next) openChat(next.serverId, next.agentId);
}

export function registerComposerPills(client: PluginClientContext): () => void {
  if (typeof client.addComposerPill !== "function") return () => undefined;
  const pills = new Map<string, { inbox: PluginButtonRegistration; read: PluginButtonRegistration; unread: PluginButtonRegistration; state: ChatState | null }>();
  let inboxLabel = INBOX_TITLE;
  // The host serving this copy: the chats that get its pills. Their states show once it is known.
  let selfId: string | null = null;
  let stopped = false;
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      selfId = self.serverId;
      if (!stopped) refresh();
    })
    .catch(() => undefined);

  const markAndNext = (agentId: string, read: boolean) => {
    const serverId = selfId;
    if (!serverId) return;
    const store = getStore();
    if (read) store.markChatsRead(serverId, [agentId]);
    else store.markChatUnread(serverId, agentId);
    openNext(chatKey(serverId, agentId));
  };

  /** Inbox count on every pill; Mark read on unread chats, Mark unread on read ones (not while asking, failing or running). */
  function refresh() {
    const serverId = selfId;
    if (!serverId) return;
    const total = inboxOf(getStore().getSnapshot()).tally.total;
    const label = total ? `${INBOX_TITLE} ${total}` : INBOX_TITLE;
    const relabel = label !== inboxLabel;
    inboxLabel = label;
    for (const [agentId, entry] of pills) {
      if (relabel) entry.inbox.update({ label });
      const state = stateOf(serverId, agentId);
      if (state === entry.state) continue;
      entry.state = state;
      entry.read.update({ visible: state === "unread" });
      entry.unread.update({ visible: state === "read" });
    }
  }

  const observer = createHostObserver(
    client.paseo,
    (directory) => {
      if (directory.loading) return;
      const live = new Set<string>();
      for (const agent of directory.agents) {
        if (agent.archivedAt || !agent.workspaceId || ("internal" in agent && agent.internal === true) || ("background" in agent && agent.background === true)) continue;
        live.add(agent.id);
        if (pills.has(agent.id)) continue;
        const target = { workspaceId: agent.workspaceId, agentId: agent.id };
        pills.set(agent.id, {
          inbox: client.addComposerPill({
            id: "inbox",
            ...target,
            button: { title: INBOX_TITLE, label: inboxLabel, icon: InboxPillIcon, behavior: { kind: "popover", Content: InboxPopover } },
          }),
          read: client.addComposerPill({
            id: "mark-read",
            ...target,
            button: { title: "Mark read and open the next chat", label: "Mark read", icon: ReadIcon, visible: false, behavior: { kind: "action", onPress: () => markAndNext(agent.id, true) } },
          }),
          unread: client.addComposerPill({
            id: "mark-unread",
            ...target,
            button: { title: "Mark unread and open the next chat", label: "Mark unread", icon: UnreadIcon, visible: false, behavior: { kind: "action", onPress: () => markAndNext(agent.id, false) } },
          }),
          state: null,
        });
      }
      for (const [id, entry] of pills) {
        if (live.has(id)) continue;
        entry.inbox.remove();
        entry.read.remove();
        entry.unread.remove();
        pills.delete(id);
      }
      refresh();
    },
    { agents: true },
  );
  observer.start();
  const unsubscribe = getStore().subscribe(refresh);
  return () => {
    stopped = true;
    unsubscribe();
    observer.stop();
    for (const entry of pills.values()) {
      entry.inbox.remove();
      entry.read.remove();
      entry.unread.remove();
    }
    pills.clear();
  };
}

/** Marks a chat you type in read (default: the chat on screen); used by the input listeners. */
export function markOpenChatRead(key: string | null = currentChat()) {
  if (!key) return;
  const { serverId, agentId } = splitChatKey(key);
  if (stateOf(serverId, agentId) === "unread") getStore().markChatsRead(serverId, [agentId]);
}
