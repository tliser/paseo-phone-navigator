import { describe, expect, it } from "vitest";
import { deriveWorkspaces, latestAgentByWorkspace, type AgentLike, type WorkspaceLike } from "../shared/derive";

const agent = (id: string, workspaceId: string, updatedAt: string, extra: Partial<AgentLike> = {}): AgentLike => ({
  id, workspaceId, model: `m-${id}`, provider: "claude", status: "idle", updatedAt, ...extra,
});
const workspace = (id: string, extra: Partial<WorkspaceLike> = {}): WorkspaceLike => ({
  id, projectId: "p", projectDisplayName: "Project", name: `name-${id}`, status: "done", activityAt: "2026-01-01T00:00:00Z", ...extra,
});

describe("latestAgentByWorkspace", () => {
  it("picks the most recent agent, prefers running, skips sub-agents and archived", () => {
    const map = latestAgentByWorkspace([
      agent("old", "w", "2026-01-01T00:00:00Z"),
      agent("new", "w", "2026-01-03T00:00:00Z"),
      agent("sub", "w", "2026-01-09T00:00:00Z", { labels: { "paseo.parent-agent-id": "new" } }),
      agent("arch", "w", "2026-01-09T00:00:00Z", { archivedAt: "2026-01-09T00:00:00Z" }),
      agent("run", "v", "2026-01-01T00:00:00Z", { status: "running" }),
      agent("idle", "v", "2026-01-05T00:00:00Z"),
    ]);
    expect(map.get("w")?.id).toBe("new");
    expect(map.get("v")?.id).toBe("run");
  });
});

describe("deriveWorkspaces", () => {
  it("maps fields and drops hidden workspaces", () => {
    const result = deriveWorkspaces(
      [
        workspace("a", { title: "  Real title ", projectCustomName: "Custom", projectKind: "git", projectRootPath: "/srv/p", diffStat: { additions: 3, deletions: 4 }, gitRuntime: { currentBranch: "main" } }),
        workspace("bg", { background: true }),
        workspace("arch", { archivingAt: "x" }),
        workspace("b", { title: null }),
      ],
      [agent("x", "a", "2026-02-01T00:00:00Z")],
    );
    expect(result.map((w) => w.id)).toEqual(["a", "b"]);
    expect(result[0]).toMatchObject({ title: "Real title", projectName: "Custom", projectKind: "git", projectRootPath: "/srv/p", branch: "main", additions: 3, deletions: 4, model: "m-x", activityAt: Date.parse("2026-02-01T00:00:00Z") });
    expect(result[1]).toMatchObject({ title: "name-b", projectName: "Project", projectKind: "directory", projectRootPath: "", branch: null, model: null });
  });
});

describe("asking vs unread", () => {
  // Shapes taken from the live daemon: "Continue long-game pipeline work" (attention, finished) and
  // "long-game API review" (running main agent, finished sub-agents).
  it("a finished turn is unread news, not a prompt", () => {
    const [w] = deriveWorkspaces(
      [workspace("lg", { status: "attention", statusEnteredAt: "2026-11-08T10:09:01.645Z" })],
      [agent("main", "lg", "2026-11-08T10:09:01Z", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "2026-11-08T10:09:01.645Z" })],
    );
    expect(w).toMatchObject({ needsYou: false, unreadAt: Date.parse("2026-11-08T10:09:01.645Z") });
  });
  it("finished sub-agents of a running workspace are neither asking nor unread", () => {
    const [w] = deriveWorkspaces(
      [workspace("api", { status: "running" })],
      [
        agent("main", "api", "2026-11-08T10:00:00Z", { status: "running" }),
        agent("sub", "api", "2026-11-08T10:04:53Z", { requiresAttention: true, attentionReason: "finished", labels: { "paseo.parent-agent-id": "main" } }),
      ],
    );
    expect(w).toMatchObject({ needsYou: false, unreadAt: 0 });
  });
  it("a permission request, from a sub-agent too, is a prompt", () => {
    const [a] = deriveWorkspaces([workspace("x", { status: "running" })], [agent("sub", "x", "2026-01-01T00:00:00Z", { pendingPermissions: [{}], labels: { "paseo.parent-agent-id": "m" } })]);
    expect(a?.needsYou).toBe(true);
    const [b] = deriveWorkspaces([workspace("y", { status: "needs_input" })], []);
    expect(b?.needsYou).toBe(true);
  });
  it("an agent that stopped with an error flags the workspace and the agent; an archived one does not", () => {
    const [w] = deriveWorkspaces(
      [workspace("x", { status: "done" })],
      [agent("m", "x", "2026-01-01T00:00:00Z", { status: "error" }), agent("old", "x", "2026-01-01T00:00:00Z", { status: "error", archivedAt: "2026-01-02T00:00:00Z" })],
    );
    expect(w?.agentError).toBe(true);
    expect(w?.agents?.map((a) => a.status)).toEqual(["error"]);
    const [quiet] = deriveWorkspaces([workspace("y")], [agent("a", "y", "2026-01-01T00:00:00Z", { status: "error", archivedAt: "2026-01-02T00:00:00Z" })]);
    expect(quiet?.agentError).toBe(false);
  });
  it("a failed workspace is unread", () => {
    const [w] = deriveWorkspaces([workspace("f", { status: "failed", statusEnteredAt: "2026-01-02T00:00:00Z" })], []);
    expect(w).toMatchObject({ needsYou: false, unreadAt: Date.parse("2026-01-02T00:00:00Z") });
  });
});

describe("agents of a workspace", () => {
  it("lists agents (sub-agents marked) newest first with their status; untitled ones are numbered by age", () => {
    const [w] = deriveWorkspaces(
      [workspace("x", { status: "running" })],
      [
        { ...agent("old", "x", "2026-01-01T00:00:00Z"), createdAt: "2026-01-01T00:00:00Z", title: null, requiresAttention: true, attentionReason: "finished" },
        { ...agent("new", "x", "2026-01-03T00:00:00Z", { pendingPermissions: [{}] }), createdAt: "2026-01-02T00:00:00Z", title: "Review" },
        agent("sub", "x", "2026-01-04T00:00:00Z", { labels: { "paseo.parent-agent-id": "new" } }),
      ],
    );
    expect(w!.agents!.map((a) => `${a.title}:${a.status}:${a.parentId}`)).toEqual(["Agent 3:idle:new", "Review:asking:null", "Agent 1:finished:null"]);
  });
  it("closed agents are listed after open ones; archived and internal ones are left out", () => {
    const [w] = deriveWorkspaces(
      [workspace("x", { status: "done" })],
      [
        { ...agent("c", "x", "2026-01-05T00:00:00Z"), status: "closed", title: "Old chat" },
        { ...agent("o", "x", "2026-01-01T00:00:00Z"), title: "Open chat" },
        { ...agent("a", "x", "2026-01-06T00:00:00Z"), archivedAt: "2026-01-07T00:00:00Z" },
        { ...agent("i", "x", "2026-01-06T00:00:00Z"), internal: true },
      ],
    );
    expect(w!.agents!.map((a) => `${a.title}:${a.status}`)).toEqual(["Open chat:idle", "Old chat:closed"]);
  });
});
