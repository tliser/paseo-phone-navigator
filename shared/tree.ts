// Builds the flattened tree the FlatList renders. Pure.
import { shortenModel } from "./format";
import { applyOrder, type OrderMap } from "./order";
import { agentsKey, hostKey, isCollapsed, projectKey, type CollapseMap, type ProfileSettings } from "./profiles";
import { isAgentUnread, isUnread, type ReadMap } from "./reads";
import { FILTERS, type AgentInput, type ChatState, type Filter, type HostInput, type ProjectKind, type WorkspaceInput, type WorkspaceState } from "./types";

const DAY_MS = 86_400_000;

/** Per-group tallies shown as badges. */
export interface Tally {
  needsYou: number;
  unread: number;
}

interface HostRow {
  type: "host";
  key: string;
  serverId: string;
  label: string;
  state: "online" | "offline" | "loading";
  collapsed: boolean;
  /** Workspaces shown under this host after filter and search. */
  count: number;
  tally: Tally;
  error: string | null;
}
export interface ProjectRow {
  type: "project";
  key: string;
  serverId: string;
  projectId: string;
  name: string;
  kind: ProjectKind;
  rootPath: string;
  collapsed: boolean;
  count: number;
  /** Counted over all its workspaces, for the dot on collapsed projects. */
  tally: Tally;
  /** The order list this row belongs to ("host:<serverId>"). */
  group: string;
}
export interface WorkspaceRow {
  type: "workspace";
  key: string;
  serverId: string;
  hostLabel: string;
  workspace: WorkspaceInput;
  state: WorkspaceState;
  modelShort: string;
  /** Pinned: passes every view and makes up the Pinned view. */
  pinned: boolean;
  /** Search found it only through this tab, so the row says so. */
  matchedTab?: MatchedTab;
  /** The order list this row belongs to ("proj:<serverId>:<projectId>"). */
  group: string;
  /** Collapse key of its agent rows; set when it has two or more agents. */
  agentsKey?: string;
  agentsOpen?: boolean;
}
/** One agent of an unfolded workspace. */
export interface AgentRow {
  type: "agent";
  key: string;
  serverId: string;
  workspaceId: string;
  workspaceTitle: string;
  agent: AgentInput;
  /** Shortened model name. */
  modelShort: string;
}
interface SkeletonRow {
  type: "skeleton";
  key: string;
}
interface NoteRow {
  type: "note";
  key: string;
  text: string;
}
export interface MatchedTab {
  title: string;
  kind: "chat" | "sub-agent" | "terminal";
}
export type TreeRow = HostRow | ProjectRow | WorkspaceRow | AgentRow | SkeletonRow | NoteRow;

export interface TreeResult {
  rows: TreeRow[];
  /** Workspaces matching filter and search on online hosts. */
  matched: number;
  /** Running workspaces on online, visible hosts (ignores filter and search). */
  running: number;
  counts: Record<Filter, number>;
  /** Group keys shown (for expand/collapse all). */
  groupKeys: string[];
  /** True when a filter or search hides every workspace. */
  emptyBecauseFiltered: boolean;
  /** Every group's complete child ids in display order, hidden ones included (for drag and drop). */
  groups: Record<string, string[]>;
}

export interface TreeOptions {
  filter: Filter;
  query: string;
  settings: ProfileSettings;
  collapse: CollapseMap;
  reads: ReadMap;
  /** Used when `settings.sort` is "manual". */
  order?: OrderMap;
  now: number;
  /** Host order as configured in the app. */
  hostOrder?: readonly string[];
  /** Pinned workspaces ("serverId:workspaceId"); they pass every view and make up the Pinned view. */
  pins?: ReadonlySet<string>;
}

/** A chat's state: asking, then error, then unread news, then running; anything else is read. */
export function chatState(agent: AgentInput, serverId: string, workspaceId: string, reads: ReadMap): ChatState {
  if (agent.status === "asking") return "asking";
  if (agent.status === "error") return "error";
  if (isAgentUnread(reads, serverId, workspaceId, agent)) return "unread";
  if (agent.status === "running") return "running";
  return "read";
}

