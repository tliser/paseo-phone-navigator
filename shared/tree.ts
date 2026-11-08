// Builds the flattened tree the FlatList renders. Pure.
import { shortenModel } from "./format";
import { hostKey, isCollapsed, projectKey, type CollapseMap, type ProfileSettings } from "./profiles";
import { isUnread, type ReadMap } from "./reads";
import type { Filter, HostInput, WorkspaceInput, WorkspaceState } from "./types";

const DAY_MS = 86_400_000;

/** Per-group tallies shown as badges. */
export interface Tally {
  needsYou: number;
  unread: number;
}

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
  collapsed: boolean;
  count: number;
  /** Counted over all its workspaces, for the dot on collapsed projects. */
  tally: Tally;
}
export interface WorkspaceRow {
  type: "workspace";
  key: string;
  serverId: string;
  hostLabel: string;
  workspace: WorkspaceInput;
  state: WorkspaceState;
  modelShort: string;
}
export interface SkeletonRow {
  type: "skeleton";
  key: string;
}
export interface NoteRow {
  type: "note";
  key: string;
  text: string;
}
export type TreeRow = HostRow | ProjectRow | WorkspaceRow | SkeletonRow | NoteRow;

export interface TreeResult {
  rows: TreeRow[];
  /** Workspaces matching filter and search on online hosts. */
  matched: number;
  /** Totals on online, visible hosts (ignores filter and search). */
  tally: Tally;
  counts: Record<Filter, number>;
  /** Group keys shown (for expand/collapse all). */
  groupKeys: string[];
  /** True when a filter or search hides every workspace. */
  emptyBecauseFiltered: boolean;
}

export interface TreeOptions {
  filter: Filter;
  query: string;
  settings: ProfileSettings;
  collapse: CollapseMap;
  reads: ReadMap;
  now: number;
  /** Host order as configured in the app. */
  hostOrder?: readonly string[];
}

/** The state a row shows: a real prompt beats running beats unread news. */
export function workspaceState(workspace: WorkspaceInput, serverId: string, reads: ReadMap): WorkspaceState {
  if (workspace.needsYou) return "needs_you";
  if (workspace.status === "running") return "running";
  if (isUnread(reads, serverId, workspace.id, workspace.unreadAt)) return "unread";
  return "read";
}

/** needs you, then unread, then running, then the rest. */
export function stateRank(state: WorkspaceState): number {
  return state === "needs_you" ? 0 : state === "unread" ? 1 : state === "running" ? 2 : 3;
}

interface Ranked {
  workspace: WorkspaceInput;
  state: WorkspaceState;
}

export function compareRanked(a: Ranked, b: Ranked): number {
  return (
    stateRank(a.state) - stateRank(b.state) ||
    b.workspace.activityAt - a.workspace.activityAt ||
    a.workspace.title.localeCompare(b.workspace.title) ||
    a.workspace.id.localeCompare(b.workspace.id)
  );
}

export function passesFilter(item: Ranked, filter: Filter, settings: ProfileSettings, now: number): boolean {
  const { workspace, state } = item;
  // Hide old finished workspaces, but never one that is new to you or asks for you.
  if (state === "read" && workspace.status !== "running" && settings.hideDone !== "off") {
    const limit = (settings.hideDone === "1d" ? 1 : 7) * DAY_MS;
    if (!workspace.activityAt || now - workspace.activityAt > limit) return false;
  }
  if (filter === "active") return state !== "read";
  if (filter === "inbox") return state === "needs_you" || state === "unread";
  return true;
}

/** Case-insensitive; every whitespace-separated term must match one of title, branch, project, host or model. */
export function matchesSearch(workspace: WorkspaceInput, hostLabel: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const fields = [workspace.title, workspace.branch ?? "", workspace.projectName, hostLabel, shortenModel(workspace.model)].map(
    (field) => field.toLowerCase(),
  );
  return terms.every((term) => fields.some((field) => field.includes(term)));
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
  if (state === "needs_you") tally.needsYou++;
  else if (state === "unread") tally.unread++;
}

export function buildTree(hosts: readonly HostInput[], options: TreeOptions): TreeResult {
  const { filter, settings, collapse, reads, now } = options;
  const query = options.query.trim();
  const searching = query.length > 0;
  const hidden = new Set(settings.hiddenHosts);
  const rows: TreeRow[] = [];
  const groupKeys: string[] = [];
  const counts: Record<Filter, number> = { all: 0, active: 0, inbox: 0 };
  const total: Tally = { needsYou: 0, unread: 0 };
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
    const projects = new Map<string, { id: string; name: string; activity: number; all: Ranked[]; tally: Tally }>();
    for (const workspace of host.workspaces) {
      const item: Ranked = { workspace, state: workspaceState(workspace, host.serverId, reads) };
      let project = projects.get(workspace.projectId);
      if (!project) {
        project = { id: workspace.projectId, name: workspace.projectName, activity: 0, all: [], tally: { needsYou: 0, unread: 0 } };
        projects.set(workspace.projectId, project);
      }
      project.all.push(item);
      project.activity = Math.max(project.activity, workspace.activityAt);
      addTally(project.tally, item.state);
      addTally(hostTally, item.state);
      if (matchesSearch(workspace, host.label, query)) {
        for (const key of ["all", "active", "inbox"] as const) {
          if (passesFilter(item, key, settings, now)) counts[key]++;
        }
      }
    }
    total.needsYou += hostTally.needsYou;
    total.unread += hostTally.unread;

    const visibleProjects = [...projects.values()]
      .map((project) => ({
        ...project,
        visible: project.all
          .filter((item) => passesFilter(item, filter, settings, now) && matchesSearch(item.workspace, host.label, query))
          .sort(compareRanked),
      }))
      .filter((project) => project.visible.length > 0)
      .sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    const count = visibleProjects.reduce((sum, project) => sum + project.visible.length, 0);
    matched += count;
    if (searching && count === 0) continue;

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
      rows.push({ type: "note", key: `${hKey}#filtered`, text: filter === "inbox" ? "Nothing new" : filter === "active" ? "Nothing active or new" : "Nothing matches" });
      continue;
    }
    for (const project of visibleProjects) {
      const pKey = projectKey(host.serverId, project.id);
      const projectCollapsed = searching ? false : isCollapsed(collapse, pKey, settings);
      rows.push({ type: "project", key: pKey, serverId: host.serverId, projectId: project.id, name: project.name, collapsed: projectCollapsed, count: project.visible.length, tally: project.tally });
      if (projectCollapsed) continue;
      for (const item of project.visible) {
        rows.push({
          type: "workspace",
          key: `ws:${host.serverId}:${item.workspace.id}`,
          serverId: host.serverId,
          hostLabel: host.label,
          workspace: item.workspace,
          state: item.state,
          modelShort: shortenModel(item.workspace.model),
        });
      }
    }
  }

  return {
    rows,
    matched,
    tally: total,
    counts,
    groupKeys,
    emptyBecauseFiltered: matched === 0 && totalOnline > 0 && (searching || filter !== "all"),
  };
}

/** Totals for the badges: real prompts and unread news on online hosts, ignoring filters. */
export function tallyHosts(hosts: readonly HostInput[], reads: ReadMap): Tally {
  const tally: Tally = { needsYou: 0, unread: 0 };
  for (const host of hosts) {
    if (host.status !== "online") continue;
    for (const workspace of host.workspaces) addTally(tally, workspaceState(workspace, host.serverId, reads));
  }
  return tally;
}
