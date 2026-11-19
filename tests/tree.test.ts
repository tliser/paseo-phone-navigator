import { describe, expect, it } from "vitest";
import { defaultSettings } from "../shared/profiles";
import { readAgentKey, readKey, recentKey } from "../shared/reads";
import { buildTree, matchesSearch, passesFilter, workspaceState, type TreeOptions } from "../shared/tree";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";
import { dragId } from "../shared/drag";

const NOW = 1_000_000_000_000;
const min = (m: number) => NOW - m * 60_000;

/** A workspace; `news` gives it unread output from that many minutes ago. */
function ws(id: string, projectId: string, status: WorkspaceInput["status"], activityMinutes: number, extra: Partial<WorkspaceInput> & { news?: number } = {}): WorkspaceInput {
  const { news, ...rest } = extra;
  return {
    id, projectId, projectName: projectId.toUpperCase(), projectKind: "git", projectRootPath: `/p/${projectId}`, title: `title ${id}`, status,
    needsYou: status === "needs_input", unreadAt: news !== undefined ? min(news) : 0,
    branch: `br-${id}`, additions: 1, deletions: 2, activityAt: min(activityMinutes), orderAt: min(activityMinutes),
    model: "anthropic/claude-sonnet-4-5-20250929", ...rest,
  };
}
function host(serverId: string, workspaces: WorkspaceInput[], extra: Partial<HostInput> = {}): HostInput {
  return { serverId, label: serverId, status: "online", loading: false, error: null, workspaces, ...extra };
}
const settings = { ...defaultSettings(), newGroupsExpanded: { hosts: true, projects: true } };
const opts = (o: Partial<TreeOptions> = {}): TreeOptions => ({ filter: "all", query: "", settings, collapse: {}, reads: {}, now: NOW, ...o });
const types = (rows: { type: string }[]) => rows.map((r) => r.type);
const wsIds = (rows: ReturnType<typeof buildTree>["rows"]) => rows.flatMap((r) => (r.type === "workspace" ? [r.workspace.id] : []));
function chat(id: string, status: AgentInput["status"], extra: Partial<AgentInput> = {}): AgentInput {
  return { id, title: `chat ${id}`, model: null, status, parentId: null, activityAt: 1, unreadAt: 0, ...extra };
}
const item = (w: WorkspaceInput, reads = {}) => ({ workspace: w, state: workspaceState(w, "h", reads) });

describe("workspace state (asking vs unread vs read)", () => {
  it("only a real prompt is 'needs you'", () => {
    expect(workspaceState(ws("1", "p", "needs_input", 1), "h", {})).toBe("needs_you");
    expect(workspaceState(ws("1", "p", "attention", 1, { news: 5 }), "h", {})).toBe("unread");
    expect(workspaceState(ws("1", "p", "done", 1, { needsYou: true }), "h", {})).toBe("needs_you"); // a sub-agent asks
  });
  it("viewing after the news makes it read; new output later makes it unread again", () => {
    const w = ws("1", "p", "attention", 1, { news: 10 });
    expect(workspaceState(w, "h", { [readKey("h", "1")]: min(5) })).toBe("read");
    expect(workspaceState(w, "h", { [readKey("h", "1")]: min(20) })).toBe("unread");
  });
  it("a prompt stays even after viewing", () => {
    expect(workspaceState(ws("1", "p", "needs_input", 1, { news: 10 }), "h", { [readKey("h", "1")]: NOW })).toBe("needs_you");
  });
  it("running beats unread; reads are per host", () => {
    expect(workspaceState(ws("1", "p", "running", 1, { news: 10 }), "h", {})).toBe("running");
    expect(workspaceState(ws("1", "p", "attention", 1, { news: 10 }), "h", { [readKey("other", "1")]: NOW })).toBe("unread");
  });
});

