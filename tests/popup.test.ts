import { describe, expect, it } from "vitest";
import { sectionEntries } from "../shared/popup";
import { defaultSettings, normalizeSections } from "../shared/profiles";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";

const NOW = 10 * 86_400_000;
const chat = (id: string, status: AgentInput["status"], activityAt: number): AgentInput => ({
  id, title: `chat ${id}`, model: null, status, parentId: null, activityAt, unreadAt: 0,
});
const ws = (id: string, agents: AgentInput[], orderAt: number): WorkspaceInput => ({
  id, projectId: "p", projectName: "P", projectKind: "git", projectRootPath: "/p", title: `ws ${id}`, status: agents.some((a) => a.status === "running") ? "running" : "done",
  needsYou: false, unreadAt: 0, branch: null, additions: 0, deletions: 0, activityAt: NOW - 1000, orderAt, model: null, agents,
});
const host = (serverId: string, workspaces: WorkspaceInput[]): HostInput => ({ serverId, label: serverId, status: "online", loading: false, error: null, workspaces });

const hosts = [
  host("a", [
    ws("1", [chat("old", "idle", NOW - 5000), chat("latest", "idle", NOW - 2000)], 1),
    ws("shell", [], 3),
    ws("2", [chat("busy", "running", NOW - 100)], 2),
  ]),
  host("hidden", [ws("3", [chat("elsewhere", "running", NOW - 50)], 4)]),
];
const input = { hosts, reads: {}, settings: { ...defaultSettings(), hiddenHosts: ["hidden"] }, pins: new Set(["a:1", "a:shell"]), now: NOW };
const ids = (section: Parameters<typeof sectionEntries>[0]) => sectionEntries(section, input).map((entry) => entry.agentId);

describe("popup sections", () => {
  it("lists each workspace's latest chat, leaves chat-less workspaces and hidden hosts out", () => {
    expect(ids("pinned")).toEqual(["latest"]);
    expect(ids("recent")).toEqual(["busy", "latest"]);
    expect(ids("active")).toEqual(["busy"]);
  });
  it("lists running chats", () => {
    expect(sectionEntries("running", input).map((entry) => `${entry.agentId}:${entry.state}`)).toEqual(["busy:running"]);
  });
  it("keeps known sections once, in order, and never none", () => {
    expect(normalizeSections(["running", "x", "inbox", "running"])).toEqual(["running", "inbox"]);
    expect(normalizeSections([])).toEqual(["inbox"]);
    expect(normalizeSections(undefined)).toEqual(["inbox"]);
  });
});
