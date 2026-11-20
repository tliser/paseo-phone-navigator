// "Mark read" in the chat header: marks the open chat read; on a read chat "Mark unread" puts it back in the
// Inbox. When Paseo only tells the button which workspace is open, the popover lists that workspace's chats
// instead. Typing in a chat or sending it a prompt also marks it read.
import type { PluginButtonContentProps, PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { ReadMap } from "../shared/reads";
import { chatState } from "../shared/tree";
import type { AgentInput, ChatState, HostInput } from "../shared/types";
import { Mark } from "./marks";
import { useNavigatorStore } from "./runtime";

interface ChatInfo {
  agent: AgentInput;
  state: ChatState;
}

function chatsOf(hosts: readonly HostInput[], reads: ReadMap, serverId: string, workspaceId: string): ChatInfo[] {
  const workspace = hosts.find((host) => host.serverId === serverId)?.workspaces.find((entry) => entry.id === workspaceId);
  return (workspace?.agents ?? []).map((agent) => ({ agent, state: chatState(agent, serverId, workspaceId, reads, Date.now()) }));
}

/** Only unread and read chats can be marked; questions and errors stay until answered or fixed. */
const markable = (chat: ChatInfo) => chat.state === "unread" || chat.state === "read";

export function ReadStateIcon(props: PluginButtonIconProps) {
  const { snapshot } = useNavigatorStore();
  const chats = chatsOf(snapshot.hosts, snapshot.reads, props.host.id, props.workspaceId);
  const open = props.context === "agent" ? chats.find((chat) => chat.agent.id === props.agentId) : undefined;
  const unread = open ? open.state === "unread" : chats.some((chat) => chat.state === "unread");
  return (
    <View style={{ width: props.size, height: props.size }}>
      <Icon name={open && open.state === "read" ? "Undo2" : "Check"} size={props.size} color={unread ? props.theme.colors.accent : props.color} />
    </View>
  );
}

export function ReadStateContent(props: PluginButtonContentProps) {
  const { store, snapshot } = useNavigatorStore();
  const c = props.theme.colors;
  const serverId = props.host.id;
  const chats = chatsOf(snapshot.hosts, snapshot.reads, serverId, props.workspaceId);
  const act = (chat: ChatInfo) => {
    if (chat.state === "unread") store.markChatsRead(serverId, [chat.agent.id]);
    else store.markChatUnread(serverId, chat.agent.id);
    props.close();
  };
  const button = (chat: ChatInfo, big: boolean) => {
    const unread = chat.state === "unread";
    const text = unread ? `Mark "${chat.agent.title}" read` : `Mark "${chat.agent.title}" unread`;
    return (
      <Pressable
        key={chat.agent.id}
        accessibilityRole="button"
        accessibilityLabel={text}
        onPress={() => act(chat)}
        style={({ pressed }) => ({ minHeight: big ? 52 : 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: unread && big ? c.accent : pressed ? c.surface2 : c.surface1 })}
      >
        <Icon name={unread ? "Check" : "Undo2"} size={18} color={unread && big ? c.accentForeground : c.foreground} />
        <Text numberOfLines={2} style={{ flex: 1, color: unread && big ? c.accentForeground : c.foreground, fontSize: 15, fontWeight: unread ? "600" : "400" }}>{text}</Text>
      </Pressable>
    );
  };
  const note = (text: string) => <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{text}</Text>;

  let body;
  if (props.context === "agent") {
    const open = chats.find((chat) => chat.agent.id === props.agentId);
    if (!open) body = note("This chat is not loaded yet.");
    else if (markable(open)) body = button(open, true);
    else body = (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Mark theme={props.theme} kind={open.state} size={16} />
        {note(open.state === "asking" ? "It asks you. It stays in your Inbox until you answer." : open.state === "error" ? "The agent stopped with an error. It stays in your Inbox until it is fixed." : "It is still working.")}
      </View>
    );
  } else {
    const list = chats.filter(markable);
    body = list.length ? list.map((chat) => button(chat, false)) : note("Open a chat to mark it read.");
  }
  return <View style={{ gap: 8, padding: 12, minWidth: 260 }}>{body}</View>;
}
