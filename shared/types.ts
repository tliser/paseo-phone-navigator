// Domain inputs for the pure core. Independent of the Paseo SDK, so the core is testable and Hermes-safe.

export type WorkspaceStatus = "needs_input" | "failed" | "running" | "attention" | "done";
type HostStatus = "idle" | "connecting" | "online" | "offline" | "error";
export type Filter = "all" | "recent" | "active" | "inbox";
export const FILTERS: readonly Filter[] = ["all", "recent", "active", "inbox"];
export type Platform = "ios" | "android" | "web";
export type ProjectKind = "git" | "directory" | "non_git";

/**
 * What a row shows, after the plugin's own read state is applied:
 * - needs_you: an agent is actually asking you something (input or a permission).
 * - error: an agent stopped with an error (model or provider failure); you need to act.
 * - unread: a turn finished or failed after you last viewed the workspace.
 * - running: an agent is working.
 * - read: nothing new.
 */
export type WorkspaceState = "needs_you" | "error" | "unread" | "running" | "read";

/** One agent (chat tab) of a workspace, for the agent rows under an unfolded workspace. */
export interface AgentInput {
  id: string;
  title: string;
  model: string | null;
  /** asking: waits for you; running; error: the agent errored (model/provider error) and needs you;
   * finished: news since its last turn (Paseo's flag); idle; closed: stopped, tab still open. */
  status: "asking" | "running" | "error" | "finished" | "idle" | "closed";
  /** Started by another agent (Paseo label paseo.parent-agent-id). */
  sub: boolean;
  /** Last activity, epoch ms. */
  activityAt: number;
}

export interface WorkspaceInput {
  id: string;
  projectId: string;
  projectName: string;
  /** "git" projects get a new worktree; others a new workspace on the same folder. */
  projectKind: ProjectKind;
  /** Absolute project folder on the host. */
  projectRootPath: string;
  title: string;
  status: WorkspaceStatus;
  /** An agent (sub-agents included) waits for your input or a permission. */
  needsYou: boolean;
  /** An agent of the workspace stopped with an error (e.g. the model or provider failed): it needs you. */
  agentError?: boolean;
  /** When the last finished or failed turn happened, epoch ms; 0 when there is nothing to read. */
  unreadAt: number;
  branch: string | null;
  additions: number;
  deletions: number;
  /** Last activity, epoch ms; 0 when unknown. */
  activityAt: number;
  /** Model of the most recently active agent, as the daemon reports it. */
  model: string | null;
  /** Agents of the workspace (internal and archived ones left out): open before closed, then most recently active first. */
  agents?: readonly AgentInput[];
}

export interface HostInput {
  serverId: string;
  label: string;
  status: HostStatus;
  /** True while this host's directory has not been read yet. */
  loading: boolean;
  error: string | null;
  workspaces: readonly WorkspaceInput[];
}
