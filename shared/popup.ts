// The sections of the Inbox pill's popup besides the Inbox, each a list of chats. They follow the profile like
// the tree does (hidden hosts left out; the Inbox alone covers every host). Pinned, Recent and Active pick
// workspaces as those views do and list each one's most recently active chat; a workspace without a chat
// (terminals only) cannot be opened from a pill and is left out. Pure.
import { chatEntry, type InboxEntry } from "./inbox";
import type { PopupSection, ProfileSettings } from "./profiles";
import { removedFromRecent, type ReadMap } from "./reads";
import { chatState, passesFilter, topLevelChats, workspaceState } from "./tree";
import type { HostInput } from "./types";

export interface SectionInput {
  hosts: readonly HostInput[];
  reads: ReadMap;
  settings: ProfileSettings;
  /** Pinned workspaces ("serverId:workspaceId") of the profile. */
  pins: ReadonlySet<string>;
  now: number;
}

export function sectionEntries(section: Exclude<PopupSection, "inbox">, { hosts, reads, settings, pins, now }: SectionInput): InboxEntry[] {
  const hidden = new Set(settings.hiddenHosts);
  const entries: { entry: InboxEntry; rank: number }[] = [];
  for (const host of hosts) {
    if (host.status !== "online" || host.loading || hidden.has(host.serverId)) continue;
    for (const workspace of host.workspaces) {
      const chats = topLevelChats(workspace.agents ?? []);
      if (section === "running") {
        for (const agent of chats) {
          if (chatState(agent, host.serverId, workspace.id, reads, now) === "running") entries.push({ entry: chatEntry(host, workspace, agent, "running"), rank: agent.activityAt });
        }
        continue;
      }
      const item = {
        workspace,
        state: workspaceState(workspace, host.serverId, reads, now),
        pinned: pins.has(`${host.serverId}:${workspace.id}`),
        offRecent: removedFromRecent(reads, host.serverId, workspace),
      };
      if (!passesFilter(item, section, settings, now)) continue;
      const latest = chats.reduce<(typeof chats)[number] | null>((best, agent) => (!best || agent.activityAt > best.activityAt ? agent : best), null);
      if (latest) entries.push({ entry: chatEntry(host, workspace, latest, chatState(latest, host.serverId, workspace.id, reads, now)), rank: workspace.orderAt });
    }
  }
  // Running: newest activity first. Workspaces: newest prompt first, as the tree orders them.
  return entries.sort((a, b) => b.rank - a.rank || a.entry.agentId.localeCompare(b.entry.agentId)).map(({ entry }) => entry);
}
