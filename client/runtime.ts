// Module-level handles shared by the surfaces of one plugin installation.
import { useHosts } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { resolveProfile, type Profile } from "../shared/profiles";
import { tallyHosts, type Tally } from "../shared/tree";
import type { Platform } from "../shared/types";
import type { Store, StoreSnapshot } from "./store";

let current: Store | null = null;

export function setStore(store: Store | null): void {
  current = store;
}

export function getStore(): Store {
  if (!current) throw new Error("Phone Navigator is not loaded");
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

/** Real prompts and unread news on every online host, for the badges. */
export function useTally(): Tally {
  const { snapshot } = useNavigatorStore();
  return useMemo(() => tallyHosts(snapshot.hosts, snapshot.reads), [snapshot.hosts, snapshot.reads]);
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
