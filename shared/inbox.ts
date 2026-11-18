// The Inbox: every chat that asks you, errored or has unread news, on every online host. Pure.
import type { ReadMap } from "./reads";
import { chatState } from "./tree";
import type { HostInput } from "./types";

export type InboxState = "asking" | "error" | "unread";

export interface InboxEntry {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceTitle: string;
  projectName: string;
  agentId: string;
  chatTitle: string;
  state: InboxState;
  /** When it started waiting, or its last activity; epoch ms. */
  at: number;
}

export interface Inbox {
  entries: InboxEntry[];
  /** Labels of hosts whose chats are not checked: offline, or still loading. */
  offlineHosts: string[];
  loadingHosts: string[];
}

export interface InboxTally {
  total: number;
  asking: number;
  error: number;
  unread: number;
}

const urgent = (state: InboxState) => (state === "unread" ? 1 : 0);

/** Covers every host, hidden ones included: one Inbox you can trust. Asking and errors first, then unread; newest first. */
export function buildInbox(hosts: readonly HostInput[], reads: ReadMap): Inbox {
  const entries: InboxEntry[] = [];
  const offlineHosts: string[] = [];
  const loadingHosts: string[] = [];
  for (const host of hosts) {
    if (host.status !== "online") {
      offlineHosts.push(host.label);
      continue;
    }
    if (host.loading) {
      loadingHosts.push(host.label);
      continue;
    }
    for (const workspace of host.workspaces) {
      for (const agent of workspace.agents ?? []) {
        const state = chatState(agent, host.serverId, workspace.id, reads);
        if (state !== "asking" && state !== "error" && state !== "unread") continue;
        entries.push({
          serverId: host.serverId,
          hostLabel: host.label,
          workspaceId: workspace.id,
          workspaceTitle: workspace.title,
          projectName: workspace.projectName,
          agentId: agent.id,
          chatTitle: agent.title,
          state,
          at: (state === "unread" && agent.unreadAt) || agent.activityAt,
        });
      }
    }
  }
  entries.sort((a, b) => urgent(a.state) - urgent(b.state) || b.at - a.at || a.agentId.localeCompare(b.agentId));
  return { entries, offlineHosts, loadingHosts };
}

export function inboxTally(entries: readonly InboxEntry[]): InboxTally {
  const tally: InboxTally = { total: entries.length, asking: 0, error: 0, unread: 0 };
  for (const entry of entries) tally[entry.state]++;
  return tally;
}
