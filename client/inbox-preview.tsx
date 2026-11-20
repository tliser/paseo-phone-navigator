// Settings preview for the Inbox tab: the Inbox pill's popup with sample entries (never a real host), drawn
// exactly as the popup draws them: the profile's sections, each entry with the profile's Inbox lines. Inbox
// samples: one has a catch-up, one has none yet, one sits in a workspace with two chats.
import type { PluginTheme } from "@getpaseo/plugin";
import { View } from "react-native";
import type { InboxEntry } from "../shared/inbox";
import type { InboxField, PopupSection } from "../shared/profiles";
import { PopupSections } from "./popup-sections";

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

/** Other sections' samples: chats that are read or working, as those sections mostly hold. */
function otherSamples(now: number, host: string): Record<Exclude<PopupSection, "inbox">, InboxEntry[]> {
  const base = { serverId: "preview", hostLabel: host, branch: "main", workspaceChats: 1, model: "openai/gpt-5.1-codex" };
  const docs: InboxEntry = { ...base, workspaceId: "w4", workspaceTitle: "Docs refresh", projectName: "workspace-organizer", agentId: "a4", chatTitle: "README screenshots", state: "read", at: now - 3 * 60 * MINUTE, lastReply: "Screenshots refreshed for the new Inbox popup." };
  const build: InboxEntry = { ...base, workspaceId: "w5", workspaceTitle: "CI", projectName: "tutor", agentId: "a5", chatTitle: "Fix flaky login test", state: "running", at: now - 1 * MINUTE };
  return { pinned: [docs], recent: [build, docs], active: [build], running: [build] };
}

/** The Inbox pill's popup as the profile sets it up: its sections, each entry drawn with the Inbox lines. */
export function InboxPreview({ theme, lines, sections, host, compact }: { theme: PluginTheme; lines: readonly InboxField[][]; sections: readonly PopupSection[]; host: string; compact: boolean }) {
  const now = Date.now();
  const others = otherSamples(now, host);
  const lists = sections.map((section) => ({ section, entries: section === "inbox" ? sampleEntries(now, host) : others[section] }));
  return (
    <View accessibilityLabel="Preview" pointerEvents="none" style={{ padding: 8, backgroundColor: theme.colors.surface0 }}>
      <PopupSections theme={theme} lists={lists} lines={lines} now={now} compact={compact} onOpen={() => undefined} />
    </View>
  );
}
