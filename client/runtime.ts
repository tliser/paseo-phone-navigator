// Module-level handles shared by the surfaces of one plugin installation.
import { useHosts, useTerminals, type TerminalRef } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { resolveProfile, type Profile } from "../shared/profiles";
import { buildInbox, inboxTally, type Inbox, type InboxTally } from "../shared/inbox";
import type { HostInput, Platform, TerminalInput } from "../shared/types";
import type { Store, StoreSnapshot } from "./store";

let current: Store | null = null;

export function setStore(store: Store | null): void {
  current = store;
}

export function getStore(): Store {
  if (!current) throw new Error("Workspace Organizer is not loaded");
  return current;
}

/** Subscribes the calling surface to the store and keeps the host list current. */
export function useNavigatorStore(): { store: Store; snapshot: StoreSnapshot } {
  const store = getStore();
  const hosts = useHosts();
  useEffect(() => store.setHosts(hosts), [store, hosts]);
  useEffect(() => store.retain(), [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}

/** The Inbox over every online host. */
export function useInbox(snapshot: StoreSnapshot): Inbox {
  return useMemo(() => buildInbox(snapshot.hosts, snapshot.reads), [snapshot.hosts, snapshot.reads]);
}

/** Chats that ask you, failed or are unread, for the badges. */
export function useInboxTally(): InboxTally {
  const { snapshot } = useNavigatorStore();
  const inbox = useInbox(snapshot);
  return useMemo(() => inboxTally(inbox.entries), [inbox]);
}

export function useActiveProfile(snapshot: StoreSnapshot, platform: Platform, compact: boolean): Profile {
  return useMemo(
    () =>
      resolveProfile(snapshot.profiles, {
        sessionId: snapshot.sessionProfileId,
        deviceId: snapshot.deviceProfileId,
        platform,
        compact,
      }).profile,
    [snapshot.profiles, snapshot.sessionProfileId, snapshot.deviceProfileId, platform, compact],
  );
}

export const SCREEN_ID = "navigator";
export const SETTINGS_ID = "settings";

export interface TerminalTabs {
  byWorkspace: ReadonlyMap<string, TerminalInput[]>;
  refs: ReadonlyMap<string, TerminalRef>;
}

/**
 * Terminal tabs per "serverId:workspaceId", from the app's live terminal list, with their real refs.
 * Paseo's state hooks only work inside its state provider: the sidebar view has one, plugin screens don't.
 */
export function useTerminalTabs(): TerminalTabs {
  // `useTerminals` hands out refs only; one group per terminal carries its workspace and title in the group key.
  const groups = useTerminals({
    where: (terminal) => !terminal.isScript,
    orderBy: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    groupBy: (terminal) => ({ key: `${terminal.ref.key}\n${terminal.workspace.id}`, title: terminal.title }),
  });
  return useMemo(() => {
    const byWorkspace = new Map<string, TerminalInput[]>();
    const refs = new Map<string, TerminalRef>();
    for (const group of groups) {
      const ref = group.items[0];
      const workspaceId = group.key.slice(group.key.lastIndexOf("\n") + 1);
      if (!ref || !workspaceId) continue;
      const key = `${ref.hostId}:${workspaceId}`;
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), { id: ref.id, title: group.title ?? "Terminal" }]);
      refs.set(`${ref.hostId}:${ref.id}`, ref);
    }
    return { byWorkspace, refs };
  }, [groups]);
}

/** Hosts with each workspace's terminals filled in. */
export function withTerminals(hosts: readonly HostInput[], terminals: ReadonlyMap<string, TerminalInput[]>): HostInput[] {
  if (!terminals.size) return hosts as HostInput[];
  return hosts.map((host) => ({
    ...host,
    workspaces: host.workspaces.map((workspace) => {
      const list = terminals.get(`${host.serverId}:${workspace.id}`);
      return list ? { ...workspace, terminals: list } : workspace;
    }),
  }));
}
