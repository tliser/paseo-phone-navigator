// Pills under every chat's message field, for the chats of the host serving this copy of the plugin:
// - "Inbox" with what waits for you on every host; it opens the Inbox (answer from there, open a chat) with
//   back and forward through the chats you visited.
// - "Mark read" on an unread chat, "Mark unread" on a read one; it stays on the chat.
// - "Catch up": where the chat left off and what comes next, in two short lines. Pressing it writes a new one
//   unless the stored one is still current.
// Pills are registered per chat, so this follows the host's chat list and adds or removes them.
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { CatchUp } from "../shared/catchup";
import { timeAgo } from "../shared/format";
import { buildInbox, inboxTally, type Inbox, type InboxTally } from "../shared/inbox";
import { chatState } from "../shared/tree";
import type { AgentInput, ChatState } from "../shared/types";
import { chatKey, currentChat, historyStep, reportShownChat, splitChatKey, travelTo, useHistorySteps, type ShownChat } from "./chat-nav";
import { unreadColor } from "./colors";
import { createHostObserver } from "./host-observer";
import { hostsNote, InboxList, inboxSummary } from "./inbox-sheet";
import { getStore, openChat, PROFILES_SCREEN_ID, useActiveProfile, useInbox, useNavigatorStore } from "./runtime";
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

const UnreadIcon = ({ size, theme }: PluginButtonIconProps) => <Icon name="Circle" size={size} color={unreadColor(theme)} />;
const ReadIcon = ({ size, color }: PluginButtonIconProps) => <Icon name="CircleCheck" size={size} color={color} />;
const BusyIcon = ({ size, theme }: PluginButtonIconProps) => <Icon name="CircleMinus" size={size} color={theme.colors.foregroundMuted} />;

/**
 * The Read pill for a chat's state. It stays visible and changes through its label and icon: Paseo redraws
 * a pill at once when those change, but shows a pill that becomes visible only on the screen's next redraw,
 * and draws a pill's icon from a cache (a change inside the icon component does not show).
 */
function readButton(state: ChatState | null) {
  if (state === "unread") return { title: "Mark this chat read", label: "Mark read", icon: UnreadIcon, disabled: false };
  if (state === "read") return { title: "Put this chat back in the Inbox", label: "Mark unread", icon: ReadIcon, disabled: false };
  return { title: "Asks you, failed or still working", label: "Mark read", icon: BusyIcon, disabled: true };
}
const CatchUpIcon = ({ size, color }: PluginButtonIconProps) => <Icon name="History" size={size} color={color} />;

/** The Inbox pill's popover: back and forward through visited chats, then the Inbox. */
function InboxPopover({ theme, layout, close }: PluginButtonContentProps) {
  const { snapshot } = useNavigatorStore();
  const inbox = useInbox(snapshot);
  const lines = useActiveProfile(snapshot, layout.platform, layout.compact).settings.inboxLines;
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
  // Paseo's popover surface (max 420 x 440, padded) scrolls itself: no size or scroll area of our own here.
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {step(-1, steps.back)}
        {step(1, steps.forward)}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{inboxSummary(inbox)}</Text>
      <InboxList
        theme={theme}
        inbox={inbox}
        lines={lines}
        now={Date.now()}
        compact={layout.compact}
        hostScrolls
        onOpen={(entry) => {
          close();
          openChat(entry.serverId, entry.agentId);
        }}
      />
      {note ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{note}</Text> : null}
    </View>
  );
}

/** One of the store's chats, or null while unknown. */
function chatOf(snapshot: StoreSnapshot, serverId: string, agentId: string): AgentInput | null {
  for (const workspace of snapshot.hosts.find((entry) => entry.serverId === serverId)?.workspaces ?? []) {
    const agent = workspace.agents?.find((entry) => entry.id === agentId);
    if (agent) return agent;
  }
  return null;
}

/**
 * The Catch up pill's popover. Opening it is the request: it writes a catch-up unless the stored one is newer
 * than the chat's last prompt and finished turn; "Again" writes a new one anyway.
 */
