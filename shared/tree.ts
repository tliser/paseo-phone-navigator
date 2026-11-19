// Builds the flattened tree the FlatList renders. Pure.
import { shortenModel } from "./format";
import { applyOrder, type OrderMap } from "./order";
import { agentsKey, hostKey, isCollapsed, projectKey, subagentsKey, type CollapseMap, type ProfileSettings } from "./profiles";
import { isAgentUnread, isUnread, removedFromRecent, type ReadMap } from "./reads";
import { FILTERS, type AgentInput, type ChatState, type Filter, type HostInput, type ProjectKind, type WorkspaceInput, type WorkspaceState } from "./types";

const DAY_MS = 86_400_000;

/** Per-group counts shown on folded groups. */
export interface Tally {
  asking: number;
  error: number;
  unread: number;
}
const emptyTally = (): Tally => ({ asking: 0, error: 0, unread: 0 });

export interface HostRow {
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
  /** The chat that explains the row's state (asks you, failed or unread), for its status line. */
  reason?: { state: "asking" | "error" | "unread"; title: string };
  /** Top-level chats with unread news ("Mark workspace read" marks these). */
  unreadChats: string[];
  /** Archive requested; waiting for the host to drop it. */
  archiving?: boolean;
  /** Its tabs, when the profile shows tabs and it has any. */
  tabs?: TabSummary;
}

/** Status of a tab: a chat's state, or a terminal. */
type TabMark = ChatState | "terminal";

interface TabSummary {
  /** Collapse key of the tab list. */
  key: string;
  open: boolean;
  /** Marks of the top-level tabs, most urgent first; at most 4 (3 and `more` when there are more). */
  marks: TabMark[];
  more: number;
  /** "3 tabs: 1 asks you, 1 unread, 1 terminal; 1 sub-agent" */
  summary: string;
}