describe("sorting", () => {
  it("orders by your newest prompt or creation; status and agent output do not move rows", () => {
    const tree = buildTree(
      [host("h", [ws("asks", "p", "needs_input", 1, { orderAt: min(300) }), ws("fresh", "p", "done", 500, { orderAt: min(10) }), ws("busy", "p", "running", 0, { orderAt: min(100) })])],
      opts(),
    );
    expect(wsIds(tree.rows)).toEqual(["fresh", "busy", "asks"]);
  });
  it("orders projects by the newest prompt of any workspace, even filtered ones", () => {
    const tree = buildTree([host("h", [ws("1", "old", "running", 0, { orderAt: min(100) }), ws("2", "new", "running", 0, { orderAt: min(200) }), ws("3", "new", "done", 0, { orderAt: min(1) })])], opts({ filter: "active" }));
    expect(tree.rows.flatMap((r) => (r.type === "project" ? [r.projectId] : []))).toEqual(["new", "old"]);
  });
  it("puts offline hosts last and respects configured order", () => {
    const tree = buildTree([host("off", [], { status: "offline" }), host("b", [ws("1", "p", "done", 1)]), host("a", [ws("2", "p", "done", 1)])], opts({ hostOrder: ["off", "a", "b"] }));
    expect(tree.rows.filter((r) => r.type === "host").map((r) => (r as { serverId: string }).serverId)).toEqual(["a", "b", "off"]);
  });
});

describe("filters and search", () => {
  it("active = running, unread or needing you", () => {
    expect(passesFilter(item(ws("1", "p", "done", 1)), "active", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "running", 1)), "active", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "attention", 1, { news: 5 })), "active", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "attention", 1, { news: 5 }), { [readKey("h", "1")]: NOW }), "active", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "needs_input", 1)), "active", settings, NOW)).toBe(true);
  });
  it("recent = active within the configured days, plus anything running, new or asking", () => {
    const day = 60 * 24;
    expect(passesFilter(item(ws("1", "p", "done", day + 60)), "recent", settings, NOW)).toBe(true); // default 2 days
    expect(passesFilter(item(ws("1", "p", "done", 2 * day + 60)), "recent", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "done", 2 * day + 60)), "recent", { ...settings, recentDays: 7 }, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "running", 30 * day)), "recent", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "needs_input", 30 * day)), "recent", settings, NOW)).toBe(true);
    const tree = buildTree([host("h", [ws("new", "p", "done", 60), ws("old", "p", "done", 5 * day)])], opts({ filter: "recent" }));
    expect(wsIds(tree.rows)).toEqual(["new"]);
    expect(tree.counts).toMatchObject({ all: 2, recent: 1 });
  });
  it("a workspace you removed from Recent stays out until you prompt it again or it asks you", () => {
    const reads = { [recentKey("h", "off")]: min(5) };
    const tree = (off: WorkspaceInput) => buildTree([host("h", [ws("keep", "p", "done", 60), off])], opts({ filter: "recent", reads }));
    const removed = tree(ws("off", "p", "running", 1, { orderAt: min(10) }));
    expect(wsIds(removed.rows)).toEqual(["keep"]);
    expect(removed.counts).toMatchObject({ all: 2, recent: 1 });
    expect(wsIds(tree(ws("off", "p", "done", 1, { orderAt: min(1) })).rows)).toContain("off");
    expect(wsIds(tree(ws("off", "p", "needs_input", 1, { orderAt: min(10) })).rows)).toContain("off");
    expect(wsIds(buildTree([host("h", [ws("off", "p", "done", 1, { orderAt: min(10) })])], opts({ reads: { [recentKey("h", "off")]: -min(1) }, filter: "recent" })).rows)).toContain("off");
  });
  it("hides old read workspaces when hideDone is set, never unread ones", () => {
    const s = { ...settings, hideDone: "1d" as const };
    expect(passesFilter(item(ws("1", "p", "done", 60 * 30)), "all", s, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "done", 60)), "all", s, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "attention", 60 * 30, { news: 60 * 30 })), "all", s, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "running", 60 * 24 * 30)), "all", s, NOW)).toBe(true);
  });
  it("searches title, branch, project, host and short model, case-insensitive", () => {
    const w = ws("1", "proj", "done", 1, { title: "Fix Sidebar", branch: "feat/x", model: "openai/gpt-5.4" });
    for (const q of ["sidebar", "FEAT/X", "PROJ", "tardis", "gpt-5", "fix tardis"]) expect(matchesSearch(w, "tardis", q)).toBe(true);
    expect(matchesSearch(w, "tardis", "openai")).toBe(false);
    expect(matchesSearch(w, "tardis", "sidebar nope")).toBe(false);
  });
  it("search expands collapsed groups without changing the map and keeps structure", () => {
    const collapse = { "proj:h:p": true };
    const tree = buildTree([host("h", [ws("1", "p", "done", 1, { title: "alpha" }), ws("2", "q", "done", 1, { title: "beta" })])], opts({ query: "alpha", collapse }));
    expect(types(tree.rows)).toEqual(["project", "workspace"]);
    expect(collapse).toEqual({ "proj:h:p": true });
  });
  it("drops hosts without matches and offline hosts while searching", () => {
    const tree = buildTree([host("a", [ws("1", "p", "done", 1, { title: "alpha" })]), host("b", [ws("2", "p", "done", 1)]), host("off", [], { status: "offline" })], opts({ query: "alpha" }));
    expect(tree.rows.filter((r) => r.type === "host")).toHaveLength(1);
  });
  it("counts per filter honor the search", () => {
    const tree = buildTree([host("h", [ws("1", "p", "running", 1, { title: "x" }), ws("2", "p", "failed", 1, { title: "x", news: 1 }), ws("3", "p", "running", 1, { title: "y" })])], opts({ query: "x" }));
    expect(tree.counts).toEqual({ all: 2, recent: 2, active: 2, pinned: 0 });
  });
  it("reports empty because filtered", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ filter: "active" }));
    expect(tree.emptyBecauseFiltered).toBe(true);
    expect(types(tree.rows)).toEqual(["note"]);
  });
});