/**
 * The state a row shows, from its chats: one asking (sub-agents included), then one errored, then the
 * workspace running, then a top-level chat with unread news. Without chats the workspace's own news counts.
 */
export function workspaceState(workspace: WorkspaceInput, serverId: string, reads: ReadMap): WorkspaceState {
  const agents = workspace.agents ?? [];
  const states = agents.map((agent) => chatState(agent, serverId, workspace.id, reads));
  if (workspace.needsYou || states.includes("asking")) return "needs_you";
  if (workspace.agentError || states.includes("error")) return "error";
  if (workspace.status === "running") return "running";
  if (agents.length) return agents.some((agent, index) => !agent.parentId && states[index] === "unread") ? "unread" : "read";
  return isUnread(reads, serverId, workspace.id, workspace.unreadAt) ? "unread" : "read";
}

/** needs you (asking or errored), then unread, then running, then the rest. */
function stateRank(state: WorkspaceState): number {
  return state === "needs_you" || state === "error" ? 0 : state === "unread" ? 1 : state === "running" ? 2 : 3;
}

interface Ranked {
  workspace: WorkspaceInput;
  state: WorkspaceState;
  pinned?: boolean;
}

function compareRanked(a: Ranked, b: Ranked): number {
  return (
    stateRank(a.state) - stateRank(b.state) ||
    b.workspace.activityAt - a.workspace.activityAt ||
    a.workspace.title.localeCompare(b.workspace.title) ||
    a.workspace.id.localeCompare(b.workspace.id)
  );
}

export function passesFilter(item: Ranked, filter: Filter, settings: ProfileSettings, now: number): boolean {
  const { workspace, state } = item;
  if (filter === "pinned") return !!item.pinned;
  // Hide old finished workspaces, but never one that is new to you or asks for you.
  if (state === "read" && workspace.status !== "running" && settings.hideDone !== "off") {
    const limit = (settings.hideDone === "1d" ? 1 : 7) * DAY_MS;
    if (!workspace.activityAt || now - workspace.activityAt > limit) return false;
  }
  if (filter === "recent") return state !== "read" || (!!workspace.activityAt && now - workspace.activityAt <= settings.recentDays * DAY_MS);
  if (filter === "active") return state !== "read";
  return true;
}

const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

function ownFields(workspace: WorkspaceInput, hostLabel: string): string[] {
  return [workspace.title, workspace.branch ?? "", workspace.projectName, hostLabel, shortenModel(workspace.model)].map((field) => field.toLowerCase());
}

function tabsOf(workspace: WorkspaceInput): MatchedTab[] {
  return (workspace.agents ?? []).map((agent) => ({ title: agent.title, kind: agent.parentId ? "sub-agent" : "chat" }));
}

