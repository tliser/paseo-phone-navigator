import { describe, expect, it } from "vitest";
import { createHostObserver, type HostDirectory } from "../client/host-observer";

type Observer = { snapshot(value: unknown): void; update(message: unknown): void; error?(error: unknown): void };

/** A fake list endpoint with paging, a controllable subscription, and deferred pages. */
function endpoint(pages: { id: string }[][]) {
  const observers: Observer[] = [];
  const waiting: (() => void)[] = [];
  let released = 0;
  const page = (index: number) => ({
    entries: pages[index] ?? [],
    pageInfo: { nextCursor: index + 1 < pages.length ? String(index + 1) : null, hasMore: index + 1 < pages.length },
  });
  return {
    observers,
    waiting,
    get released() {
      return released;
    },
    async list(options: { page?: { cursor?: string }; subscribe?: object }) {
      const index = Number(options.page?.cursor ?? 0);
      if (options.subscribe) {
        const first = page(0);
        return {
          ...first,
          subscription: {
            release: async () => void released++,
            subscribe(observer: Observer) {
              observers.push(observer);
              observer.snapshot(first);
              return () => undefined;
            },
          },
        };
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
      return page(index);
    },
  };
}

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const ids = (directory: HostDirectory | undefined) => directory?.workspaces.map((w) => w.id).sort();

describe("host observer", () => {
  it("reads every page and replays updates that arrived meanwhile", async () => {
    const workspaces = endpoint([[{ id: "a" }], [{ id: "b" }]]);
    let last: HostDirectory | undefined;
    const observer = createHostObserver({ workspaces } as never, (d) => (last = d), { agents: false });
    observer.start();
    await tick();
    expect(last).toBeUndefined(); // still loading page 2
    workspaces.observers[0]!.update({ type: "workspace_update", payload: { kind: "upsert", workspace: { id: "c" } } });
    workspaces.observers[0]!.update({ type: "workspace_update", payload: { kind: "remove", id: "a" } });
    workspaces.waiting.shift()!();
    await tick();
    expect(last?.loading).toBe(false);
    expect(ids(last)).toEqual(["b", "c"]);
    workspaces.observers[0]!.update({ type: "workspace_update", payload: { kind: "upsert", workspace: { id: "d" } } });
    expect(ids(last)).toEqual(["b", "c", "d"]);
  });

  it("drops a stale hydration when a new snapshot (reconnect) arrives", async () => {
    const workspaces = endpoint([[{ id: "a" }], [{ id: "old" }]]);
    let last: HostDirectory | undefined;
    const observer = createHostObserver({ workspaces } as never, (d) => (last = d), { agents: false });
    observer.start();
    await tick();
    // Reconnect: a fresh complete snapshot replaces the in-flight one.
    workspaces.observers[0]!.snapshot({ entries: [{ id: "fresh" }], pageInfo: { nextCursor: null, hasMore: false } });
    await tick();
    expect(ids(last)).toEqual(["fresh"]);
    workspaces.waiting.shift()!(); // the old page arrives late
    await tick();
    expect(ids(last)).toEqual(["fresh"]);
  });

  it("releases subscriptions on stop and ignores later events", async () => {
    const workspaces = endpoint([[{ id: "a" }]]);
    const agents = endpoint([[]]);
    let calls = 0;
    const observer = createHostObserver({ workspaces, agents } as never, () => void calls++);
    observer.start();
    await tick();
    const before = calls;
    observer.stop();
    await tick();
    expect(workspaces.released + agents.released).toBe(2);
    workspaces.observers[0]!.update({ type: "workspace_update", payload: { kind: "upsert", workspace: { id: "z" } } });
    expect(calls).toBe(before);
  });

  it("filters archived agents from live updates", async () => {
    const workspaces = endpoint([[]]);
    const agents = endpoint([[]]);
    let last: HostDirectory | undefined;
    createHostObserver({ workspaces, agents } as never, (d) => (last = d)).start();
    await tick();
    agents.observers[0]!.update({ type: "agent_update", payload: { kind: "upsert", agent: { id: "x" } } });
    expect(last?.agents.map((a) => a.id)).toEqual(["x"]);
    agents.observers[0]!.update({ type: "agent_update", payload: { kind: "upsert", agent: { id: "x", archivedAt: "now" } } });
    expect(last?.agents).toEqual([]);
  });
});
