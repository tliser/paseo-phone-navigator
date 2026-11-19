import { describe, expect, it } from "vitest";
import { buildInbox, inboxTally } from "../shared/inbox";
import { readAgentKey } from "../shared/reads";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";

const chat = (id: string, status: AgentInput["status"], activityAt: number, extra: Partial<AgentInput> = {}): AgentInput => ({
  id, title: `chat ${id}`, model: null, status, parentId: null, activityAt, unreadAt: status === "finished" ? activityAt : 0, ...extra,
});
const ws = (id: string, agents: AgentInput[]): WorkspaceInput => ({
  id, projectId: "p", projectName: "P", projectKind: "git", projectRootPath: "/p", title: `ws ${id}`, status: "done",
  needsYou: false, unreadAt: 0, branch: null, additions: 0, deletions: 0, activityAt: 1, orderAt: 1, model: null, agents,
});
const host = (serverId: string, workspaces: WorkspaceInput[], extra: Partial<HostInput> = {}): HostInput => ({
  serverId, label: serverId.toUpperCase(), status: "online", loading: false, error: null, workspaces, ...extra,
});

describe("buildInbox", () => {
  it("lists chats from every host (hidden ones too), asking and errors first, then unread, newest first", () => {
    // The tree's hiddenHosts setting is not an input: the Inbox covers every host.
    const hosts = [
      host("a", [ws("1", [chat("old", "finished", 10), chat("busy", "running", 50), chat("ask", "asking", 5)])]),
      host("b", [ws("2", [chat("new", "finished", 40), chat("err", "error", 30), chat("sub", "asking", 20, { parentId: "err" }), chat("done", "finished", 60)])]),
      host("off", [], { status: "offline" }),
      host("slow", [], { loading: true }),
    ];
    const inbox = buildInbox(hosts, { [readAgentKey("b", "done")]: 100 });
    expect(inbox.entries.map((e) => `${e.hostLabel}/${e.agentId}:${e.state}`)).toEqual(["B/err:error", "B/sub:asking", "A/ask:asking", "B/new:unread", "A/old:unread"]);
    expect(inbox).toMatchObject({ offlineHosts: ["OFF"], loadingHosts: ["SLOW"] });
    expect(inboxTally(inbox.entries)).toEqual({ total: 5, asking: 2, error: 1, unread: 2 });
  });
});
