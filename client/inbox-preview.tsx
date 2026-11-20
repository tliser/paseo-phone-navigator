// Settings preview for the Inbox tab: sample entries (never a real host) drawn exactly as the Inbox draws them,
// with the profile's Inbox lines. One has a catch-up, one has none yet, one sits in a workspace with two chats.
import type { PluginTheme } from "@getpaseo/plugin";
import { View } from "react-native";
import type { InboxEntry } from "../shared/inbox";
import type { InboxField } from "../shared/profiles";
import { EntryRow } from "./inbox-sheet";

const MINUTE = 60_000;

function sampleEntries(now: number, host: string): InboxEntry[] {
  const base = { serverId: "preview", hostLabel: host, branch: "main", workspaceChats: 1, model: "anthropic/claude-sonnet-4-5" };
  return [
    {
      ...base,
      workspaceId: "w1",
      workspaceTitle: "Add a catch-up button to the chat so I know where",
      projectName: "workspace-organizer",
      branch: "catchup",
      agentId: "a1",
      chatTitle: "Inbox catch-up feature",
      state: "unread",
      at: now - 2 * 60 * MINUTE,
      catchUp: { title: "Inbox catch-up feature", left: "Catch-up pill and Inbox lines built, tests pass.", next: "You try the pill on your phone.", at: now - 90 * MINUTE },
    },
    {
      ...base,
      workspaceId: "w2",
      workspaceTitle: "Payment states",
      projectName: "shop",
      agentId: "a2",
      chatTitle: "Refund webhook",
      state: "asking",
      lastReply: "Refund webhook handler written; it needs your OK to run the integration tests.",
      at: now - 5 * MINUTE,
    },
    {
      ...base,
      workspaceId: "w3",
      workspaceTitle: "Release 2.0",
      workspaceChats: 2,
      projectName: "tutor",
      agentId: "a3",
      chatTitle: "Changelog draft",
      state: "unread",
      at: now - 26 * 60 * MINUTE,
      catchUp: { title: "Changelog draft", left: "Draft for 2.0 written in CHANGELOG.md.", next: "You review the wording, then tag.", at: now - 26 * 60 * MINUTE },
    },
  ];
}

export function InboxPreview({ theme, lines, host, compact }: { theme: PluginTheme; lines: readonly InboxField[][]; host: string; compact: boolean }) {
  const now = Date.now();
  return (
    <View accessibilityLabel="Preview" pointerEvents="none" style={{ gap: 4, padding: 8, backgroundColor: theme.colors.surface0 }}>
      {sampleEntries(now, host).map((entry) => (
        <EntryRow key={entry.agentId} theme={theme} entry={entry} lines={lines} now={now} compact={compact} onOpen={() => undefined} />
      ))}
    </View>
  );
}