describe("tree shape", () => {
  it("respects collapse and defaults", () => {
    const tree = buildTree([host("h", [ws("1", "p", "running", 1)])], opts({ settings: defaultSettings() }));
    expect(types(tree.rows)).toEqual(["project"]);
    const two = [host("h", [ws("1", "p", "running", 1)]), host("k", [ws("2", "p", "running", 1)])];
    expect(types(buildTree(two, opts({ collapse: { "host:h": true } })).rows)).toEqual(["host", "host", "project", "workspace"]);
  });
  it("tallies asking and unread per project and host", () => {
    const tree = buildTree([host("h", [ws("1", "p", "needs_input", 1), ws("2", "p", "attention", 1, { news: 1 }), ws("3", "q", "failed", 1, { news: 1 })])], opts({ collapse: { "proj:h:p": true } }));
    const proj = tree.rows.find((r) => r.type === "project" && r.projectId === "p");
    expect(proj?.type === "project" && proj.tally).toEqual({ asking: 1, error: 0, unread: 1 });
    expect(tree.hosts[0]?.tally).toEqual({ asking: 1, error: 0, unread: 2 });
  });
  it("renders loading skeletons per host and offline hosts dimmed", () => {
    const tree = buildTree([host("l", [], { loading: true }), host("o", [], { status: "offline" })], opts());
    expect(types(tree.rows)).toEqual(["host", "skeleton", "skeleton", "skeleton", "host"]);
  });
  it("host rows only separate several hosts; one chosen host drops them and the others", () => {
    const both = [host("a", [ws("1", "p", "needs_input", 1)]), host("b", [ws("2", "p", "done", 1)]), host("off", [], { status: "offline" })];
    const all = buildTree(both, opts());
    expect(types(all.rows)).toEqual(["host", "project", "workspace", "host", "project", "workspace", "host"]);
    const onlyB = buildTree(both, opts({ hostView: "b" }));
    expect(onlyB.hostView).toBe("b");
    expect(types(onlyB.rows)).toEqual(["project", "workspace"]);
    expect(wsIds(onlyB.rows)).toEqual(["2"]);
    expect(onlyB.counts.all).toBe(1);
    // The host list still covers every host, with what waits there.
    expect(onlyB.hosts.map((h) => [h.serverId, h.state, h.tally.asking])).toEqual([["a", "online", 1], ["b", "online", 0], ["off", "offline", 0]]);
    expect(types(buildTree(both, opts({ hostView: "off" })).rows)).toEqual(["note"]);
    // A host that is gone (or hidden) falls back to all.
    expect(buildTree(both, opts({ hostView: "gone" })).hostView).toBeNull();
  });
  it("hides hosts listed in hiddenHosts", () => {
    expect(buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ settings: { ...settings, hiddenHosts: ["h"] } })).rows).toHaveLength(0);
  });
});

