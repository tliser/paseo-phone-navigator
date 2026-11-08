// Domain inputs for the pure core. Independent of the Paseo SDK, so the core is testable and Hermes-safe.

export type WorkspaceStatus = "needs_input" | "failed" | "running" | "attention" | "done";
export type HostStatus = "idle" | "connecting" | "online" | "offline" | "error";
export type Filter = "all" | "active" | "attention";
export type Platform = "ios" | "android" | "web";

export interface WorkspaceInput {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: WorkspaceStatus;
  branch: string | null;
  additions: number;
  deletions: number;
  /** Last activity, epoch ms; 0 when unknown. */
  activityAt: number;
  /** Model of the most recently active agent, as the daemon reports it. */
  model: string | null;
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

export const ATTENTION_STATUSES: readonly WorkspaceStatus[] = ["needs_input", "failed", "attention"];

export function isAttention(status: WorkspaceStatus): boolean {
  return status === "needs_input" || status === "failed" || status === "attention";
}
