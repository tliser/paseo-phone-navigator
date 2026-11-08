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
        workspace("a", { title: "  Real title ", projectCustomName: "Custom", diffStat: { additions: 3, deletions: 4 }, gitRuntime: { currentBranch: "main" } }),
        workspace("bg", { background: true }),
        workspace("arch", { archivingAt: "x" }),
        workspace("b", { title: null }),
      ],
      [agent("x", "a", "2026-02-01T00:00:00Z")],
    );
    expect(result.map((w) => w.id)).toEqual(["a", "b"]);
    expect(result[0]).toMatchObject({ title: "Real title", projectName: "Custom", branch: "main", additions: 3, deletions: 4, model: "m-x", activityAt: Date.parse("2026-02-01T00:00:00Z") });
    expect(result[1]).toMatchObject({ title: "name-b", projectName: "Project", branch: null, model: null });
  });
});