/** Case-insensitive; every whitespace-separated term must match one of title, branch, project, host, model or a tab title. */
export function matchesSearch(workspace: WorkspaceInput, hostLabel: string, query: string): boolean {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const fields = [...ownFields(workspace, hostLabel), ...tabsOf(workspace).map((tab) => tab.title.toLowerCase())];
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** The tab a search hit came through, when the workspace's own fields do not match every term. */
export function matchReason(workspace: WorkspaceInput, hostLabel: string, query: string): MatchedTab | null {
  const own = ownFields(workspace, hostLabel);
  const missing = searchTerms(query).filter((term) => !own.some((field) => field.includes(term)));
  if (!missing.length) return null;
  return tabsOf(workspace).find((tab) => missing.some((term) => tab.title.toLowerCase().includes(term))) ?? null;
}

function orderHosts(hosts: readonly HostInput[], order: readonly string[] | undefined): HostInput[] {
  const rank = (id: string) => {
    const index = order?.indexOf(id) ?? -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return hosts
    .map((host, index) => ({ host, index }))
    .sort(
      (a, b) =>
        Number(a.host.status !== "online") - Number(b.host.status !== "online") ||
        rank(a.host.serverId) - rank(b.host.serverId) ||
        a.index - b.index,
    )
    .map((entry) => entry.host);
}

function addTally(tally: Tally, state: WorkspaceState): void {
  if (state === "needs_you" || state === "error") tally.needsYou++;
  else if (state === "unread") tally.unread++;
}

/** A workspace row, followed by its agent rows when it has several agents and they are unfolded. */
function workspaceRows(host: HostInput, item: Ranked, group: string, query: string, collapse: CollapseMap, settings: ProfileSettings): TreeRow[] {
  const row = workspaceRow(host, item, group, query);
  const agents = item.workspace.agents ?? [];
  if (agents.length < 2) return [row];
  const key = agentsKey(host.serverId, item.workspace.id);
  const open = !isCollapsed(collapse, key, settings);
  row.agentsKey = key;
  row.agentsOpen = open;
  if (!open) return [row];
  return [
    row,
    ...agents.map(
      (agent): AgentRow => ({
        type: "agent",
        key: `${row.key}#agent:${agent.id}`,
        serverId: host.serverId,
        workspaceId: item.workspace.id,
        workspaceTitle: item.workspace.title,
        agent,
        modelShort: shortenModel(agent.model),
      }),
    ),
  ];
}

function workspaceRow(host: HostInput, item: Ranked, group: string, query: string): WorkspaceRow {
  const matchedTab = query ? matchReason(item.workspace, host.label, query) : null;
  return {
    type: "workspace",
    key: `ws:${host.serverId}:${item.workspace.id}`,
    serverId: host.serverId,
    hostLabel: host.label,
    workspace: item.workspace,
    state: item.state,
    modelShort: shortenModel(item.workspace.model),
    pinned: !!item.pinned,
    ...(matchedTab ? { matchedTab } : {}),
    group,
  };
}

export function buildTree(hosts: readonly HostInput[], options: TreeOptions): TreeResult {
  const { filter, settings, collapse, reads, now } = options;
  // Pinned workspaces pass every view (search still applies), so pinning never hides a project.
  const pins = options.pins ?? new Set<string>();
  const isPinned = (serverId: string, workspaceId: string) => pins.has(`${serverId}:${workspaceId}`);
  const manual = settings.sort === "manual";
  const order = options.order ?? {};
  const groups: Record<string, string[]> = {};
  const query = options.query.trim();
  const searching = query.length > 0;
  const hidden = new Set(settings.hiddenHosts);
  const rows: TreeRow[] = [];
  const groupKeys: string[] = [];
  const counts: Record<Filter, number> = { all: 0, recent: 0, active: 0, pinned: 0 };
  let running = 0;
  let matched = 0;
  let totalOnline = 0;

  for (const host of orderHosts(hosts.filter((host) => !hidden.has(host.serverId)), options.hostOrder)) {
    const hKey = hostKey(host.serverId);
    const emptyTally = { needsYou: 0, unread: 0 };
    if (host.status !== "online") {
      // Offline hosts: dimmed, not expandable, left out of search results.
      if (!searching) {
        rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "offline", collapsed: true, count: 0, tally: emptyTally, error: host.error });
      }
      continue;
    }
    if (host.loading) {
      rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "loading", collapsed: false, count: 0, tally: emptyTally, error: null });
      for (let i = 0; i < 3; i++) rows.push({ type: "skeleton", key: `${hKey}#skel${i}` });
      continue;
    }

    const hostTally: Tally = { needsYou: 0, unread: 0 };
    totalOnline += host.workspaces.length;

    // Group by project, keeping each project's activity from all its workspaces (filtering must not change rank).
    const projects = new Map<string, { id: string; name: string; kind: ProjectKind; rootPath: string; activity: number; all: Ranked[]; tally: Tally }>();
    for (const workspace of host.workspaces) {
      const item: Ranked = { workspace, state: workspaceState(workspace, host.serverId, reads), pinned: isPinned(host.serverId, workspace.id) };
      let project = projects.get(workspace.projectId);
      if (!project) {
        project = { id: workspace.projectId, name: workspace.projectName, kind: workspace.projectKind, rootPath: workspace.projectRootPath, activity: 0, all: [], tally: { needsYou: 0, unread: 0 } };
        projects.set(workspace.projectId, project);
      }
      project.all.push(item);
      project.activity = Math.max(project.activity, workspace.activityAt);
      addTally(project.tally, item.state);
      addTally(hostTally, item.state);
      if (item.state === "running") running++;
      if (matchesSearch(workspace, host.label, query)) {
        for (const key of FILTERS) {
          if (passesFilter(item, key, settings, now)) counts[key]++;
        }
      }
    }

    const byActivity = (a: { activity: number; name: string; id: string }, b: { activity: number; name: string; id: string }) =>
      b.activity - a.activity || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const orderedProjects = manual
      ? applyOrder([...projects.values()], (project) => project.id, order[hKey], byActivity)
      : [...projects.values()].sort(byActivity);
    groups[hKey] = orderedProjects.map((project) => project.id);
    const visibleProjects = orderedProjects
      .map((project) => {
        const pKey = projectKey(host.serverId, project.id);
        const all = manual ? applyOrder(project.all, (entry) => entry.workspace.id, order[pKey], compareRanked) : [...project.all].sort(compareRanked);
        groups[pKey] = all.map((entry) => entry.workspace.id);
        const visible = all.filter((entry) => (entry.pinned || passesFilter(entry, filter, settings, now)) && matchesSearch(entry.workspace, host.label, query));
        // A search hit on the project name lists the project even when none of its workspaces match.
        const nameHit = searching && searchTerms(query).every((term) => project.name.toLowerCase().includes(term));
        return { ...project, visible, nameHit };
      })
      .filter((project) => project.visible.length > 0 || project.nameHit);

    const count = visibleProjects.reduce((sum, project) => sum + project.visible.length, 0);
    matched += count;
    if (searching && !visibleProjects.length) continue;

    groupKeys.push(hKey);
    for (const project of visibleProjects) groupKeys.push(projectKey(host.serverId, project.id));

    // Search expands temporarily; the stored collapse map is not touched.
    const hostCollapsed = searching ? false : isCollapsed(collapse, hKey, settings);
    rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "online", collapsed: hostCollapsed, count, tally: hostTally, error: host.error });
    if (hostCollapsed) continue;

    if (host.workspaces.length === 0) {
      rows.push({ type: "note", key: `${hKey}#empty`, text: "No workspaces" });
      continue;
    }
    if (visibleProjects.length === 0) {
      rows.push({ type: "note", key: `${hKey}#filtered`, text: filter === "pinned" ? "Nothing pinned" : filter === "active" ? "Nothing active or new" : filter === "recent" ? "Nothing recent" : "Nothing matches" });
      continue;
    }
    for (const project of visibleProjects) {
      const pKey = projectKey(host.serverId, project.id);
      const projectCollapsed = searching ? false : isCollapsed(collapse, pKey, settings);
      rows.push({ type: "project", key: pKey, serverId: host.serverId, projectId: project.id, name: project.name, kind: project.kind, rootPath: project.rootPath, collapsed: projectCollapsed, count: project.visible.length, tally: project.tally, group: hKey });
      if (projectCollapsed) continue;
      if (!project.visible.length) rows.push({ type: "note", key: `${pKey}#nomatch`, text: "No matching workspaces" });
      for (const item of project.visible) rows.push(...workspaceRows(host, item, pKey, query, collapse, settings));
    }
  }

  return {
    rows,
    matched,
    running,
    counts,
    groupKeys,
    emptyBecauseFiltered: matched === 0 && totalOnline > 0 && (searching || filter !== "all"),
    groups,
  };
}