/** One tab (chat or terminal) under an unfolded workspace; sub-agents sit one level deeper. */
export interface TabRow {
  type: "tab";
  key: string;
  serverId: string;
  workspaceId: string;
  workspaceTitle: string;
  kind: "chat" | "terminal";
  id: string;
  title: string;
  mark: TabMark;
  /** Shortened model name; "" for terminals. */
  modelShort: string;
  /** 0 for top-level tabs, 1 for sub-agents. */
  depth: 0 | 1;
  /** The chat's sub-agents, when it has any and the profile shows them. */
  subagents?: { key: string; open: boolean; count: number; waiting: number };
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
interface MatchedTab {
  title: string;
  kind: "chat" | "sub-agent" | "terminal";
}
export type TreeRow = HostRow | ProjectRow | WorkspaceRow | TabRow | SkeletonRow | NoteRow;

/** One host for the host tabs or menu, counted like its section of the tree. */
export interface HostSummary {
  serverId: string;
  label: string;
  state: "online" | "offline" | "loading";
  /** Workspaces matching filter and search. */
  count: number;
  tally: Tally;
}

interface TreeResult {
  rows: TreeRow[];
  /** Workspaces matching filter and search on online, shown hosts. */
  matched: number;
  /** Running workspaces on online, visible hosts (ignores filter, search and the host choice). */
  running: number;
  counts: Record<Filter, number>;
  /** Group keys shown (for expand/collapse all). */
  groupKeys: string[];
  /** True when a filter or search hides every workspace. */
  emptyBecauseFiltered: boolean;
  /** Every group's complete child ids in display order, hidden ones included (for drag and drop). */
  groups: Record<string, string[]>;
  /** Every host not hidden by the profile, in display order. */
  hosts: HostSummary[];
  /** The host the tree is limited to; null shows all (also when the chosen host is gone). */
  hostView: string | null;
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
  /** Workspaces ("serverId:workspaceId") being archived. */
  archiving?: ReadonlySet<string>;
  /** Pinned workspaces ("serverId:workspaceId"); they pass every view and make up the Pinned view. */
  pins?: ReadonlySet<string>;
  /** Show only this host ("serverId"); null or unknown shows all. Host rows appear only when several hosts are shown. */
  hostView?: string | null;
}

/** A chat's state: asking, then error, then running, then unread news; anything else is read. A working chat never waits for you. */
export function chatState(agent: AgentInput, serverId: string, workspaceId: string, reads: ReadMap): ChatState {
  if (agent.status === "asking") return "asking";
  if (agent.status === "error") return "error";
  if (agent.status === "running") return "running";
  if (isAgentUnread(reads, serverId, workspaceId, agent)) return "unread";
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

interface Ranked {
  workspace: WorkspaceInput;
  state: WorkspaceState;
  pinned?: boolean;
  /** You removed it from the Recent view (see `removedFromRecent`). */
  offRecent?: boolean;
}

/** Newest prompt or workspace first. Status and agent output do not move rows; the Inbox and the marks show those. */
function compareRanked(a: Ranked, b: Ranked): number {
  return (
    b.workspace.orderAt - a.workspace.orderAt ||
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
  if (filter === "recent") {
    // Removed by you: back once you prompt it again, or while it asks you or failed.
    if (item.offRecent && state !== "needs_you" && state !== "error") return false;
    return state !== "read" || (!!workspace.activityAt && now - workspace.activityAt <= settings.recentDays * DAY_MS);
  }
  // Active is what runs; what needs you (asks, failed, unread) is the Inbox's job.
  if (filter === "active") return workspace.status === "running";
  return true;
}

const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

function ownFields(workspace: WorkspaceInput, hostLabel: string): string[] {
  return [workspace.title, workspace.branch ?? "", workspace.projectName, hostLabel, shortenModel(workspace.model)].map((field) => field.toLowerCase());
}

function tabsOf(workspace: WorkspaceInput): MatchedTab[] {
  return [
    ...(workspace.agents ?? []).map((agent): MatchedTab => ({ title: agent.title, kind: agent.parentId ? "sub-agent" : "chat" })),
    ...(workspace.terminals ?? []).map((terminal): MatchedTab => ({ title: terminal.title, kind: "terminal" })),
  ];
}

/** Case-insensitive; every whitespace-separated term must match one of title, branch, project, host, model or a tab title. */
export function matchesSearch(workspace: WorkspaceInput, hostLabel: string, query: string): boolean {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const fields = [...ownFields(workspace, hostLabel), ...tabsOf(workspace).map((tab) => tab.title.toLowerCase())];
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** The tab a search hit came through, when the workspace's own fields do not match every term. */
function matchReason(workspace: WorkspaceInput, hostLabel: string, query: string): MatchedTab | null {
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
  if (state === "needs_you") tally.asking++;
  else if (state === "error") tally.error++;
  else if (state === "unread") tally.unread++;
}

const markRank = (mark: TabMark) => (mark === "asking" || mark === "error" ? 0 : mark === "unread" ? 1 : mark === "running" ? 2 : mark === "read" ? 3 : 4);
const MARK_WORDS: Record<TabMark, string> = { asking: "asks you", error: "failed", unread: "unread", running: "running", read: "read", terminal: "terminal" };
const MAX_MARKS = 4;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summarize(marks: readonly TabMark[], subagents: number): string {
  const counts = new Map<TabMark, number>();
  for (const mark of marks) counts.set(mark, (counts.get(mark) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => markRank(a[0]) - markRank(b[0])).map(([mark, n]) => `${n} ${MARK_WORDS[mark]}`).join(", ");
  return `${count(marks.length, "tab")}: ${parts}${subagents ? `; ${count(subagents, "sub-agent")}` : ""}`;
}

/** A workspace row, followed by its tab rows when the tab list is unfolded. */
function workspaceRows(host: HostInput, item: Ranked, group: string, query: string, options: TreeOptions): TreeRow[] {
  const { collapse, settings, reads } = options;
  const row = workspaceRow(host, item, group, query, options.archiving ?? new Set());
  const { workspace } = item;
  const serverId = host.serverId;
  const agents = workspace.agents ?? [];
  const states = new Map(agents.map((agent) => [agent.id, chatState(agent, serverId, workspace.id, reads)]));
  const wanted = item.state === "needs_you" ? "asking" : item.state === "error" || item.state === "unread" ? item.state : null;
  const why = wanted ? agents.find((agent) => states.get(agent.id) === wanted && (wanted !== "unread" || !agent.parentId)) : undefined;
  if (wanted && why) row.reason = { state: wanted, title: why.title };
  row.unreadChats = agents.filter((agent) => !agent.parentId && states.get(agent.id) === "unread").map((agent) => agent.id);
  if (!settings.show.tabs) return [row];

  // A sub-agent whose parent is not listed (archived, not loaded) is a top-level tab, so it stays reachable.
  const ids = new Set(agents.map((agent) => agent.id));
  const parentOf = (agent: AgentInput) => (agent.parentId && ids.has(agent.parentId) ? agent.parentId : null);
  const top = agents.filter((agent) => !parentOf(agent));
  const children = (agent: AgentInput) => agents.filter((child) => parentOf(child) === agent.id);
  const terminals = workspace.terminals ?? [];
  const topMarks: TabMark[] = [...top.map((agent) => states.get(agent.id) ?? "read"), ...terminals.map((): TabMark => "terminal")];
  // A lone tab without listed sub-agents is the workspace itself: nothing to unfold.
  const lone = topMarks.length === 1 && !(settings.show.subagents && top.length === 1 && children(top[0]!).length);
  if (!topMarks.length || lone) return [row];
  const sorted = [...topMarks].sort((a, b) => markRank(a) - markRank(b));
  const shown = sorted.slice(0, sorted.length > MAX_MARKS ? MAX_MARKS - 1 : MAX_MARKS);
  const key = agentsKey(serverId, workspace.id);
  const open = !isCollapsed(collapse, key, settings);
  row.tabs = { key, open, marks: shown, more: sorted.length - shown.length, summary: summarize(topMarks, agents.length - top.length) };
  if (!open) return [row];

  const base = { serverId, workspaceId: workspace.id, workspaceTitle: workspace.title };
  const chatRow = (agent: AgentInput, depth: 0 | 1): TabRow => ({
    ...base,
    type: "tab",
    key: `${row.key}#tab:${agent.id}`,
    kind: "chat",
    id: agent.id,
    title: agent.title,
    mark: states.get(agent.id) ?? "read",
    modelShort: shortenModel(agent.model),
    depth,
  });
  const rows: TreeRow[] = [row];
  for (const agent of top) {
    const tab = chatRow(agent, 0);
    rows.push(tab);
    const kids = settings.show.subagents ? children(agent) : [];
    if (!kids.length) continue;
    const subKey = subagentsKey(serverId, workspace.id, agent.id);
    const subOpen = !isCollapsed(collapse, subKey, settings);
    const waiting = kids.filter((kid) => ["asking", "error", "unread"].includes(states.get(kid.id) ?? "read")).length;
    tab.subagents = { key: subKey, open: subOpen, count: kids.length, waiting };
    if (subOpen) for (const kid of kids) rows.push(chatRow(kid, 1));
  }
  for (const terminal of terminals) {
    rows.push({ ...base, type: "tab", key: `${row.key}#term:${terminal.id}`, kind: "terminal", id: terminal.id, title: terminal.title, mark: "terminal", modelShort: "", depth: 0 });
  }
  return rows;
}

function workspaceRow(host: HostInput, item: Ranked, group: string, query: string, archiving: ReadonlySet<string>): WorkspaceRow {
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
    unreadChats: [],
    ...(archiving.has(`${host.serverId}:${item.workspace.id}`) ? { archiving: true } : {}),
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
  const summaries: HostSummary[] = [];
  const visibleHosts = orderHosts(hosts.filter((host) => !hidden.has(host.serverId)), options.hostOrder);
  const hostView = options.hostView && visibleHosts.some((host) => host.serverId === options.hostView) ? options.hostView : null;
  // A host row only separates hosts; with one host shown it would be a wasted line.
  const hostRows = (hostView ? 1 : visibleHosts.length) > 1;

  for (const host of visibleHosts) {
    const hKey = hostKey(host.serverId);
    const noTally = emptyTally();
    const shown = !hostView || host.serverId === hostView;
    if (host.status !== "online") {
      summaries.push({ serverId: host.serverId, label: host.label, state: "offline", count: 0, tally: noTally });
      // Offline hosts: dimmed, not expandable, left out of search results.
      if (shown && !searching) {
        if (hostRows) rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "offline", collapsed: true, count: 0, tally: noTally, error: host.error });
        else rows.push({ type: "note", key: `${hKey}#offline`, text: `${host.label} is offline` });
      }
      continue;
    }
    if (host.loading) {
      summaries.push({ serverId: host.serverId, label: host.label, state: "loading", count: 0, tally: noTally });
      if (!shown) continue;
      if (hostRows) rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "loading", collapsed: false, count: 0, tally: noTally, error: null });
      for (let i = 0; i < 3; i++) rows.push({ type: "skeleton", key: `${hKey}#skel${i}` });
      continue;
    }

    const hostTally = emptyTally();
    if (shown) totalOnline += host.workspaces.length;

    // Group by project, keeping each project's newest prompt from all its workspaces (filtering must not change rank).
    const projects = new Map<string, { id: string; name: string; kind: ProjectKind; rootPath: string; orderAt: number; all: Ranked[]; tally: Tally }>();
    for (const workspace of host.workspaces) {
      const item: Ranked = {
        workspace,
        state: workspaceState(workspace, host.serverId, reads),
        pinned: isPinned(host.serverId, workspace.id),
        offRecent: removedFromRecent(reads, host.serverId, workspace),
      };
      let project = projects.get(workspace.projectId);
      if (!project) {
        project = { id: workspace.projectId, name: workspace.projectName, kind: workspace.projectKind, rootPath: workspace.projectRootPath, orderAt: 0, all: [], tally: emptyTally() };
        projects.set(workspace.projectId, project);
      }
      project.all.push(item);
      project.orderAt = Math.max(project.orderAt, workspace.orderAt);
      addTally(project.tally, item.state);
      addTally(hostTally, item.state);
      if (item.state === "running") running++;
      if (shown && matchesSearch(workspace, host.label, query)) {
        for (const key of FILTERS) {
          if (passesFilter(item, key, settings, now)) counts[key]++;
        }
      }
    }

    const byPrompt = (a: { orderAt: number; name: string; id: string }, b: { orderAt: number; name: string; id: string }) =>
      b.orderAt - a.orderAt || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const orderedProjects = manual
      ? applyOrder([...projects.values()], (project) => project.id, order[hKey], byPrompt)
      : [...projects.values()].sort(byPrompt);
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
    summaries.push({ serverId: host.serverId, label: host.label, state: "online", count, tally: hostTally });
    if (!shown) continue;
    matched += count;
    if (searching && !visibleProjects.length) continue;

    if (hostRows) groupKeys.push(hKey);
    for (const project of visibleProjects) groupKeys.push(projectKey(host.serverId, project.id));

    // Search expands temporarily; the stored collapse map is not touched.
    const hostCollapsed = hostRows && !searching && isCollapsed(collapse, hKey, settings);
    if (hostRows) rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "online", collapsed: hostCollapsed, count, tally: hostTally, error: host.error });
    if (hostCollapsed) continue;

    if (host.workspaces.length === 0) {
      rows.push({ type: "note", key: `${hKey}#empty`, text: "No workspaces" });
      continue;
    }
    if (visibleProjects.length === 0) {
      rows.push({ type: "note", key: `${hKey}#filtered`, text: filter === "pinned" ? "Nothing pinned" : filter === "active" ? "Nothing running" : filter === "recent" ? "Nothing recent" : "Nothing matches" });
      continue;
    }
    for (const project of visibleProjects) {
      const pKey = projectKey(host.serverId, project.id);
      const projectCollapsed = searching ? false : isCollapsed(collapse, pKey, settings);
      rows.push({ type: "project", key: pKey, serverId: host.serverId, projectId: project.id, name: project.name, kind: project.kind, rootPath: project.rootPath, collapsed: projectCollapsed, count: project.visible.length, tally: project.tally, group: hKey });
      if (projectCollapsed) continue;
      if (!project.visible.length) rows.push({ type: "note", key: `${pKey}#nomatch`, text: "No matching workspaces" });
      for (const item of project.visible) rows.push(...workspaceRows(host, item, pKey, query, options));
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
    hosts: summaries,
    hostView,
  };
}
