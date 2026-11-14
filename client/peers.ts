// Every connected host runs its own copy of this plugin inside the same app, each with its own RPC to
// its host. The copies find each other through one object on globalThis, so any copy can read and write
// the settings of every other host. The SDK has no cross-host plugin RPC; this is the bridge. Copies of
// different plugin versions share it, so the shape is a contract: change it only with DIRECTORY_KEY.
import type { PluginClientContext } from "@getpaseo/plugin/client";

const DIRECTORY_KEY = "__paseoPhoneNavigator.peers.v1";

export interface Peer {
  serverId: string;
  rpc: PluginClientContext["rpc"];
}

interface SharedDirectory {
  peers: Map<string, Peer>;
  listeners: Set<() => void>;
}

export interface PeerDirectory {
  /** Adds this host's copy. The returned function removes it again (only if it is still the registered one). */
  register(peer: Peer): () => void;
  list(): Peer[];
  /** Called when a copy comes or goes. */
  subscribe(listener: () => void): () => void;
}

export function createPeerDirectory(scope: object = globalThis): PeerDirectory {
  const holder = scope as Record<string, SharedDirectory | undefined>;
  const shared = (holder[DIRECTORY_KEY] ??= { peers: new Map(), listeners: new Set() });
  const broadcast = () => {
    for (const listener of [...shared.listeners]) {
      try {
        listener();
      } catch {
        // One copy's failing listener must not keep the others from hearing about the change.
      }
    }
  };
  return {
    register(peer) {
      shared.peers.set(peer.serverId, peer);
      broadcast();
      return () => {
        if (shared.peers.get(peer.serverId) !== peer) return;
        shared.peers.delete(peer.serverId);
        broadcast();
      };
    },
    list: () => [...shared.peers.values()],
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => void shared.listeners.delete(listener);
    },
  };
}
