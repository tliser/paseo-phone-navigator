// One store for every surface (sidebar row, header buttons, screen, settings). It follows every online
// host while at least one surface is mounted, and owns the profiles document of the serving host.
// Closures only: no classes (Hermes).
import { getPaseoClient, type PluginClientContext, type PluginHostSummary } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { deriveWorkspaces, type AgentLike, type WorkspaceLike } from "../shared/derive";
import {
  normalizeDocument,
  pruneCollapse,
  type CollapseMap,
  type Profile,
  type ProfilesDocument,
} from "../shared/profiles";
import { profilesSettings } from "../shared/settings";
import type { HostInput } from "../shared/types";
import { hasDeviceStorage, readDeviceCollapse, readDeviceProfileId, writeDeviceCollapse, writeDeviceProfileId } from "./device";
import { createHostObserver, type HostDirectory, type HostObserver } from "./host-observer";
import type { PaseoApi } from "./paseo";

const EMIT_DELAY_MS = 250;
const RECONCILE_MS = 15_000;
const STOP_GRACE_MS = 5_000;
const COLLAPSE_SAVE_DELAY_MS = 3_000;
const WRITE_ATTEMPTS = 4;

type Rpc = PluginClientContext["rpc"];
const contracts = settingsRpc(profilesSettings.id);

export interface StoreSnapshot {
  hosts: HostInput[];
  /** Configured host order (serverIds). */
  hostOrder: string[];
  profiles: Profile[];
  profilesReady: boolean;
  /** Profile picked in this app session, if any. */
  sessionProfileId: string | null;
  /** Profile stored on this device (web/desktop), if any. */
  deviceProfileId: string | null;
  deviceStorage: boolean;
  /** Collapse map per profile as this device sees it (device copy on web, profile copy elsewhere). */
  collapseFor(profileId: string): CollapseMap;
  savingError: string | null;
  /** Hosts that report an error. */
  errors: string[];
}

export interface Store {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StoreSnapshot;
  retain(): () => void;
  setHosts(hosts: readonly PluginHostSummary[]): void;
  refresh(): void;
  selectProfile(id: string): void;
  setCollapse(profileId: string, map: CollapseMap): void;
  /** Applies a change to the profiles list and saves it. */
  editProfiles(change: (profiles: Profile[]) => Profile[]): void;
  dispose(): void;
}

