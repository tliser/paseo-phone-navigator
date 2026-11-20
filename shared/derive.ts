// Turns the daemon's workspace and agent payloads into WorkspaceInput. Pure; structural types only,
// so it neither depends on the SDK's generated types nor breaks when fields are added.
import { readCatchUp } from "./catchup";
import { readReply } from "./reply";
import { epoch } from "./format";
import type { AgentInput, AgentRequest, ProjectKind, RequestAction, RequestQuestion, WorkspaceInput, WorkspaceStatus } from "./types";

export interface WorkspaceLike {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectKind?: string;
  projectRootPath?: string;
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
  title?: string | null;
  createdAt?: string;
  workspaceId?: string;
  model: string | null;
  provider: string;
  status: string;
  updatedAt: string;
  lastUserMessageAt?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
  /** A helper Paseo hides from tabs, lists and attention. */
  background?: boolean;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>>;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  pendingPermissions?: readonly unknown[];
  lastError?: string | null;
  /** Data plugins store on the agent; the catch-up lives here. */
  metadata?: Readonly<Record<string, unknown>> | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** Questions with fixed options, read the way Paseo's question form reads them; [] when the input has another shape. */
function questionsOf(input: Record<string, unknown>): RequestQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  const questions: RequestQuestion[] = [];
  for (const raw of input.questions as unknown[]) {
    const q = record(raw);
    if (typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) return [];
    const options = (q.options as unknown[]).map(record).filter((option) => typeof option.label === "string");
    questions.push({
      question: q.question,
      header: q.header,
      options: options.map((option) => ({ label: option.label as string, ...(typeof option.description === "string" ? { description: option.description } : {}) })),
      multiSelect: q.multiSelect === true,
      allowOther: q.allowOther === true || q.isOther === true || options.length === 0,
    });
  }
  return questions;
}

/** What a permission request shows: the provider's title, else the tool name; the command or description below it. */
export function requestOf(raw: unknown): AgentRequest | undefined {
  const request = record(raw);
  if (typeof request.id !== "string") return undefined;
  const kind = (["tool", "plan", "question", "mode", "other"] as const).find((value) => value === request.kind) ?? "other";
  const input = record(request.input);
  const detail = record(request.detail);
  const plan = text(record(request.metadata).planText) || text(input.plan);
  const description = text(request.description) || text(detail.command) || text(input.command) || (kind === "plan" ? plan : "");
  const given = Array.isArray(request.actions)
    ? (request.actions as unknown[]).map(record).filter((action): action is Record<string, unknown> & RequestAction => typeof action.id === "string" && typeof action.label === "string" && (action.behavior === "allow" || action.behavior === "deny"))
    : [];
  // Paseo's own defaults when the provider names no actions: deny, and accept (implement for a plan).
  const actions: RequestAction[] = kind === "question" ? [] : given.length
    ? given.map(({ id, label, behavior, variant }) => ({ id, label, behavior, ...(variant === "primary" || variant === "secondary" || variant === "danger" ? { variant } : {}) }))
    : [{ id: "reject", label: "Deny", behavior: "deny", variant: "danger" }, { id: "accept", label: kind === "plan" ? "Implement" : "Allow", behavior: "allow", variant: "primary" }];
  return { id: request.id, kind, title: text(request.title) || text(request.name) || "Permission", description, actions, questions: kind === "question" ? questionsOf(input) : [], input };
}

/** Label Paseo sets on agents started by another agent. */
const PARENT_AGENT_LABEL = "paseo.parent-agent-id";

const parentOf = (agent: AgentLike): string | null => agent.parentAgentId?.trim() || agent.labels?.[PARENT_AGENT_LABEL]?.trim() || null;

/** Archived, internal and background agents are not tabs. */
const isTab = (agent: AgentLike) => !agent.archivedAt && !agent.internal && !agent.background;

/** Only top-level chats decide the model and the unread time. */
function isListedAgent(agent: AgentLike): boolean {
  return isTab(agent) && !parentOf(agent);
}

function isListedWorkspace(workspace: WorkspaceLike): boolean {
  return !workspace.background && !workspace.internal && !workspace.archivingAt;
}

/** The agent stopped with an error (Paseo: status "error", or attention reason "error"). Archived ones don't count. */
function agentErrored(agent: AgentLike): boolean {
  if (agent.archivedAt) return false;
  return agent.status === "error" || (agent.requiresAttention === true && agent.attentionReason === "error");
}

