// One host settings document kept in sync: read, optimistic local edits, and writes that re-read and
// replay the edits when another client saved first. Closures only (Hermes).
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";

type Rpc = PluginClientContext["rpc"];
const WRITE_ATTEMPTS = 4;

export interface SyncedDoc<Doc> {
  /** The host's copy with pending edits applied. */
  value(): Doc;
  ready(): boolean;
  error(): string | null;
  read(): Promise<void>;
  edit(change: (doc: Doc) => Doc): void;
}

export function createSyncedDoc<Doc>(options: {
  rpc: Rpc;
  settingsId: string;
  label: string;
  normalize(raw: unknown): Doc;
  changed(): void;
}): SyncedDoc<Doc> {
  const contracts = settingsRpc(options.settingsId);
  let remote: { revision: string; doc: Doc } | null = null;
  let ready = false;
  let pending: ((doc: Doc) => Doc)[] = [];
  let writing = false;
  let error: string | null = null;
  const describe = (failure: unknown) => `${options.label}: ${failure instanceof Error ? failure.message : String(failure)}`;

  async function fetch(): Promise<{ revision: string; doc: Doc }> {
    const result = await options.rpc(contracts.read, {});
    return { revision: result.revision, doc: options.normalize(result.status === "ready" ? result.values : undefined) };
  }

  async function read(): Promise<void> {
    if (writing) return;
    try {
      remote = await fetch();
      ready = true;
      error = null;
    } catch (failure) {
      error = describe(failure);
    }
    options.changed();
  }

  async function flush(): Promise<void> {
    if (writing) return;
    writing = true;
    try {
      while (pending.length) {
        const batch = pending.slice();
        let saved = false;
        for (let attempt = 0; attempt < WRITE_ATTEMPTS && !saved; attempt++) {
          if (!remote) {
            remote = await fetch();
            ready = true;
          }
          const values = batch.reduce((doc, change) => change(doc), remote.doc);
          const result = await options.rpc(contracts.write, { revision: remote.revision, values: values as never });
          if (result.status === "saved") {
            remote = { revision: result.revision, doc: options.normalize(result.values) };
            saved = true;
          } else if (result.status === "conflict") {
            remote = null; // another client saved first: re-read and replay
          } else {
            throw new Error(result.error);
          }
        }
        if (!saved) throw new Error("too many conflicting saves");
        pending = pending.slice(batch.length);
        error = null;
        options.changed();
      }
    } catch (failure) {
      // Edits stay pending and visible; the next edit or read tries again.
      error = `Saving ${describe(failure)}`;
      remote = null;
      options.changed();
    } finally {
      writing = false;
    }
  }

  return {
    value: () => pending.reduce((doc, change) => change(doc), remote?.doc ?? options.normalize(undefined)),
    ready: () => ready,
    error: () => error,
    read,
    edit(change) {
      pending.push(change);
      options.changed();
      void flush();
    },
  };
}
