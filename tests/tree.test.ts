import { describe, expect, it } from "vitest";
import { defaultSettings } from "../shared/profiles";
import { readKey } from "../shared/reads";
import { buildTree, matchesSearch, passesFilter, tallyHosts, workspaceState, type TreeOptions } from "../shared/tree";
import type { HostInput, WorkspaceInput } from "../shared/types";

const NOW = 1_000_000_000_000;
const min = (m: number) => NOW - m * 60_000;

/** A workspace; `news` gives it unread output from that many minutes ago. */
function ws(id: string, projectId: string, status: WorkspaceInput["status"], activityMinutes: number, extra: Partial<WorkspaceInput> & { news?: number } = {}): WorkspaceInput {
  const { news, ...rest } = extra;
  return {
    id, projectId, projectName: projectId.toUpperCase(), title: `title ${id}`, status,
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
  it("active = running, new or asking; inbox = new or asking", () => {
    expect(passesFilter(item(ws("1", "p", "done", 1)), "active", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "running", 1)), "active", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "running", 1)), "inbox", settings, NOW)).toBe(false);
    expect(passesFilter(item(ws("1", "p", "attention", 1, { news: 1 })), "inbox", settings, NOW)).toBe(true);
    expect(passesFilter(item(ws("1", "p", "attention", 1, { news: 5 }), { [readKey("h", "1")]: NOW }), "inbox", settings, NOW)).toBe(false);
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
    expect(tree.counts).toEqual({ all: 2, active: 1, inbox: 1 });
  });
  it("reports empty because filtered", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ filter: "inbox" }));
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
  it("tallies asking and unread per project, host and overall", () => {
    const tree = buildTree([host("h", [ws("1", "p", "needs_input", 1), ws("2", "p", "attention", 1, { news: 1 }), ws("3", "q", "failed", 1, { news: 1 })])], opts({ collapse: { "proj:h:p": true } }));
    const proj = tree.rows.find((r) => r.type === "project" && r.projectId === "p");
    expect(proj?.type === "project" && proj.tally).toEqual({ needsYou: 1, unread: 1 });
    const h = tree.rows[0];
    expect(h?.type === "host" && h.tally).toEqual({ needsYou: 1, unread: 2 });
    expect(tree.tally).toEqual({ needsYou: 1, unread: 2 });
  });
  it("renders loading skeletons per host and offline hosts dimmed", () => {
    const tree = buildTree([host("l", [], { loading: true }), host("o", [], { status: "offline" })], opts());
    expect(types(tree.rows)).toEqual(["host", "skeleton", "skeleton", "skeleton", "host"]);
  });
  it("shows a note for hosts without workspaces", () => {
    expect(types(buildTree([host("h", [])], opts()).rows)).toEqual(["host", "note"]);
  });
  it("hides hosts listed in hiddenHosts", () => {
    expect(buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ settings: { ...settings, hiddenHosts: ["h"] } })).rows).toHaveLength(0);
  });
  it("shortens the model and collects group keys", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts());
    const row = tree.rows.find((r) => r.type === "workspace");
    expect(row?.type === "workspace" && row.modelShort).toBe("claude-sonnet-4-5");
    expect(tree.groupKeys).toEqual(["host:h", "proj:h:p"]);
  });
  it("badge tally covers online hosts only and respects reads", () => {
    const hosts = [host("a", [ws("1", "p", "failed", 1, { news: 1 }), ws("2", "p", "needs_input", 1), ws("3", "p", "running", 1)]), host("b", [ws("4", "p", "attention", 1, { news: 1 })], { status: "offline" })];
    expect(tallyHosts(hosts, {})).toEqual({ needsYou: 1, unread: 1 });
    expect(tallyHosts(hosts, { [readKey("a", "1")]: NOW })).toEqual({ needsYou: 1, unread: 0 });
  });
});
