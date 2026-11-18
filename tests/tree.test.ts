import { describe, expect, it } from "vitest";
import { defaultSettings } from "../shared/profiles";
import { readAgentKey, readKey } from "../shared/reads";
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
    branch: `br-${id}`, additions: 1, deletions: 2, activityAt: min(activityMinutes),
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
  it("orders asking, unread, running, the rest; then recent first", () => {
    const tree = buildTree([host("h", [ws("d", "p", "done", 1), ws("r", "p", "running", 50), ws("u", "p", "attention", 100, { news: 100 }), ws("n", "p", "needs_input", 10), ws("r2", "p", "running", 5), ws("f", "p", "failed", 3, { news: 3 })])], opts());
    expect(wsIds(tree.rows)).toEqual(["n", "f", "u", "r2", "r", "d"]);
  });
  it("a read 'attention' workspace drops to the bottom", () => {
    const reads = { [readKey("h", "u")]: NOW };
    const tree = buildTree([host("h", [ws("u", "p", "attention", 1, { news: 5 }), ws("d", "p", "done", 30)])], opts({ reads }));
    expect(wsIds(tree.rows)).toEqual(["u", "d"]); // same rank: more recent first
    const row = tree.rows.find((r) => r.type === "workspace" && r.workspace.id === "u");
    expect(row?.type === "workspace" && row.state).toBe("read");
  });
  it("orders projects by latest activity of any workspace, even filtered ones", () => {
    const tree = buildTree([host("h", [ws("1", "old", "running", 100), ws("2", "new", "running", 200), ws("3", "new", "done", 1)])], opts({ filter: "active" }));
    expect(tree.rows.flatMap((r) => (r.type === "project" ? [r.projectId] : []))).toEqual(["new", "old"]);
  });
  it("puts offline hosts last and respects configured order", () => {
    const tree = buildTree([host("off", [], { status: "offline" }), host("b", [ws("1", "p", "done", 1)]), host("a", [ws("2", "p", "done", 1)])], opts({ hostOrder: ["off", "a", "b"] }));
    expect(tree.rows.filter((r) => r.type === "host").map((r) => (r as { serverId: string }).serverId)).toEqual(["a", "b", "off"]);
  });
});

describe("filters and search", () => {
  it("active = running, new or asking", () => {
    expect(passesFilter(item(ws("1", "p", "done", 1)), "active", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "running", 1)), "active", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "attention", 1, { news: 5 }), { [readKey("h", "1")]: NOW }), "active", settings, NOW)).toBe(false);
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
    const collapse = { "host:h": true };
    const tree = buildTree([host("h", [ws("1", "p", "done", 1, { title: "alpha" }), ws("2", "q", "done", 1, { title: "beta" })])], opts({ query: "alpha", collapse }));
    expect(types(tree.rows)).toEqual(["host", "project", "workspace"]);
    expect(collapse).toEqual({ "host:h": true });
  });
  it("drops hosts without matches and offline hosts while searching", () => {
    const tree = buildTree([host("a", [ws("1", "p", "done", 1, { title: "alpha" })]), host("b", [ws("2", "p", "done", 1)]), host("off", [], { status: "offline" })], opts({ query: "alpha" }));
    expect(tree.rows.filter((r) => r.type === "host")).toHaveLength(1);
  });
  it("counts per filter honor the search", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1, { title: "x" }), ws("2", "p", "failed", 1, { title: "x", news: 1 }), ws("3", "p", "running", 1, { title: "y" })])], opts({ query: "x" }));
    expect(tree.counts).toEqual({ all: 2, recent: 2, active: 1, pinned: 0 });
  });
  it("reports empty because filtered", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ filter: "active" }));
    expect(tree.emptyBecauseFiltered).toBe(true);
    expect(types(tree.rows)).toEqual(["host", "note"]);
  });
});

describe("tree shape", () => {
  it("respects collapse and defaults", () => {
    const tree = buildTree([host("h", [ws("1", "p", "running", 1)])], opts({ settings: defaultSettings() }));
    expect(types(tree.rows)).toEqual(["host", "project"]);
    expect(types(buildTree([host("h", [ws("1", "p", "running", 1)])], opts({ collapse: { "host:h": true } })).rows)).toEqual(["host"]);
  });
  it("tallies asking and unread per project and host", () => {
    const tree = buildTree([host("h", [ws("1", "p", "needs_input", 1), ws("2", "p", "attention", 1, { news: 1 }), ws("3", "q", "failed", 1, { news: 1 })])], opts({ collapse: { "proj:h:p": true } }));
    const proj = tree.rows.find((r) => r.type === "project" && r.projectId === "p");
    expect(proj?.type === "project" && proj.tally).toEqual({ asking: 1, error: 0, unread: 1 });
    const h = tree.rows[0];
    expect(h?.type === "host" && h.tally).toEqual({ asking: 1, error: 0, unread: 2 });
  });
  it("renders loading skeletons per host and offline hosts dimmed", () => {
    const tree = buildTree([host("l", [], { loading: true }), host("o", [], { status: "offline" })], opts());
    expect(types(tree.rows)).toEqual(["host", "skeleton", "skeleton", "skeleton", "host"]);
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
    const t = buildTree([host("h", [ws("a", "p", "done", 1), ws("b", "p", "needs_input", 50)])], opts({ order: { "proj:h:p": ["a", "b"] } }));
    expect(wsIds(t.rows)).toEqual(["b", "a"]);
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
  it("pass every view in their project, even when old finished ones are hidden", () => {
    const tree = buildTree(hosts(), opts({ pins: new Set(["h:old"]), settings: { ...settings, hideDone: "7d" }, filter: "active" }));
    expect(wsIds(tree.rows)).toEqual(["b", "old"]);
    const pinned = tree.rows.find((r) => r.type === "workspace" && r.workspace.id === "old");
    expect(pinned?.type === "workspace" && pinned.pinned).toBe(true);
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
    const row = buildTree(hosts(), opts()).rows[2];
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
    const row = buildTree(hosts(), opts()).rows[2];
    expect(row?.type === "workspace" && row.reason).toEqual({ state: "asking", title: "Helper" });
  });
  it("tab and terminal titles are searchable", () => {
    expect(wsIds(buildTree(hosts(), opts({ query: "orphan" })).rows)).toEqual(["w"]);
    const row = buildTree(hosts(), opts({ query: "terminal 1" })).rows[2];
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
  it("an asking sub-agent makes the workspace ask you", () => {
    const w = ws("w", "p", "running", 1, { agents: [chat("m", "running"), chat("s", "asking", { parentId: "m" })] });
    expect(workspaceState(w, "h", {})).toBe("needs_you");
  });
});

describe("search reasons", () => {
  it("a project-name hit lists the project even without matching workspaces", () => {
    const tree = buildTree([host("h", [ws("1", "atlas", "done", 1)])], opts({ query: "ATLAS", filter: "active" }));
    expect(types(tree.rows)).toEqual(["host", "project", "note"]);
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
