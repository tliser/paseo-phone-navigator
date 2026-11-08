import { describe, expect, it } from "vitest";
import { defaultSettings } from "../shared/profiles";
import { attentionCount, buildTree, compareWorkspaces, matchesSearch, passesFilter, type TreeOptions } from "../shared/tree";
import type { HostInput, WorkspaceInput } from "../shared/types";

const NOW = 1_000_000_000_000;
const min = (m: number) => NOW - m * 60_000;

function ws(id: string, projectId: string, status: WorkspaceInput["status"], activityMinutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return { id, projectId, projectName: projectId.toUpperCase(), title: `title ${id}`, status, branch: `br-${id}`, additions: 1, deletions: 2, activityAt: min(activityMinutes), model: "anthropic/claude-sonnet-4-5-20250929", ...extra };
}
function host(serverId: string, workspaces: WorkspaceInput[], extra: Partial<HostInput> = {}): HostInput {
  return { serverId, label: serverId, status: "online", loading: false, error: null, workspaces, ...extra };
}
const settings = { ...defaultSettings(), newGroupsExpanded: { hosts: true, projects: true } };
const opts = (o: Partial<TreeOptions> = {}): TreeOptions => ({ filter: "all", query: "", settings, collapse: {}, now: NOW, ...o });
const types = (rows: { type: string }[]) => rows.map((r) => r.type);
const wsIds = (rows: ReturnType<typeof buildTree>["rows"]) => rows.flatMap((r) => (r.type === "workspace" ? [r.workspace.id] : []));

describe("sorting", () => {
  it("orders workspaces attention, running, other, done; then recent first", () => {
    const list = [ws("d", "p", "done", 1), ws("r", "p", "running", 50), ws("a", "p", "failed", 100), ws("n", "p", "needs_input", 10), ws("r2", "p", "running", 5)];
    expect(list.sort(compareWorkspaces).map((w) => w.id)).toEqual(["n", "a", "r2", "r", "d"]);
  });
  it("orders projects by latest activity of any workspace, even filtered ones", () => {
    const tree = buildTree([host("h", [ws("1", "old", "running", 100), ws("2", "new", "running", 200), ws("3", "new", "done", 1)])], opts({ filter: "active" }));
    const projects = tree.rows.flatMap((r) => (r.type === "project" ? [r.projectId] : []));
    expect(projects).toEqual(["new", "old"]);
  });
  it("puts offline hosts last and respects configured order", () => {
    const tree = buildTree([host("off", [], { status: "offline" }), host("b", [ws("1", "p", "done", 1)]), host("a", [ws("2", "p", "done", 1)])], opts({ hostOrder: ["off", "a", "b"] }));
    expect(tree.rows.filter((r) => r.type === "host").map((r) => (r as { serverId: string }).serverId)).toEqual(["a", "b", "off"]);
  });
});

describe("filters and search", () => {
  it("filters active and attention", () => {
    expect(passesFilter(ws("1", "p", "done", 1), "active", settings, NOW)).toBe(false);
    expect(passesFilter(ws("1", "p", "running", 1), "attention", settings, NOW)).toBe(false);
    expect(passesFilter(ws("1", "p", "attention", 1), "attention", settings, NOW)).toBe(true);
  });
  it("hides old done workspaces when hideDone is set", () => {
    const s = { ...settings, hideDone: "1d" as const };
    expect(passesFilter(ws("1", "p", "done", 60 * 30), "all", s, NOW)).toBe(false);
    expect(passesFilter(ws("1", "p", "done", 60), "all", s, NOW)).toBe(true);
    expect(passesFilter(ws("1", "p", "running", 60 * 24 * 30), "all", s, NOW)).toBe(true);
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
    const tree = buildTree([host("h", [ws("1", "p", "done", 1, { title: "x" }), ws("2", "p", "failed", 1, { title: "x" }), ws("3", "p", "running", 1, { title: "y" })])], opts({ query: "x" }));
    expect(tree.counts).toEqual({ all: 2, active: 1, attention: 1 });
  });
  it("reports empty because filtered", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ filter: "attention" }));
    expect(tree.emptyBecauseFiltered).toBe(true);
    expect(types(tree.rows)).toEqual(["host", "note"]);
  });
});

describe("tree shape", () => {
  it("respects collapse and defaults", () => {
    const def = defaultSettings(); // projects collapsed
    const tree = buildTree([host("h", [ws("1", "p", "running", 1)])], opts({ settings: def }));
    expect(types(tree.rows)).toEqual(["host", "project"]);
    const proj = tree.rows[1];
    expect(proj?.type === "project" && proj.collapsed).toBe(true);
    const collapsedHost = buildTree([host("h", [ws("1", "p", "running", 1)])], opts({ collapse: { "host:h": true } }));
    expect(types(collapsedHost.rows)).toEqual(["host"]);
  });
  it("collapsed project still reports attention for the red dot", () => {
    const tree = buildTree([host("h", [ws("1", "p", "failed", 1)])], opts({ collapse: { "proj:h:p": true } }));
    const proj = tree.rows.find((r) => r.type === "project");
    expect(proj?.type === "project" && proj.attention).toBe(1);
  });
  it("renders loading skeletons per host and offline hosts dimmed", () => {
    const tree = buildTree([host("l", [], { loading: true }), host("o", [], { status: "offline" })], opts());
    expect(types(tree.rows)).toEqual(["host", "skeleton", "skeleton", "skeleton", "host"]);
  });
  it("shows a note for hosts without workspaces", () => {
    expect(types(buildTree([host("h", [])], opts()).rows)).toEqual(["host", "note"]);
  });
  it("hides hosts listed in hiddenHosts", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts({ settings: { ...settings, hiddenHosts: ["h"] } }));
    expect(tree.rows).toHaveLength(0);
  });
  it("shortens the model and collects group keys", () => {
    const tree = buildTree([host("h", [ws("1", "p", "done", 1)])], opts());
    expect(wsIds(tree.rows)).toEqual(["1"]);
    const row = tree.rows.find((r) => r.type === "workspace");
    expect(row?.type === "workspace" && row.modelShort).toBe("claude-sonnet-4-5");
    expect(tree.groupKeys).toEqual(["host:h", "proj:h:p"]);
  });
  it("counts attention on online hosts only", () => {
    const hosts = [host("a", [ws("1", "p", "failed", 1), ws("2", "p", "needs_input", 1), ws("3", "p", "running", 1)]), host("b", [ws("4", "p", "attention", 1)], { status: "offline" })];
    expect(attentionCount(hosts)).toBe(2);
  });
});