describe("manual order", () => {
  const manual = { ...settings, sort: "manual" as const };
  const tree = (order: Record<string, string[]>, extra: Partial<TreeOptions> = {}) =>
    buildTree([host("h", [ws("a", "p", "done", 1), ws("b", "p", "needs_input", 50), ws("c", "q", "running", 100)])], opts({ settings: manual, order, ...extra }));

  it("orders projects and workspaces as saved; status does not move them", () => {
    const t = tree({ "host:h": ["q", "p"], "proj:h:p": ["a", "b"] });
    expect(t.rows.flatMap((r) => (r.type === "project" ? [r.projectId] : []))).toEqual(["q", "p"]);
    expect(wsIds(t.rows)).toEqual(["c", "a", "b"]);
  });
  it("new items appear first in their group", () => {
    expect(wsIds(tree({ "proj:h:p": ["a"] }).rows)).toEqual(["b", "a", "c"]);
  });
  it("auto mode ignores a saved order", () => {
    const t = buildTree([host("h", [ws("a", "p", "done", 1), ws("b", "p", "needs_input", 50)])], opts({ order: { "proj:h:p": ["b", "a"] } }));
    expect(wsIds(t.rows)).toEqual(["a", "b"]);
  });
  it("exposes complete groups even when a filter hides items", () => {
    const t = tree({ "proj:h:p": ["a", "b"] }, { filter: "pinned", pins: new Set(["h:b"]) });
    expect(wsIds(t.rows)).toEqual(["b"]);
    expect(t.groups["proj:h:p"]).toEqual(["a", "b"]);
    expect(t.groups["host:h"]).toEqual(["p", "q"]);
    const row = t.rows.find((r) => r.type === "workspace");
    expect(row?.type === "workspace" && row.group).toBe("proj:h:p");
  });
});

describe("pins", () => {
  const hosts = () => [host("h", [ws("a", "p", "done", 1), ws("b", "p", "running", 5), ws("old", "p", "done", 60 * 24 * 30)])];
  it("show only in Pinned and All; All keeps them when old finished ones are hidden", () => {
    const view = (filter: "all" | "active" | "recent") => buildTree(hosts(), opts({ pins: new Set(["h:old"]), settings: { ...settings, hideDone: "7d" }, filter }));
    expect(wsIds(view("all").rows)).toEqual(["a", "b", "old"]);
    expect(view("all").counts).toMatchObject({ all: 3, active: 1, recent: 2, pinned: 1 });
    expect(wsIds(view("active").rows)).toEqual(["b"]);
    expect(wsIds(view("recent").rows)).toEqual(["a", "b"]);
  });
  it("the Pinned view shows only pinned workspaces", () => {
    const tree = buildTree(hosts(), opts({ pins: new Set(["h:a"]), filter: "pinned" }));
    expect(wsIds(tree.rows)).toEqual(["a"]);
    expect(tree.counts.pinned).toBe(1);
  });
});

describe("tab rows", () => {
  const tabs = [
    chat("main", "running", { title: "Main", model: "anthropic/claude-opus-4-6" }),
    chat("sub", "asking", { title: "Helper", parentId: "main" }),
    chat("orphan", "idle", { title: "Orphan", parentId: "gone" }),
    chat("a", "finished", { title: "A", unreadAt: min(1) }),
    chat("b", "idle"),
    chat("c", "idle"),
  ];
  const hosts = () => [host("h", [ws("w", "p", "running", 1, { agents: tabs, terminals: [{ id: "t1", title: "Terminal 1" }] })])];
  it("are folded by default and summed up as urgent-first marks, capped at 4", () => {
    const row = buildTree(hosts(), opts()).rows[1];
    expect(row?.type === "workspace" && row.tabs).toMatchObject({
      key: "agents:h:w",
      open: false,
      marks: ["unread", "running", "read"],
      more: 3,
      summary: "6 tabs: 1 unread, 1 running, 3 read, 1 terminal; 1 sub-agent",
    });
  });
  it("unfold with sub-agents under their parent, folded until opened; a sub-agent without its parent is a top-level tab", () => {
    const shown = (collapse: Record<string, boolean>) =>
      buildTree(hosts(), opts({ collapse: { "agents:h:w": false, ...collapse } })).rows.flatMap((r) => (r.type === "tab" ? [`${r.depth}:${r.id}`] : []));
    expect(shown({})).toEqual(["0:main", "0:orphan", "0:a", "0:b", "0:c", "0:t1"]);
    expect(shown({ "subagents:h:w:main": false })).toEqual(["0:main", "1:sub", "0:orphan", "0:a", "0:b", "0:c", "0:t1"]);
    const main = buildTree(hosts(), opts({ collapse: { "agents:h:w": false } })).rows.find((r) => r.type === "tab" && r.id === "main");
    expect(main?.type === "tab" && main.subagents).toEqual({ key: "subagents:h:w:main", open: false, count: 1, waiting: 1 });
  });
  it("the status line names the chat that asks you", () => {
    const row = buildTree(hosts(), opts()).rows[1];
    expect(row?.type === "workspace" && row.reason).toEqual({ state: "asking", title: "Helper" });
  });
  it("a workspace with a single tab has no tab level, unless that tab has sub-agents", () => {
    const only = (agents: AgentInput[], terminals: { id: string; title: string }[] = []) =>
      buildTree([host("h", [ws("w", "p", "running", 1, { agents, terminals })])], opts({ collapse: { "agents:h:w": false } })).rows;
    const lone = only([chat("main", "running")]);
    expect(lone[1]?.type === "workspace" && lone[1].tabs).toBeFalsy();
    expect(lone.some((r) => r.type === "tab")).toBe(false);
    expect(only([], [{ id: "t1", title: "Terminal 1" }]).some((r) => r.type === "tab")).toBe(false);
    const parent = only([chat("main", "running"), chat("sub", "idle", { parentId: "main" })]);
    expect(parent[1]?.type === "workspace" && parent[1].tabs).toBeTruthy();
  });
  it("tab and terminal titles are searchable", () => {
    expect(wsIds(buildTree(hosts(), opts({ query: "orphan" })).rows)).toEqual(["w"]);
    const row = buildTree(hosts(), opts({ query: "terminal 1" })).rows[1];
    expect(row?.type === "workspace" && row.matchedTab).toEqual({ title: "Terminal 1", kind: "terminal" });
  });
});

