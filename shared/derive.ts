// Turns the daemon's workspace and agent payloads into WorkspaceInput. Pure; structural types only,
// so it neither depends on the SDK's generated types nor breaks when fields are added.
import { epoch } from "./format";
import type { WorkspaceInput, WorkspaceStatus } from "./types";

export interface WorkspaceLike {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  name: string;
  title?: string | null;
  status: WorkspaceStatus;
  statusEnteredAt?: string | null;
  activityAt?: string | null;
  createdAt?: string;
  archivingAt?: string | null;
  background?: boolean;
  internal?: boolean;
  diffStat?: { additions: number; deletions: number } | null;
  gitRuntime?: { currentBranch?: string | null } | null;
}

export interface AgentLike {
  id: string;
  workspaceId?: string;
  model: string | null;
  provider: string;
  status: string;
  updatedAt: string;
  lastUserMessageAt?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
  labels?: Readonly<Record<string, string>>;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  pendingPermissions?: readonly unknown[];
}

/** Label Paseo sets on agents started by another agent. */
export const PARENT_AGENT_LABEL = "paseo.parent-agent-id";

const isSubAgent = (agent: AgentLike) => !!agent.labels?.[PARENT_AGENT_LABEL]?.trim();

/** Sub-agents, internal and archived agents never decide the model or the unread time. */
export function isListedAgent(agent: AgentLike): boolean {
  if (agent.archivedAt || agent.internal) return false;
  return !isSubAgent(agent);
}

export function isListedWorkspace(workspace: WorkspaceLike): boolean {
  return !workspace.background && !workspace.internal && !workspace.archivingAt;
}

/** A real prompt: a permission request is waiting. Sub-agents count, since they block their parent. */
export function agentNeedsYou(agent: AgentLike): boolean {
  if (agent.archivedAt || agent.status === "closed") return false;
  return (agent.pendingPermissions?.length ?? 0) > 0 || (agent.requiresAttention === true && agent.attentionReason === "permission");
}

function agentActivity(agent: AgentLike): number {
  return Math.max(epoch(agent.updatedAt), epoch(agent.lastUserMessageAt));
}

/** The agent whose model a workspace shows: a running one first, else the most recently active. */
export function latestAgentByWorkspace(agents: readonly AgentLike[]): Map<string, AgentLike> {
  const best = new Map<string, AgentLike>();
  for (const agent of agents) {
    if (!agent.workspaceId || !isListedAgent(agent)) continue;
    const current = best.get(agent.workspaceId);
    if (!current) {
      best.set(agent.workspaceId, agent);
      continue;
    }
    const running = Number(agent.status === "running") - Number(current.status === "running");
    if (running > 0 || (running === 0 && agentActivity(agent) > agentActivity(current))) best.set(agent.workspaceId, agent);
  }
  return best;
}

export function deriveWorkspaces(workspaces: readonly WorkspaceLike[], agents: readonly AgentLike[]): WorkspaceInput[] {
  const latest = latestAgentByWorkspace(agents);
  const asking = new Set<string>();
  /** Latest finished/error flag of a main agent per workspace. */
  const finishedAt = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    if (agentNeedsYou(agent)) asking.add(agent.workspaceId);
    if (isListedAgent(agent) && agent.requiresAttention && (agent.attentionReason === "finished" || agent.attentionReason === "error")) {
      const at = epoch(agent.attentionTimestamp) || epoch(agent.updatedAt);
      finishedAt.set(agent.workspaceId, Math.max(finishedAt.get(agent.workspaceId) ?? 0, at));
    }
  }

  const result: WorkspaceInput[] = [];
  for (const workspace of workspaces) {
    if (!isListedWorkspace(workspace)) continue;
    const agent = latest.get(workspace.id);
    const activityAt =
      Math.max(epoch(workspace.activityAt), epoch(workspace.statusEnteredAt), agent ? agentActivity(agent) : 0) ||
      epoch(workspace.createdAt);
    const needsYou = workspace.status === "needs_input" || asking.has(workspace.id);
    // Paseo marks a finished turn as "attention" until it is cleared; here that is just something to read.
    const hasNews = workspace.status === "attention" || workspace.status === "failed";
    const unreadAt = hasNews
      ? Math.max(epoch(workspace.statusEnteredAt), finishedAt.get(workspace.id) ?? 0) || activityAt
      : 0;
    result.push({
      id: workspace.id,
      projectId: workspace.projectId,
      projectName: workspace.projectCustomName?.trim() || workspace.projectDisplayName,
      title: workspace.title?.trim() || workspace.name,
      status: workspace.status,
      needsYou,
      unreadAt,
      branch: workspace.gitRuntime?.currentBranch ?? null,
      additions: workspace.diffStat?.additions ?? 0,
      deletions: workspace.diffStat?.deletions ?? 0,
      activityAt,
      model: agent?.model ?? null,
    });
  }
  return result;
}
