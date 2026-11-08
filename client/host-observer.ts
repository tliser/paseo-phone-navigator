// Follows one host's workspaces (and optionally agents) through owned subscriptions.
// Snapshot = full re-read (paged); live updates arriving meanwhile are buffered and replayed.
// A generation counter drops replies from a previous snapshot. Closures only: no classes (Hermes).
import type { AgentListResult, PaseoAgent, PaseoApi, PaseoWorkspace, Released, ServerMessage, WorkspaceListResult } from "./paseo";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

export interface HostDirectory {
  workspaces: PaseoWorkspace[];
  agents: PaseoAgent[];
  loading: boolean;
  error: string | null;
}

export interface HostObserver {
  start(): void;
  stop(): void;
}

interface Paged<T> {
  entries: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createHostObserver(
  api: PaseoApi,
  publish: (directory: HostDirectory) => void,
  options: { agents: boolean } = { agents: true },
): HostObserver {
  let stopped = false;
  const cleanups: (() => void)[] = [];
  let workspaces = new Map<string, PaseoWorkspace>();
  let agents = new Map<string, PaseoAgent>();
  const pending = new Set<string>(options.agents ? ["workspaces", "agents"] : ["workspaces"]);
  const errors = new Map<string, string>();

  function emit() {
    if (stopped) return;
    publish({
      workspaces: [...workspaces.values()],
      agents: [...agents.values()],
      loading: pending.size > 0,
      error: errors.size ? [...errors.values()].join("; ") : null,
    });
  }

  function own(subscription: Released) {
    const release = () => void subscription.release().catch(() => undefined);
    if (stopped) release();
    else cleanups.push(release);
  }

  async function follow<Item, Result extends Paged<unknown>>(spec: {
    name: string;
    first(): Promise<Result & { subscription: Released & { subscribe(observer: { snapshot(value: Result): void; update(message: ServerMessage): void; error?(error: unknown): void }): () => void } }>;
    page(cursor: string): Promise<Result>;
    items(result: Result): Item[];
    key(item: Item): string;
    apply(message: ServerMessage, items: Map<string, Item>): boolean;
    commit(items: Map<string, Item>): void;
  }) {
    let generation = 0;
    let hydrating = false;
    let buffered: ServerMessage[] = [];
    let items = new Map<string, Item>();
    try {
      const first = await spec.first();
      own(first.subscription);
      if (stopped) return;
      cleanups.push(
        first.subscription.subscribe({
          snapshot(snapshot) {
            const current = ++generation;
            hydrating = true;
            buffered = [];
            pending.add(spec.name);
            void (async () => {
              const next = new Map(spec.items(snapshot).map((item) => [spec.key(item), item]));
              let page: Result = snapshot;
              const seen = new Set<string>();
              for (let count = 1; page.pageInfo.hasMore; count++) {
                const cursor = page.pageInfo.nextCursor;
                if (!cursor || seen.has(cursor) || count >= MAX_PAGES) throw new Error(`${spec.name} list is incomplete`);
                seen.add(cursor);
                page = await spec.page(cursor);
                if (stopped || current !== generation) return;
                for (const item of spec.items(page)) next.set(spec.key(item), item);
              }
              if (stopped || current !== generation) return;
              for (const message of buffered) spec.apply(message, next);
              buffered = [];
              hydrating = false;
              items = next;
              spec.commit(items);
              pending.delete(spec.name);
              errors.delete(spec.name);
              emit();
            })().catch((error) => {
              if (stopped || current !== generation) return;
              // Keep the last complete list rather than publishing a partial one.
              hydrating = false;
              buffered = [];
              pending.delete(spec.name);
              errors.set(spec.name, `${spec.name}: ${describe(error)}`);
              emit();
            });
          },
          update(message) {
            if (hydrating) {
              buffered.push(message);
              return;
            }
            if (spec.apply(message, items)) {
              spec.commit(items);
              emit();
            }
          },
          error(error) {
            pending.delete(spec.name);
            errors.set(spec.name, `${spec.name}: ${describe(error)}`);
            emit();
          },
        }),
      );
    } catch (error) {
      pending.delete(spec.name);
      errors.set(spec.name, `${spec.name}: ${describe(error)}`);
      emit();
    }
  }

  return {
    start() {
      void follow<PaseoWorkspace, WorkspaceListResult>({
        name: "workspaces",
        first: () => api.workspaces.list({ page: { limit: PAGE_SIZE }, subscribe: {} }),
        page: (cursor) => api.workspaces.list({ page: { limit: PAGE_SIZE, cursor } }),
        items: (result) => result.entries,
        key: (workspace) => workspace.id,
        apply(message, map) {
          if (message.type !== "workspace_update") return false;
          if (message.payload.kind === "upsert") map.set(message.payload.workspace.id, message.payload.workspace);
          else map.delete(message.payload.id);
          return true;
        },
        commit(map) {
          workspaces = new Map(map);
        },
      });
      if (!options.agents) return;
      const query = { filter: { includeArchived: false }, sort: [{ key: "updated_at" as const, direction: "desc" as const }] };
      void follow<PaseoAgent, AgentListResult>({
        name: "agents",
        first: () => api.agents.list({ ...query, page: { limit: PAGE_SIZE }, subscribe: {} }),
        page: (cursor) => api.agents.list({ ...query, page: { limit: PAGE_SIZE, cursor } }),
        items: (result) => result.entries.map((entry) => entry.agent),
        key: (agent) => agent.id,
        apply(message, map) {
          if (message.type !== "agent_update") return false;
          const update = message.payload;
          if (update.kind === "upsert" && !update.agent.archivedAt) map.set(update.agent.id, update.agent);
          else map.delete(update.kind === "remove" ? update.agentId : update.agent.id);
          return true;
        },
        commit(map) {
          agents = new Map(map);
        },
      });
    },
    stop() {
      stopped = true;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}