export function createStore(rpc: Rpc, watchSettings: (changed: () => void) => () => void): Store {
  const listeners = new Set<() => void>();
  const observers = new Map<string, { api: PaseoApi; observer: HostObserver }>();
  const directories = new Map<string, HostDirectory>();
  const connectErrors = new Map<string, string>();
  const deviceStorage = hasDeviceStorage();
  let hosts: readonly PluginHostSummary[] = [];
  let consumers = 0;
  let started = false;
  let timers: { reconcile?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout>; emit?: ReturnType<typeof setTimeout>; collapse?: ReturnType<typeof setTimeout> } = {};
  let stopWatch: (() => void) | null = null;

  // ---- profiles document ----
  let remote: { revision: string; doc: ProfilesDocument } | null = null;
  let profilesReady = false;
  /** Edits not yet confirmed by the host, replayed on top of every read. */
  let pendingEdits: ((profiles: Profile[]) => Profile[])[] = [];
  let writing = false;
  let savingError: string | null = null;
  let sessionProfileId: string | null = null;
  let deviceProfileId = readDeviceProfileId();
  const deviceCollapse = new Map<string, CollapseMap>();
  /** Phone collapse edits waiting for the debounced save, per profile. */
  const unsavedCollapse = new Map<string, CollapseMap>();

  const derivedCache = new Map<string, { source: HostDirectory; workspaces: HostInput["workspaces"] }>();
  let snapshot = build();

  function currentProfiles(): Profile[] {
    const base = remote?.doc.profiles ?? normalizeDocument(undefined).profiles;
    return pendingEdits.reduce((profiles, edit) => edit(profiles), base);
  }

  function build(): StoreSnapshot {
    const hostInputs: HostInput[] = hosts.map((host) => {
      const directory = host.status === "online" ? directories.get(host.serverId) : undefined;
      let workspaces: HostInput["workspaces"] = [];
      if (directory) {
        const cached = derivedCache.get(host.serverId);
        if (cached?.source === directory) workspaces = cached.workspaces;
        else {
          workspaces = deriveWorkspaces(directory.workspaces as unknown as WorkspaceLike[], directory.agents as unknown as AgentLike[]);
          derivedCache.set(host.serverId, { source: directory, workspaces });
        }
      }
      return {
        serverId: host.serverId,
        label: host.label,
        status: host.status,
        loading: host.status === "online" && (!directory || directory.loading) && !connectErrors.has(host.serverId),
        error: connectErrors.get(host.serverId) ?? directory?.error ?? null,
        workspaces,
      };
    });
    const profiles = currentProfiles();
    return {
      hosts: hostInputs,
      hostOrder: hosts.map((host) => host.serverId),
      profiles,
      profilesReady,
      sessionProfileId,
      deviceProfileId,
      deviceStorage,
      collapseFor(profileId) {
        if (deviceStorage) {
          let map = deviceCollapse.get(profileId);
          if (!map) {
            map = readDeviceCollapse(profileId) ?? profiles.find((profile) => profile.id === profileId)?.collapse ?? {};
            deviceCollapse.set(profileId, map);
          }
          return map;
        }
        return unsavedCollapse.get(profileId) ?? profiles.find((profile) => profile.id === profileId)?.collapse ?? {};
      },
      savingError,
      errors: hostInputs.flatMap((host) => (host.error ? [`${host.label}: ${host.error}`] : [])),
    };
  }

  function emitNow() {
    if (timers.emit !== undefined) clearTimeout(timers.emit);
    timers.emit = undefined;
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function emitSoon() {
    if (timers.emit === undefined) timers.emit = setTimeout(emitNow, EMIT_DELAY_MS);
  }

  // ---- hosts ----

  function observe(serverId: string) {
    try {
      const api = getPaseoClient(serverId);
      const existing = observers.get(serverId);
      // Same live connection and no failure: keep it. A replaced connection gets a new observer.
      if (existing?.api === api && !directories.get(serverId)?.error) return;
      existing?.observer.stop();
      const observer = createHostObserver(api, (directory) => {
        if (observers.get(serverId)?.observer !== observer) return;
        directories.set(serverId, directory);
        emitSoon();
      });
      observers.set(serverId, { api, observer });
      connectErrors.delete(serverId);
      observer.start();
    } catch (error) {
      connectErrors.set(serverId, error instanceof Error ? error.message : String(error));
    }
  }

  function reconcile() {
    for (const [serverId, entry] of observers) {
      if (!hosts.some((host) => host.serverId === serverId && host.status === "online")) {
        entry.observer.stop();
        observers.delete(serverId);
        directories.delete(serverId);
        derivedCache.delete(serverId);
      }
    }
    for (const host of hosts) {
      if (host.status === "online") observe(host.serverId);
      else connectErrors.delete(host.serverId);
    }
    emitNow();
  }

  function refresh() {
    for (const entry of observers.values()) entry.observer.stop();
    observers.clear();
    directories.clear();
    derivedCache.clear();
    reconcile();
    void readProfiles();
  }

  // ---- profiles persistence ----

  async function readProfiles(): Promise<void> {
    if (writing) return;
    try {
      const result = await rpc(contracts.read, {});
      if (result.status === "ready") remote = { revision: result.revision, doc: normalizeDocument(result.values) };
      else remote = { revision: result.revision, doc: normalizeDocument(undefined) };
      profilesReady = true;
      savingError = null;
    } catch (error) {
      savingError = `Profiles: ${error instanceof Error ? error.message : String(error)}`;
    }
    emitNow();
  }

  async function flush(): Promise<void> {
    if (writing) return;
    writing = true;
    try {
      while (pendingEdits.length) {
        const batch = pendingEdits.slice();
        let saved = false;
        for (let attempt = 0; attempt < WRITE_ATTEMPTS && !saved; attempt++) {
          if (!remote) {
            const result = await rpc(contracts.read, {});
            remote = { revision: result.revision, doc: normalizeDocument(result.status === "ready" ? result.values : undefined) };
            profilesReady = true;
          }
          const profiles = batch.reduce((current, edit) => edit(current), remote.doc.profiles);
          const result = await rpc(contracts.write, { revision: remote.revision, values: { profiles } });
          if (result.status === "saved") {
            remote = { revision: result.revision, doc: normalizeDocument(result.values) };
            saved = true;
          } else if (result.status === "conflict") {
            remote = null; // another client saved first: re-read and replay
          } else {
            throw new Error(result.error);
          }
        }
        if (!saved) throw new Error("too many conflicting saves");
        pendingEdits = pendingEdits.slice(batch.length);
        savingError = null;
        emitNow();
      }
    } catch (error) {
      // Edits stay pending and visible; the next edit or refresh tries again.
      savingError = `Saving profiles failed: ${error instanceof Error ? error.message : String(error)}`;
      remote = null;
      emitNow();
    } finally {
      writing = false;
    }
  }

  function editProfiles(change: (profiles: Profile[]) => Profile[]) {
    pendingEdits.push(change);
    emitNow();
    void flush();
  }

  function flushCollapse() {
    if (timers.collapse !== undefined) clearTimeout(timers.collapse);
    timers.collapse = undefined;
    if (!unsavedCollapse.size) return;
    const entries = [...unsavedCollapse];
    unsavedCollapse.clear();
    const now = Date.now();
    editProfiles((profiles) =>
      profiles.map((profile) => {
        const map = entries.find(([id]) => id === profile.id)?.[1];
        return map ? { ...profile, collapse: pruneCollapse(map, profile.settings), updatedAt: now } : profile;
      }),
    );
  }

  function setCollapse(profileId: string, map: CollapseMap) {
    if (deviceStorage) {
      deviceCollapse.set(profileId, map);
      writeDeviceCollapse(profileId, map);
      emitNow();
      return;
    }
    // Phones: written into the profile on the host, debounced so quick taps make one save.
    unsavedCollapse.set(profileId, map);
    if (timers.collapse !== undefined) clearTimeout(timers.collapse);
    timers.collapse = setTimeout(flushCollapse, COLLAPSE_SAVE_DELAY_MS);
    emitNow();
  }

  function selectProfile(id: string) {
    flushCollapse();
    sessionProfileId = id;
    if (deviceStorage) {
      deviceProfileId = id;
      writeDeviceProfileId(id);
    }
    emitNow();
  }

  // ---- lifetime ----

  function start() {
    started = true;
    reconcile();
    timers.reconcile = setInterval(reconcile, RECONCILE_MS);
    stopWatch = watchSettings(() => void readProfiles());
    void readProfiles();
  }

  function stop() {
    flushCollapse();
    if (timers.reconcile !== undefined) clearInterval(timers.reconcile);
    timers.reconcile = undefined;
    stopWatch?.();
    stopWatch = null;
    for (const entry of observers.values()) entry.observer.stop();
    observers.clear();
    directories.clear();
    derivedCache.clear();
    started = false;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain() {
      if (timers.stop !== undefined) clearTimeout(timers.stop);
      timers.stop = undefined;
      if (++consumers === 1 && !started) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--consumers === 0) timers.stop = setTimeout(stop, STOP_GRACE_MS);
      };
    },
    setHosts(next) {
      const same =
        next.length === hosts.length &&
        next.every((host, index) => {
          const old = hosts[index];
          return old?.serverId === host.serverId && old.status === host.status && old.label === host.label;
        });
      if (same) return;
      hosts = next;
      if (started) reconcile();
      else emitNow();
    },
    refresh,
    selectProfile,
    setCollapse,
    editProfiles,
    dispose() {
      if (timers.stop !== undefined) clearTimeout(timers.stop);
      if (timers.emit !== undefined) clearTimeout(timers.emit);
      if (started) stop();
      else flushCollapse();
      if (timers.collapse !== undefined) clearTimeout(timers.collapse);
      timers = {};
      listeners.clear();
    },
  };
}
