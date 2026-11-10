import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store imports the plugin SDK and react-native, which only exist inside Paseo. Stub them.
const clients = new Map<string, unknown>();
vi.mock("@getpaseo/plugin/client", () => ({
  getPaseoClient: (id: string) => {
    const api = clients.get(id);
    if (!api) throw new Error(`no client ${id}`);
    return api;
  },
}));
vi.mock("@getpaseo/plugin", () => ({
  defineSettings: <T>(definition: T) => definition,
  settingsRpc: (id: string) => ({ read: { name: `${id}.read` }, write: { name: `${id}.write` } }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const { createStore } = await import("../client/store");

type Doc = { profiles: unknown[] };

function fakeHost() {
  return { revision: 1, values: { profiles: [] as unknown[] } as Doc, writes: 0, conflictNext: false };
}

function rpcFor(host: ReturnType<typeof fakeHost>) {
  return vi.fn(async (contract: { name: string }, input: { revision?: string; values?: Doc }) => {
    if (contract.name.endsWith(".read")) return { status: "ready", revision: String(host.revision), values: host.values };
    host.writes++;
    if (host.conflictNext || input.revision !== String(host.revision)) {
      host.conflictNext = false;
      host.revision++;
      return { status: "conflict", error: "conflict" };
    }
    host.revision++;
    host.values = input.values!;
    return { status: "saved", revision: String(host.revision), values: host.values };
  });
}

/** Like the SDK: a new subscriber gets the current snapshot right away. */
function emptyApi(counters = { subscribed: 0, released: 0 }) {
  const list = async () => {
    const result = { entries: [], pageInfo: { nextCursor: null, hasMore: false } };
    return {
      ...result,
      subscription: {
        release: async () => void counters.released++,
        subscribe: (observer: { snapshot(value: unknown): void }) => {
          counters.subscribed++;
          observer.snapshot(result);
          return () => undefined;
        },
      },
    };
  };
  return { workspaces: { list }, agents: { list } };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  clients.clear();
});
afterEach(() => vi.useRealTimers());

describe("store profiles", () => {
  it("starts with built-ins and saves edits", async () => {
    const host = fakeHost();
    const store = createStore(rpcFor(host) as never, () => () => undefined);
    const release = store.retain();
    await flush();
    expect(store.getSnapshot().profiles.map((p) => p.id)).toEqual(["phone", "desktop"]);
    store.editProfiles((profiles) => profiles.map((p) => (p.id === "phone" ? { ...p, name: "Mine" } : p)));
    expect(store.getSnapshot().profiles[0]?.name).toBe("Mine"); // optimistic
    await flush();
    expect((host.values.profiles[0] as { name: string }).name).toBe("Mine");
    release();
    store.dispose();
  });

  it("re-reads and replays on a conflict", async () => {
    const host = fakeHost();
    const rpc = rpcFor(host);
    const store = createStore(rpc as never, () => () => undefined);
    store.retain();
    await flush();
    host.conflictNext = true;
    store.editProfiles((profiles) => [...profiles, { ...profiles[0]!, id: "x", name: "X" }]);
    await flush();
    await flush();
    expect(host.values.profiles.map((p) => (p as { id: string }).id)).toEqual(["phone", "desktop", "x"]);
    expect(host.writes).toBe(2);
    store.dispose();
  });

  it("debounces phone collapse into one profile save", async () => {
    const host = fakeHost();
    const store = createStore(rpcFor(host) as never, () => () => undefined);
    store.retain();
    await flush();
    store.setCollapse("phone", { "host:a": true });
    store.setCollapse("phone", { "host:a": true, "host:b": true });
    expect(store.getSnapshot().collapseFor("phone")).toEqual({ "host:a": true, "host:b": true });
    expect(host.writes).toBe(0);
    vi.advanceTimersByTime(3_000);
    await flush();
    expect(host.writes).toBe(1);
    expect((host.values.profiles[0] as { collapse: object }).collapse).toEqual({ "host:a": true, "host:b": true });
    store.dispose();
  });

  it("moves an item and saves the order in that profile only", async () => {
    const host = fakeHost();
    const store = createStore(rpcFor(host) as never, () => () => undefined);
    store.retain();
    await flush();
    store.move("desktop", "proj:h:p", ["a", "b", "c"], "c", "a", "before");
    expect(store.getSnapshot().profiles.find((p) => p.id === "desktop")?.order).toEqual({ "proj:h:p": ["c", "a", "b"] }); // optimistic
    await flush();
    const saved = host.values.profiles as { id: string; order: object }[];
    expect(saved.find((p) => p.id === "desktop")?.order).toEqual({ "proj:h:p": ["c", "a", "b"] });
    expect(saved.find((p) => p.id === "phone")?.order).toEqual({});
    const writes = host.writes;
    store.move("desktop", "proj:h:p", ["c", "a", "b"], "a", "b", "before"); // no change
    await flush();
    expect(host.writes).toBe(writes);
    store.dispose();
  });

  it("selecting a profile is remembered for the session", async () => {
    const store = createStore(rpcFor(fakeHost()) as never, () => () => undefined);
    store.selectProfile("desktop");
    expect(store.getSnapshot().sessionProfileId).toBe("desktop");
    expect(store.getSnapshot().deviceProfileId).toBeNull(); // no device storage on phones
    store.dispose();
  });
});

describe("store read state", () => {
  function readsHost() {
    const docs: Record<string, { revision: number; values: unknown }> = {
      profiles: { revision: 1, values: { profiles: [] } },
      reads: { revision: 1, values: { seen: {} } },
    };
    let writes = 0;
    const rpc = vi.fn(async (contract: { name: string }, input: { revision?: string; values?: unknown }) => {
      const [id, op] = contract.name.split(".") as [string, string];
      const doc = docs[id]!;
      if (op === "read") return { status: "ready", revision: String(doc.revision), values: doc.values };
      writes++;
      doc.revision++;
      doc.values = input.values;
      return { status: "saved", revision: String(doc.revision), values: doc.values };
    });
    return { docs, rpc, writes: () => writes };
  }

  it("marks read and unread, batching writes into the shared document", async () => {
    const host = readsHost();
    const store = createStore(host.rpc as never, () => () => undefined);
    store.retain();
    await flush();
    store.markRead("h", ["w1"]);
    store.markRead("h", ["w2"]);
    expect(Object.keys(store.getSnapshot().reads).sort()).toEqual(["h:w1", "h:w2"]); // immediate
    expect(host.writes()).toBe(0);
    vi.advanceTimersByTime(800);
    await flush();
    expect(host.writes()).toBe(1);
    expect(Object.keys((host.docs.reads!.values as { seen: object }).seen).sort()).toEqual(["h:w1", "h:w2"]);
    store.markUnread("h", "w1");
    expect(store.getSnapshot().reads["h:w1"]).toBe(0);
    vi.advanceTimersByTime(800);
    await flush();
    expect(Object.keys((host.docs.reads!.values as { seen: object }).seen)).toEqual(["h:w2"]);
    store.dispose();
  });

  it("saves pending reads when the plugin unloads", async () => {
    const host = readsHost();
    const store = createStore(host.rpc as never, () => () => undefined);
    store.retain();
    await flush();
    store.markRead("h", ["w"]);
    store.dispose();
    await flush();
    expect(Object.keys((host.docs.reads!.values as { seen: object }).seen)).toEqual(["h:w"]);
  });
});

describe("store hosts", () => {
  it("loads online hosts, leaves offline ones and reports connect errors", async () => {
    clients.set("a", emptyApi());
    const store = createStore(rpcFor(fakeHost()) as never, () => () => undefined);
    store.retain();
    store.setHosts([
      { serverId: "a", label: "A", status: "online" },
      { serverId: "b", label: "B", status: "offline" },
      { serverId: "c", label: "C", status: "online" },
    ]);
    await flush();
    vi.advanceTimersByTime(300);
    const hosts = store.getSnapshot().hosts;
    expect(hosts.find((h) => h.serverId === "a")).toMatchObject({ loading: false, error: null });
    expect(hosts.find((h) => h.serverId === "b")).toMatchObject({ loading: false, status: "offline" });
    expect(hosts.find((h) => h.serverId === "c")?.error).toContain("no client c");
    store.dispose();
  });

  it("stops observing after the last consumer leaves", async () => {
    const counters = { subscribed: 0, released: 0 };
    clients.set("a", emptyApi(counters));
    const store = createStore(rpcFor(fakeHost()) as never, () => () => undefined);
    store.setHosts([{ serverId: "a", label: "A", status: "online" }]);
    const release = store.retain();
    await flush();
    expect(counters.subscribed).toBe(2);
    release();
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(counters.released).toBe(2);
    store.dispose();
  });
});