describe("agent errors", () => {
  it("an errored agent needs you: own state, shows in Active", () => {
    const w = ws("e", "p", "done", 1, { agentError: true });
    expect(workspaceState(w, "h", {})).toBe("error");
    expect(passesFilter(item(w), "active", settings, NOW)).toBe(true);
    // A real question still wins over the error.
    expect(workspaceState(ws("q", "p", "needs_input", 1, { agentError: true }), "h", {})).toBe("needs_you");
  });
});

describe("read state per chat", () => {
  const chats = [chat("c1", "finished", { unreadAt: min(5) }), chat("c2", "finished", { unreadAt: min(5) })];
  it("Done on one chat leaves its sibling unread, so the workspace stays unread", () => {
    const w = ws("w", "p", "attention", 1, { agents: chats });
    expect(workspaceState(w, "h", { [readAgentKey("h", "c1")]: NOW })).toBe("unread");
    expect(workspaceState(w, "h", { [readAgentKey("h", "c1")]: NOW, [readAgentKey("h", "c2")]: NOW })).toBe("read");
  });
  it("a working chat is not in the Inbox, even when put back there before", () => {
    const w = ws("w", "p", "running", 1, { agents: [chat("c", "running")] });
    expect(workspaceState(w, "h", { [readAgentKey("h", "c")]: -NOW })).toBe("running");
  });
  it("an unread sub-agent alone does not make the workspace unread", () => {
    const w = ws("w", "p", "done", 1, { agents: [chat("m", "idle"), chat("s", "finished", { parentId: "m", unreadAt: min(2) })] });
    expect(workspaceState(w, "h", {})).toBe("read");
  });
  it("an asking sub-agent makes the workspace ask you", () => {
    const w = ws("w", "p", "running", 1, { agents: [chat("m", "running"), chat("s", "asking", { parentId: "m" })] });
    expect(workspaceState(w, "h", {})).toBe("needs_you");
  });
});

describe("search reasons", () => {
  it("a project-name hit lists the project even without matching workspaces", () => {
    const tree = buildTree([host("h", [ws("1", "atlas", "done", 1)])], opts({ query: "ATLAS", filter: "active" }));
    expect(types(tree.rows)).toEqual(["project", "note"]);
  });
  it("a hit only through a tab says which tab", () => {
    const w = ws("1", "p", "done", 1, { agents: [chat("m", "idle", { title: "Main" }), chat("s", "idle", { title: "Contrast check", parentId: "m" })] });
    const tree = buildTree([host("h", [w])], opts({ query: "contrast" }));
    const row = tree.rows.find((r) => r.type === "workspace");
    expect(row?.type === "workspace" && row.matchedTab).toEqual({ title: "Contrast check", kind: "sub-agent" });
    const own = buildTree([host("h", [w])], opts({ query: "title" })).rows.find((r) => r.type === "workspace");
    expect(own?.type === "workspace" && own.matchedTab).toBeUndefined();
  });
});
