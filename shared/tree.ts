// Builds the flattened tree the FlatList renders. Pure.
import { shortenModel } from "./format";
import { hostKey, isCollapsed, projectKey, type CollapseMap, type ProfileSettings } from "./profiles";
import { isAttention, type Filter, type HostInput, type WorkspaceInput, type WorkspaceStatus } from "./types";

const DAY_MS = 86_400_000;

export interface HostRow {
  type: "host";
  key: string;
  serverId: string;
  label: string;
  state: "online" | "offline" | "loading";
  collapsed: boolean;
  /** Workspaces shown under this host after filter and search. */
  count: number;
  attention: number;
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
  /** Attention inside, for the red dot on collapsed projects. */
  attention: number;
}
export interface WorkspaceRow {
  type: "workspace";
  key: string;
  serverId: string;
  hostLabel: string;
  workspace: WorkspaceInput;
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
  /** Attention workspaces on online, visible hosts (ignores filter and search). */
  attention: number;
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
  now: number;
  /** Host order as configured in the app. */
  hostOrder?: readonly string[];
}

/** attention/failed/needs_input first, then running, then the rest, done last. */
export function statusRank(status: WorkspaceStatus): number {
  if (isAttention(status)) return 0;
  if (status === "running") return 1;
  if (status === "done") return 3;
  return 2;
}

export function compareWorkspaces(a: WorkspaceInput, b: WorkspaceInput): number {
  return (
    statusRank(a.status) - statusRank(b.status) ||
    b.activityAt - a.activityAt ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

export function passesFilter(workspace: WorkspaceInput, filter: Filter, settings: ProfileSettings, now: number): boolean {
  if (workspace.status === "done" && settings.hideDone !== "off") {
    const limit = (settings.hideDone === "1d" ? 1 : 7) * DAY_MS;
    if (!workspace.activityAt || now - workspace.activityAt > limit) return false;
  }
  if (filter === "active") return workspace.status !== "done";
  if (filter === "attention") return isAttention(workspace.status);
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

export function buildTree(hosts: readonly HostInput[], options: TreeOptions): TreeResult {
  const { filter, settings, collapse, now } = options;
  const query = options.query.trim();
  const searching = query.length > 0;
  const hidden = new Set(settings.hiddenHosts);
  const rows: TreeRow[] = [];
  const groupKeys: string[] = [];
  const counts: Record<Filter, number> = { all: 0, active: 0, attention: 0 };
  let matched = 0;
  let attention = 0;
  let totalOnline = 0;

  for (const host of orderHosts(hosts.filter((host) => !hidden.has(host.serverId)), options.hostOrder)) {
    const hKey = hostKey(host.serverId);
    if (host.status !== "online") {
      // Offline hosts: dimmed, not expandable, left out of search results.
      if (!searching) {
        rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "offline", collapsed: true, count: 0, attention: 0, error: host.error });
      }
      continue;
    }
    if (host.loading) {
      rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "loading", collapsed: false, count: 0, attention: 0, error: null });
      for (let i = 0; i < 3; i++) rows.push({ type: "skeleton", key: `${hKey}#skel${i}` });
      continue;
    }

    const hostAttention = host.workspaces.filter((workspace) => isAttention(workspace.status)).length;
    attention += hostAttention;
    totalOnline += host.workspaces.length;

    // Group by project, keeping each project's activity from all its workspaces (filtering must not change rank).
    const projects = new Map<string, { id: string; name: string; activity: number; all: WorkspaceInput[] }>();
    for (const workspace of host.workspaces) {
      let project = projects.get(workspace.projectId);
      if (!project) {
        project = { id: workspace.projectId, name: workspace.projectName, activity: 0, all: [] };
        projects.set(workspace.projectId, project);
      }
      project.all.push(workspace);
      project.activity = Math.max(project.activity, workspace.activityAt);
      if (matchesSearch(workspace, host.label, query)) {
        for (const key of ["all", "active", "attention"] as const) {
          if (passesFilter(workspace, key, settings, now)) counts[key]++;
        }
      }
    }

    const visibleProjects = [...projects.values()]
      .map((project) => ({
        ...project,
        visible: project.all
          .filter((workspace) => passesFilter(workspace, filter, settings, now) && matchesSearch(workspace, host.label, query))
          .sort(compareWorkspaces),
        attention: project.all.filter((workspace) => isAttention(workspace.status)).length,
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
    rows.push({ type: "host", key: hKey, serverId: host.serverId, label: host.label, state: "online", collapsed: hostCollapsed, count, attention: hostAttention, error: host.error });
    if (hostCollapsed) continue;

    if (host.workspaces.length === 0) {
      rows.push({ type: "note", key: `${hKey}#empty`, text: "No workspaces" });
      continue;
    }
    if (visibleProjects.length === 0) {
      rows.push({ type: "note", key: `${hKey}#filtered`, text: filter === "all" ? "Nothing matches" : `No ${filter} workspaces` });
      continue;
    }
    for (const project of visibleProjects) {
      const pKey = projectKey(host.serverId, project.id);
      const projectCollapsed = searching ? false : isCollapsed(collapse, pKey, settings);
      rows.push({ type: "project", key: pKey, serverId: host.serverId, projectId: project.id, name: project.name, collapsed: projectCollapsed, count: project.visible.length, attention: project.attention });
      if (projectCollapsed) continue;
      for (const workspace of project.visible) {
        rows.push({
          type: "workspace",
          key: `ws:${host.serverId}:${workspace.id}`,
          serverId: host.serverId,
          hostLabel: host.label,
          workspace,
          modelShort: shortenModel(workspace.model),
        });
      }
    }
  }

  return {
    rows,
    matched,
    attention,
    counts,
    groupKeys,
    emptyBecauseFiltered: matched === 0 && totalOnline > 0 && (searching || filter !== "all"),
  };
}

/** Attention count for the badge: needs_input + failed + attention on online hosts, ignoring filters. */
export function attentionCount(hosts: readonly HostInput[]): number {
  let count = 0;
  for (const host of hosts) {
    if (host.status !== "online") continue;
    for (const workspace of host.workspaces) if (isAttention(workspace.status)) count++;
  }
  return count;
}