function CatchUpPopover({ theme, host, openSettings, ...context }: PluginButtonContentProps & { openSettings(): void }) {
  const { store, snapshot } = useNavigatorStore();
  const agentId = context.context === "agent" ? context.agentId : "";
  const chat = chatOf(snapshot, host.id, agentId);
  const [written, setWritten] = useState<CatchUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = theme.colors;
  const stored = chat?.catchUp ?? null;
  // The one just written wins until the host's copy of the chat catches up.
  const shown = written && (!stored || written.at >= stored.at) ? written : stored;
  const current = !!shown && !!chat && chat.status !== "running" && shown.at >= Math.max(chat.promptAt ?? 0, chat.unreadAt);
  const model = snapshot.catchUp.models[host.id]?.model ?? null;

  const write = () => {
    if (busy || !agentId) return;
    setBusy(true);
    setError(null);
    store
      .writeCatchUp(host.id, agentId)
      .then(setWritten)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  const started = useRef(false);
  useEffect(() => {
    // Once per opening, after the chat is known, so a current catch-up is not written again.
    if (started.current || !snapshot.profilesReady || (!chat && agentId)) return;
    started.current = true;
    if (model && !current) write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.profilesReady, chat, model]);

  if (snapshot.profilesReady && !model) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.foreground, fontSize: 13 }}>{`Choose the model that writes catch-ups on ${snapshot.hosts.find((entry) => entry.serverId === host.id)?.label || "this host"} first.`}</Text>
        <Pressable accessibilityRole="button" onPress={openSettings} style={({ pressed }) => ({ minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: pressed ? c.surface2 : c.surface1 })}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>Open settings → Inbox</Text>
        </Pressable>
      </View>
    );
  }
  // While the model works (several seconds), the opening of the agent's last reply is something to read now.
  const lastReply = busy && !current ? chat?.lastReply : undefined;
  return (
    <View style={{ gap: 8, minWidth: 240 }}>
      {lastReply ? (
        <View accessible accessibilityLabel={`Last reply: ${lastReply}`} style={{ gap: 4 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Last reply</Text>
          <Text style={{ color: c.foreground, fontSize: 14 }}>{lastReply}</Text>
        </View>
      ) : null}
      {shown && !lastReply ? (
        <View accessible accessibilityLabel={`${shown.title}. Left off: ${shown.left}. Next: ${shown.next}`} style={{ gap: 4, opacity: busy ? 0.5 : 1 }}>
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {`${shown.title} · ${timeAgo(shown.at, Date.now()) || "now"}${current ? "" : " · older"}`}
          </Text>
          <Text style={{ color: c.foreground, fontSize: 14 }}>
            <Text style={{ fontWeight: "700" }}>Left off </Text>
            {shown.left}
          </Text>
          <Text style={{ color: c.foreground, fontSize: 14 }}>
            <Text style={{ fontWeight: "700" }}>Next </Text>
            {shown.next}
          </Text>
        </View>
      ) : null}
      {busy ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={c.foregroundMuted} />
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Catching up…</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{`Could not catch up: ${error}`}</Text> : null}
      {!busy && shown ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Write the catch-up again" onPress={write} hitSlop={{ top: 6, bottom: 6 }} style={{ alignSelf: "flex-start" }}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>Again</Text>
        </Pressable>
      ) : null}
      {!busy && !shown && error ? (
        <Pressable accessibilityRole="button" onPress={write} hitSlop={{ top: 6, bottom: 6 }} style={{ alignSelf: "flex-start" }}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>Try again</Text>
        </Pressable>
      ) : null}
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

export function registerComposerPills(client: PluginClientContext): () => void {
  if (typeof client.addComposerPill !== "function") return () => undefined;
  const pills = new Map<string, { inbox: PluginButtonRegistration; read: PluginButtonRegistration; catchUp: PluginButtonRegistration; state: ChatState | null }>();
  const openSettings = () => client.openScreen({ screenId: PROFILES_SCREEN_ID, params: { section: "inbox" } });
  const CatchUpContent = (props: PluginButtonContentProps) => (
    <CatchUpPopover
      {...props}
      openSettings={() => {
        props.close();
        openSettings();
      }}
    />
  );
  let inboxLabel = INBOX_TITLE;
  // The host serving this copy: the chats that get its pills.
  let selfId: string | null = null;
  let stopped = false;
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      selfId = self.serverId;
      if (!stopped) refresh();
    })
    .catch(() => undefined);

  /**
   * Marks an unread chat read and a read one unread; questions, errors and running chats stay as they are.
   * Runs after Paseo has finished handling the press: on the phone, an update to the pressed pill made while
   * Paseo still handles its press did not show until the screen redrew, while other pills updated at once.
   */
  const toggle = (agentId: string) => {
    setTimeout(() => {
      const serverId = selfId;
      if (!serverId) return;
      const state = stateOf(serverId, agentId);
      if (state === "unread") getStore().markChatsRead(serverId, [agentId]);
      else if (state === "read") getStore().markChatUnread(serverId, agentId);
    }, 0);
  };

  /** The Inbox count on every Inbox pill, and each Read pill's state where it changed. */
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
      entry.read.update(readButton(state));
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
            id: "read-state",
            ...target,
            button: { ...readButton(null), behavior: { kind: "action", onPress: () => toggle(agent.id) } },
          }),
          state: null,
          catchUp: client.addComposerPill({
            id: "catch-up",
            ...target,
            button: { title: "Where this chat left off and what comes next", label: "Catch up", icon: CatchUpIcon, behavior: { kind: "popover", Content: CatchUpContent } },
          }),
        });
      }
      for (const [id, entry] of pills) {
        if (live.has(id)) continue;
        entry.inbox.remove();
        entry.read.remove();
        entry.catchUp.remove();
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
      entry.catchUp.remove();
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
