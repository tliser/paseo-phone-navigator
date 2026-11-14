// Keeps the profiles, read state and update settings the same on every host whose plugin copy is loaded.
// Reads every other host's copy, merges them with this host's (shared/sync.ts), saves the result here
// through the synced document, and writes it to each host whose copy differs. Closures only (Hermes).
import { settingsRpc } from "@getpaseo/plugin";
import type { InstalledVersion } from "../shared/updates";
import type { Peer } from "./peers";
import type { SyncedDoc } from "./synced-doc";

export interface SyncedKind<Doc> {
  settingsId: string;
  doc: SyncedDoc<Doc>;
  normalize(raw: unknown): Doc;
  /** Merges copies; the first is this host's. Must be idempotent. */
  merge(docs: readonly Doc[]): Doc;
  same(a: Doc, b: Doc): boolean;
}

export interface HostSync {
  /** Runs a pass soon (debounced). */
  schedule(): void;
  dispose(): void;
}

const DELAY_MS = 1500;
const EVERY_MS = 60_000;

export function createHostSync(options: {
  kinds: readonly SyncedKind<unknown>[];
  /** Other hosts' copies that can be reached now (this host excluded). */
  peers(): Peer[];
  /** Installed versions, asked once per loaded copy; feeds the update settings. */
  installedVersion?(peer: Peer): Promise<InstalledVersion | null>;
  onVersions?(versions: InstalledVersion[]): void;
  /** A host refused the merged settings: it runs an older version. Asked once to update itself. */
  onOutdated?(peer: Peer): void;
}): HostSync {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let disposed = false;
  const asked = new WeakMap<Peer, Promise<InstalledVersion | null>>();
  const outdated = new WeakSet<Peer>();
  const every = setInterval(() => schedule(), EVERY_MS);

  async function syncKind(kind: SyncedKind<unknown>, peers: Peer[]) {
    if (!kind.doc.ready()) return;
    const contracts = settingsRpc(kind.settingsId);
    const copies = await Promise.all(
      peers.map(async (peer) => {
        try {
          const result = await peer.rpc(contracts.read, {});
          return { peer, revision: result.revision, doc: kind.normalize(result.status === "ready" ? result.values : undefined) };
        } catch {
          return null; // unreachable for now; the next pass tries again
        }
      }),
    );
    const others = copies.filter((copy): copy is NonNullable<typeof copy> => copy !== null);
    if (!others.length) return;
    const merged = kind.merge([kind.doc.value(), ...others.map((copy) => copy.doc)]);
    if (!kind.same(merged, kind.doc.value())) {
      // Replayed on top of whatever this host holds when the save happens, so nothing is lost.
      const peerDocs = others.map((copy) => copy.doc);
      kind.doc.edit((doc) => kind.merge([doc, ...peerDocs]));
    }
    for (const copy of others) {
      if (kind.same(merged, copy.doc) || outdated.has(copy.peer)) continue;
      try {
        const result = await copy.peer.rpc(contracts.write, { revision: copy.revision, values: merged as never });
        if (result.status === "conflict") again = true;
        else if (result.status !== "saved" || !kind.same(kind.normalize(result.values), merged)) markOutdated(copy.peer);
      } catch {
        // Unreachable meanwhile: the next pass tries again.
      }
    }
  }

  function markOutdated(peer: Peer) {
    if (outdated.has(peer)) return;
    outdated.add(peer);
    options.onOutdated?.(peer);
  }

  async function publishVersions(peers: Peer[]) {
    if (!options.installedVersion || !options.onVersions) return;
    const versions = await Promise.all(
      peers.map((peer) => {
        let pending = asked.get(peer);
        if (!pending) {
          pending = options.installedVersion!(peer).catch(() => null);
          asked.set(peer, pending);
        }
        return pending;
      }),
    );
    options.onVersions(versions.filter((version): version is InstalledVersion => !!version));
  }

  async function pass() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const peers = options.peers();
        if (!peers.length) break;
        for (const kind of options.kinds) await syncKind(kind, peers);
        await publishVersions(peers);
      } while (again && !disposed);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void pass();
    }, DELAY_MS);
  }

  return {
    schedule,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      clearInterval(every);
    },
  };
}
