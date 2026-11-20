// The Inbox: every top-level chat that asks you, errored or has unread news, on every online host. Sub-agents
// are left out: they belong to their parent's work, which the Inbox already lists. Pure.
import type { CatchUp } from "./catchup";
import type { ReadMap } from "./reads";
import { chatState, topLevelChats } from "./tree";
import type { AgentRequest, HostInput } from "./types";

type InboxState = "asking" | "error" | "unread";

export interface InboxEntry {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceTitle: string;
  projectName: string;
  branch: string | null;
  /** Top-level chats of its workspace: with one, the workspace title only repeats the chat's. */
  workspaceChats: number;
  agentId: string;
  chatTitle: string;
  model: string | null;
  state: InboxState;
  /** When it started waiting, or its last activity; epoch ms. */
  at: number;
  /** What it asks (asking only): the question or the permission it waits for, answerable from the Inbox. */
  request?: AgentRequest;
  /** Why it stopped (error only): the agent's last error message. */
  errorText?: string;
  catchUp?: CatchUp;
  /** The chat was prompted or finished a turn after its catch-up was written. */
  catchUpStale?: boolean;
  /** The opening of the agent's last reply, plain text (see `replySummary`), once fetched. */
  lastReply?: string;
}

export interface Inbox {
  entries: InboxEntry[];
  /** Labels of hosts whose chats are not checked: offline, still loading, or failing to load. */
  offlineHosts: string[];
  loadingHosts: string[];
  failedHosts: string[];
}

export interface InboxTally {
  total: number;
  asking: number;
  error: number;
  unread: number;
}

const urgent = (state: InboxState) => (state === "unread" ? 1 : 0);

/**
 * Covers every host, hidden ones included: one Inbox you can trust. Asking and errors first, then unread;
 * newest first. `now` lets news older than KEEP_DAYS drop out (see `isAgentUnread`).
 */
export function buildInbox(hosts: readonly HostInput[], reads: ReadMap, now?: number): Inbox {
  const entries: InboxEntry[] = [];
  const offlineHosts: string[] = [];
  const loadingHosts: string[] = [];
  const failedHosts: string[] = [];
  for (const host of hosts) {
    if (host.status !== "online") {
      offlineHosts.push(host.label);
      continue;
    }
    if (host.loading) {
      loadingHosts.push(host.label);
      continue;
    }
    // A failed load keeps the last complete list (possibly none), so its chats may be missing or stale.
    if (host.error) failedHosts.push(host.label);
    for (const workspace of host.workspaces) {
      const chats = topLevelChats(workspace.agents ?? []);
      for (const agent of chats) {
        const state = chatState(agent, host.serverId, workspace.id, reads, now);
        if (state !== "asking" && state !== "error" && state !== "unread") continue;
        entries.push({
          serverId: host.serverId,
          hostLabel: host.label,
          workspaceId: workspace.id,
          workspaceTitle: workspace.title,
          projectName: workspace.projectName,
          branch: workspace.branch,
          workspaceChats: chats.length,
          agentId: agent.id,
          chatTitle: agent.title,
          model: agent.model,
          state,
          at: (state === "unread" && agent.unreadAt) || agent.activityAt,
          ...(state === "asking" && agent.request ? { request: agent.request } : {}),
          ...(state === "error" && agent.errorText ? { errorText: agent.errorText } : {}),
          ...(agent.catchUp ? { catchUp: agent.catchUp, catchUpStale: agent.catchUp.at < Math.max(agent.promptAt ?? 0, agent.unreadAt) } : {}),
          ...(agent.lastReply ? { lastReply: agent.lastReply } : {}),
        });
      }
    }
  }
  entries.sort((a, b) => urgent(a.state) - urgent(b.state) || b.at - a.at || a.agentId.localeCompare(b.agentId));
  return { entries, offlineHosts, loadingHosts, failedHosts };
}

export function inboxTally(entries: readonly InboxEntry[]): InboxTally {
  const tally: InboxTally = { total: entries.length, asking: 0, error: 0, unread: 0 };
  for (const entry of entries) tally[entry.state]++;
  return tally;
}