/** A real prompt: a permission request is waiting. Sub-agents count, since they block their parent. */
function agentNeedsYou(agent: AgentLike): boolean {
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

function agentInput(agent: AgentLike, index: number): AgentInput {
  const status: AgentInput["status"] = agentNeedsYou(agent)
    ? "asking"
    : agent.status === "running" || agent.status === "initializing"
      ? "running"
      : agentErrored(agent)
        ? "error"
        : agent.requiresAttention && agent.attentionReason === "finished"
          ? "finished"
          : agent.status === "closed"
            ? "closed"
            : "idle";
  const unreadAt = agent.requiresAttention && agent.attentionReason === "finished" ? epoch(agent.attentionTimestamp) || epoch(agent.updatedAt) : 0;
  const request = status === "asking" && agent.pendingPermissions?.length ? requestOf(agent.pendingPermissions[0]) : undefined;
  const errorText = status === "error" ? text(agent.lastError) : "";
  const catchUp = readCatchUp(agent.metadata);
  const lastReply = readReply(agent.metadata);
  return {
    id: agent.id,
    title: agent.title?.trim() || `Agent ${index + 1}`,
    model: agent.model,
    status,
    parentId: parentOf(agent),
    activityAt: agentActivity(agent),
    unreadAt,
    promptAt: epoch(agent.lastUserMessageAt),
    ...(request ? { request } : {}),
    ...(errorText ? { errorText } : {}),
    ...(catchUp ? { catchUp } : {}),
    ...(lastReply ? { lastReply } : {}),
  };
}

/**
 * Every agent (chat tab) of a workspace, sub-agents and closed ones included, as Paseo lists them;
 * internal, background and archived agents are left out. Open ones first, then the most recently active.
 */
export function agentsByWorkspace(agents: readonly AgentLike[]): Map<string, AgentInput[]> {
  const grouped = new Map<string, AgentLike[]>();
  for (const agent of agents) {
    if (!agent.workspaceId || !isTab(agent)) continue;
    grouped.set(agent.workspaceId, [...(grouped.get(agent.workspaceId) ?? []), agent]);
  }
  const result = new Map<string, AgentInput[]>();
  for (const [workspaceId, list] of grouped) {
    // Numbered by age so an untitled agent keeps its name; listed newest first.
    const byAge = [...list].sort((a, b) => epoch(a.createdAt ?? a.updatedAt) - epoch(b.createdAt ?? b.updatedAt));
    const inputs = list.map((agent) => agentInput(agent, byAge.indexOf(agent)));
    const closed = (agent: AgentInput) => Number(agent.status === "closed");
    result.set(workspaceId, inputs.sort((a, b) => closed(a) - closed(b) || b.activityAt - a.activityAt || a.id.localeCompare(b.id)));
  }
  return result;
}

export function deriveWorkspaces(workspaces: readonly WorkspaceLike[], agents: readonly AgentLike[]): WorkspaceInput[] {
  const latest = latestAgentByWorkspace(agents);
  const agentLists = agentsByWorkspace(agents);
  const asking = new Set<string>();
  const errored = new Set<string>();
  /** Latest finished/error flag of a main agent per workspace. */
  const finishedAt = new Map<string, number>();
  /** Your latest prompt to a main agent per workspace. */
  const promptedAt = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.workspaceId || agent.background) continue;
    if (agentNeedsYou(agent)) asking.add(agent.workspaceId);
    if (agentErrored(agent)) errored.add(agent.workspaceId);
    if (isListedAgent(agent) && agent.requiresAttention && (agent.attentionReason === "finished" || agent.attentionReason === "error")) {
      const at = epoch(agent.attentionTimestamp) || epoch(agent.updatedAt);
      finishedAt.set(agent.workspaceId, Math.max(finishedAt.get(agent.workspaceId) ?? 0, at));
    }
    if (isListedAgent(agent)) promptedAt.set(agent.workspaceId, Math.max(promptedAt.get(agent.workspaceId) ?? 0, epoch(agent.lastUserMessageAt)));
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
      projectKind: (workspace.projectKind === "git" || workspace.projectKind === "non_git" ? workspace.projectKind : "directory") as ProjectKind,
      projectRootPath: workspace.projectRootPath ?? "",
      title: workspace.title?.trim() || workspace.name,
      status: workspace.status,
      needsYou,
      agentError: errored.has(workspace.id),
      unreadAt,
      branch: workspace.gitRuntime?.currentBranch ?? null,
      additions: workspace.diffStat?.additions ?? 0,
      deletions: workspace.diffStat?.deletions ?? 0,
      activityAt,
      orderAt: Math.max(promptedAt.get(workspace.id) ?? 0, epoch(workspace.createdAt)),
      model: agent?.model ?? null,
      agents: agentLists.get(workspace.id) ?? [],
    });
  }
  return result;
}
