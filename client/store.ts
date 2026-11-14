// One store for every surface (sidebar row, header buttons, screen, settings). It follows every online
// host while at least one surface is mounted, and owns the profiles document of the serving host.
// Closures only: no classes (Hermes).
import { getPaseoClient, type PluginClientContext, type PluginHostSummary } from "@getpaseo/plugin/client";
import { deriveWorkspaces, type AgentLike, type WorkspaceLike } from "../shared/derive";
import {
  normalizeDocument,
  pruneCollapse,
  type CollapseMap,
  type Profile,
  type ProfilesDocument,
} from "../shared/profiles";
import { moveRelative, type Place } from "../shared/order";
import { markSeen, normalizeReads, readKey, type ReadMap, type ReadsDocument } from "../shared/reads";
import { profilesSettings, readsSettings } from "../shared/settings";
import { mergeProfileDocs, mergeReadDocs, mergeUpdateDocs, sameDoc } from "../shared/sync";
import { checkForUpdateRpc, installedVersionRpc, updatesDocumentSchema, updatesSettings, type InstalledVersion, type UpdatesDocument } from "../shared/updates";
import { createHostSync, type HostSync, type SyncedKind } from "./host-sync";
import { createPeerDirectory, type Peer, type PeerDirectory } from "./peers";
import type { HostInput, ProjectKind } from "../shared/types";
import { hasDeviceStorage, readDeviceCollapse, readDevicePins, readDeviceProfileId, writeDeviceCollapse, writeDevicePins, writeDeviceProfileId } from "./device";
import { createHostObserver, type HostDirectory, type HostObserver } from "./host-observer";
import type { PaseoApi } from "./paseo";
import { createSyncedDoc } from "./synced-doc";
import { projectColorKey } from "../shared/colors";

const EMIT_DELAY_MS = 250;
const RECONCILE_MS = 15_000;
const STOP_GRACE_MS = 5_000;
const COLLAPSE_SAVE_DELAY_MS = 3_000;
/** Views that land within this window are written together. */
const READ_SAVE_DELAY_MS = 800;

type Rpc = PluginClientContext["rpc"];

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
  /** Pinned workspaces ("serverId:workspaceId") of a profile, shared by every device using it. */
  pinsFor(profileId: string): ReadonlySet<string>;
  /** Folder colour id per project ("serverId:projectId"), shared by every profile and device. */
  projectColors: Readonly<Record<string, string>>;
  /** When you last viewed each workspace ("serverId:workspaceId"). */
  reads: ReadMap;
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
  /** Pins or unpins a workspace at the top of its project, in the profile. */
  setPinned(profileId: string, serverId: string, workspaceId: string, pinned: boolean): void;
  /** Gives a project's folder a colour (a PROJECT_COLORS id). */
  setProjectColor(serverId: string, projectId: string, color: string): void;
  /** Renames a workspace on its host. */
  renameWorkspace(serverId: string, workspaceId: string, title: string): Promise<void>;
  /** Applies a change to the profiles list and saves it. */
  editProfiles(change: (profiles: Profile[]) => Profile[]): void;
  /** Moves one item within its group of the profile's manual order. `ids` is the group's full current order. */
  move(profileId: string, group: string, ids: readonly string[], id: string, targetId: string, place: Place): void;
  /** You viewed these workspaces now: they stop being unread. */
  markRead(serverId: string, workspaceIds: readonly string[]): void;
  /** Show the workspace as unread again until you next view it. */
  markUnread(serverId: string, workspaceId: string): void;
  /**
   * Agents and models the host can launch in this folder. Paseo discovers providers lazily, so the
   * first answer may still have some loading: `onChange` gets every newer list until none is
   * loading. Returns a function that stops listening.
   */
  watchProviders(serverId: string, cwd: string, onChange: (state: ProviderListState) => void): () => void;
  /** On/off options (e.g. Auto Accept) the provider offers for this agent setup. */
  providerToggles(serverId: string, draft: { provider: string; model: string; modeId?: string; cwd: string }): Promise<ProviderToggle[]>;
  /** Creates a workspace with its first agent or terminal. Nothing exists before this resolves. Returns the workspace id. */
  launchWorkspace(serverId: string, input: LaunchInput): Promise<string>;
  archiveWorkspace(serverId: string, workspaceId: string): Promise<void>;
  dispose(): void;
}

export interface ProviderListState {
  ready: ProviderChoice[];
  /** Labels of providers the host is still discovering. */
  loading: string[];
  error: string | null;
}

export interface ProviderChoice {
  id: string;
  label: string;
  models: { id: string; label: string; isDefault: boolean }[];
  modes: { id: string; label: string }[];
  defaultModeId: string | null;
}

export interface ProviderToggle {
  id: string;
  label: string;
  description: string | null;
  value: boolean;
}

export type LaunchInput = {
  projectId: string;
  kind: ProjectKind;
  rootPath: string;
  /** Git projects only: a new worktree (optionally on a named branch) or the project folder itself. */
  isolation: "worktree" | "local";
  branchName?: string;
  launch: { kind: "agent"; provider: string; model: string; modeId?: string; prompt?: string; featureValues?: Record<string, boolean> } | { kind: "terminal" };
};

export interface StoreOptions {
  /** This host's serverId; with it the store joins the other hosts' copies and keeps settings in sync. */
  resolveSelf?(): Promise<string>;
  directory?: PeerDirectory;
}

export function createStore(rpc: Rpc, watchSettings: (changed: () => void) => () => void, options: StoreOptions = {}): Store {
  const listeners = new Set<() => void>();
  const observers = new Map<string, { api: PaseoApi; observer: HostObserver }>();
  const directories = new Map<string, HostDirectory>();
  const connectErrors = new Map<string, string>();
  const deviceStorage = hasDeviceStorage();
  let hosts: readonly PluginHostSummary[] = [];
  let consumers = 0;
  let started = false;
  let timers: { reconcile?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout>; emit?: ReturnType<typeof setTimeout>; collapse?: ReturnType<typeof setTimeout>; reads?: ReturnType<typeof setTimeout> } = {};
  let stopWatch: (() => void) | null = null;

  // ---- host documents ----
  const profilesDoc = createSyncedDoc<ProfilesDocument>({ rpc, settingsId: profilesSettings.id, label: "profiles", normalize: normalizeDocument, changed: () => emitNow() });
  const readsDoc = createSyncedDoc<ReadsDocument>({ rpc, settingsId: readsSettings.id, label: "read state", normalize: normalizeReads, changed: () => emitNow() });
  const normalizeUpdates = (raw: unknown): UpdatesDocument => {
    const parsed = updatesDocumentSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : updatesDocumentSchema.parse({});
  };
  const updatesDoc = createSyncedDoc<UpdatesDocument>({ rpc, settingsId: updatesSettings.id, label: "updates", normalize: normalizeUpdates, changed: () => undefined });

  // ---- other hosts ----
  const directory = options.directory ?? createPeerDirectory();
  let selfId: string | null = null;
  let unregister: (() => void) | null = null;
  let stopPeers: (() => void) | null = null;
  let ownVersion: Promise<InstalledVersion | null> | null = null;
  const kinds = [
    { settingsId: profilesSettings.id, doc: profilesDoc, normalize: normalizeDocument, merge: mergeProfileDocs, same: sameDoc },
    { settingsId: readsSettings.id, doc: readsDoc, normalize: normalizeReads, merge: (docs: readonly ReadsDocument[]) => mergeReadDocs(docs, Date.now()), same: sameDoc },
    { settingsId: updatesSettings.id, doc: updatesDoc, normalize: normalizeUpdates, merge: mergeUpdateDocs, same: sameDoc },
  ] as SyncedKind<unknown>[];
  /** This host's copy is skipped: the synced documents hold it. Only online hosts are asked. */
  const reachablePeers = (): Peer[] =>
    directory.list().filter((peer) => peer.serverId !== selfId && hosts.some((host) => host.serverId === peer.serverId && host.status === "online"));
  let hostSync: HostSync | null = null;
  function startHostSync() {
    if (hostSync || !selfId) return;
    hostSync = createHostSync({
      kinds,
      peers: reachablePeers,
      installedVersion: (peer) => peer.rpc(installedVersionRpc, {}),
      onVersions: (versions) => void publishLatest(versions),
      // An older copy dropped part of the settings: ask it to update itself (once per session).
      onOutdated: (peer) => void peer.rpc(checkForUpdateRpc, {}).catch(() => undefined),
    });
    stopPeers = directory.subscribe(() => hostSync?.schedule());
    hostSync.schedule();
  }
  /** Records the newest version installed anywhere; every host's server compares it with its own. */
  async function publishLatest(versions: InstalledVersion[]) {
    ownVersion ??= rpc(installedVersionRpc, {}).catch(() => null);
    const own = await ownVersion;
    const all = own ? [own, ...versions] : versions;
    const newest = all.reduce<InstalledVersion | null>((best, version) => (version.installedAt > (best?.installedAt ?? 0) ? version : best), null);
    const known = updatesDoc.value().latestVersion;
    if (!newest || !updatesDoc.ready() || (known && known.installedAt >= newest.installedAt)) return;
    updatesDoc.edit((doc) => (doc.latestVersion && doc.latestVersion.installedAt >= newest.installedAt ? doc : { ...doc, latestVersion: newest }));
  }
  async function joinPeers() {
    if (!options.resolveSelf || selfId) return;
    try {
      selfId = await options.resolveSelf();
    } catch {
      return; // no sync this session; every host keeps working with its own copy
    }
    unregister = directory.register({ serverId: selfId, rpc });
    if (started) startHostSync();
  }
  void joinPeers();
  /** Reads changed on this device and not handed to the document yet (batched). */
  let unsavedReads: Record<string, number> = {};
  /** "Mark unread" stores the key as -now until you view it again. */
  let sessionProfileId: string | null = null;
  let deviceProfileId = readDeviceProfileId();
  const deviceCollapse = new Map<string, CollapseMap>();
  /** Phone collapse edits waiting for the debounced save, per profile. */
  const unsavedCollapse = new Map<string, CollapseMap>();

  const derivedCache = new Map<string, { source: HostDirectory; workspaces: HostInput["workspaces"] }>();
  let snapshot = build();

  function currentProfiles(): Profile[] {
    return profilesDoc.value().profiles;
  }

  function currentReads(): ReadMap {
    const saved = readsDoc.value().seen;
    return Object.keys(unsavedReads).length ? { ...saved, ...unsavedReads } : saved;
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
      profilesReady: profilesDoc.ready(),
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
      pinsFor(profileId) {
        return new Set(profiles.find((profile) => profile.id === profileId)?.pins ?? []);
      },
      reads: currentReads(),
      projectColors: Object.fromEntries(Object.entries(profilesDoc.value().projectColors).map(([key, entry]) => [key, entry.color])),
      savingError: profilesDoc.error() ?? readsDoc.error(),
      errors: hostInputs.flatMap((host) => (host.error ? [`${host.label}: ${host.error}`] : [])),
    };
  }

  function emitNow() {
    hostSync?.schedule();
    if (timers.emit !== undefined) clearTimeout(timers.emit);
    timers.emit = undefined;
    migrateDevicePins();
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

  function apiFor(serverId: string): PaseoApi {
    return observers.get(serverId)?.api ?? getPaseoClient(serverId);
  }

  function refresh() {
    for (const entry of observers.values()) entry.observer.stop();
    observers.clear();
    directories.clear();
    derivedCache.clear();
    reconcile();
    void profilesDoc.read();
    void readsDoc.read();
  }

  function editProfiles(change: (profiles: Profile[]) => Profile[]) {
    profilesDoc.edit((doc) => {
      const profiles = change(doc.profiles);
      // Removed profiles are remembered, so syncing with a host that still has them does not bring them back.
      const now = Date.now();
      const deleted = { ...doc.deleted };
      for (const old of doc.profiles) if (!profiles.some((profile) => profile.id === old.id)) deleted[old.id] = Math.max(now, old.updatedAt);
      for (const profile of profiles) delete deleted[profile.id];
      return { ...doc, profiles, deleted };
    });
  }

  function move(profileId: string, group: string, ids: readonly string[], id: string, targetId: string, place: Place) {
    const next = moveRelative(ids, id, targetId, place);
    if (next.join("\n") === ids.join("\n")) return;
    const now = Date.now();
    editProfiles((profiles) =>
      profiles.map((profile) => (profile.id === profileId ? { ...profile, order: { ...profile.order, [group]: next }, updatedAt: now } : profile)),
    );
  }

  // ---- read state ----

  function flushReads() {
    if (timers.reads !== undefined) clearTimeout(timers.reads);
    timers.reads = undefined;
    const batch = unsavedReads;
    if (!Object.keys(batch).length) return;
    unsavedReads = {};
    const now = Date.now();
    readsDoc.edit((doc) => {
      const seen: Record<string, number> = { ...doc.seen };
      // Negative = marked unread now (always wins); otherwise the later view wins.
      for (const [key, at] of Object.entries(batch)) {
        if (at < 0) seen[key] = at;
        else seen[key] = Math.max(seen[key] ?? 0, at);
      }
      return { seen: markSeen(seen, [], now) };
    });
  }

  function scheduleReads() {
    if (timers.reads !== undefined) clearTimeout(timers.reads);
    timers.reads = setTimeout(flushReads, READ_SAVE_DELAY_MS);
    emitNow();
  }

  function markRead(serverId: string, workspaceIds: readonly string[]) {
    if (!workspaceIds.length) return;
    const now = Date.now();
    for (const id of workspaceIds) unsavedReads[readKey(serverId, id)] = now;
    scheduleReads();
  }

  function markUnread(serverId: string, workspaceId: string) {
    // Kept as an explicit mark: a workspace whose news Paseo has already cleared would otherwise read as read again.
    unsavedReads[readKey(serverId, workspaceId)] = -Date.now();
    scheduleReads();
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

  function setPinned(profileId: string, serverId: string, workspaceId: string, pinned: boolean) {
    const key = readKey(serverId, workspaceId);
    const apply = (pins: readonly string[]) => (pinned ? (pins.includes(key) ? [...pins] : [...pins, key]) : pins.filter((value) => value !== key));
    // Pins live in the profile on the host, so every device using the profile sees them.
    const now = Date.now();
    editProfiles((profiles) => profiles.map((profile) => (profile.id === profileId ? { ...profile, pins: apply(profile.pins), updatedAt: now } : profile)));
  }

  /** Earlier versions kept desktop pins in this browser only: move them into the profiles once. */
  let pinsMigrated = !deviceStorage;
  function migrateDevicePins() {
    if (pinsMigrated || !profilesDoc.ready()) return;
    pinsMigrated = true;
    const moves = currentProfiles().flatMap((profile) => {
      const local = readDevicePins(profile.id) ?? [];
      return local.length ? [{ id: profile.id, local }] : [];
    });
    if (!moves.length) return;
    const now = Date.now();
    editProfiles((profiles) =>
      profiles.map((profile) => {
        const move = moves.find((entry) => entry.id === profile.id);
        return move ? { ...profile, pins: [...new Set([...profile.pins, ...move.local])], updatedAt: now } : profile;
      }),
    );
    for (const move of moves) writeDevicePins(move.id, []);
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
    stopWatch = watchSettings(() => {
      void profilesDoc.read();
      void readsDoc.read();
      void updatesDoc.read();
    });
    void profilesDoc.read();
    void readsDoc.read();
    void updatesDoc.read();
    startHostSync();
  }

  function stop() {
    flushCollapse();
    flushReads();
    if (timers.reconcile !== undefined) clearInterval(timers.reconcile);
    timers.reconcile = undefined;
    stopWatch?.();
    stopWatch = null;
    stopPeers?.();
    stopPeers = null;
    hostSync?.dispose();
    hostSync = null;
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
    setPinned,
    setProjectColor(serverId, projectId, color) {
      const key = projectColorKey(serverId, projectId);
      const at = Date.now();
      profilesDoc.edit((doc) => ({ ...doc, projectColors: { ...doc.projectColors, [key]: { color, at } } }));
    },
    async renameWorkspace(serverId, workspaceId, title) {
      await apiFor(serverId).workspaces.ref(workspaceId).setTitle(title.trim() || null);
    },
    editProfiles,
    move,
    markRead,
    markUnread,
    watchProviders(serverId, cwd, onChange) {
      const api = apiFor(serverId);
      let live = true;
      let done = false;
      const publish = (entries: readonly ProviderEntry[]) => {
        if (!live || done) return;
        const state = providerListState(entries);
        if (!state.loading.length) done = true;
        onChange(state);
      };
      const fail = (reason: unknown) => {
        if (live && !done) onChange({ ready: [], loading: [], error: reason instanceof Error ? reason.message : String(reason) });
      };
      // Updates arrive while discovery runs; the snapshot gives the current state at once.
      const unsubscribe = api.providers.subscribe((update) => {
        if (!update.cwd || update.cwd === cwd) publish(update.entries);
      });
      api.providers.snapshot({ cwd }).then((snapshot) => publish(snapshot.entries), fail);
      // Safety net if no update ever comes: wait for discovery to finish once.
      api.providers.waitForReady({ cwd, timeoutMs: 60_000 }).then((snapshot) => publish(snapshot.entries), () => undefined);
      return () => {
        live = false;
        unsubscribe();
      };
    },
    async providerToggles(serverId, draft) {
      const result = await apiFor(serverId).providers.listFeatures({
        provider: `${draft.provider}/${draft.model}`,
        cwd: draft.cwd,
        ...(draft.modeId ? { modeId: draft.modeId } : {}),
      });
      return (result.features ?? []).flatMap((feature) =>
        feature.type === "toggle" ? [{ id: feature.id, label: feature.label, description: feature.description ?? null, value: feature.value }] : [],
      );
    },
    async launchWorkspace(serverId, input) {
      const api = apiFor(serverId);
      const branchName = input.branchName?.trim();
      const source =
        input.kind === "git" && input.isolation === "worktree"
          ? { kind: "worktree" as const, projectId: input.projectId, cwd: input.rootPath, ...(branchName ? { branchName } : {}) }
          : { kind: "directory" as const, path: input.rootPath, projectId: input.projectId };
      const { launch } = input;
      const prompt = launch.kind === "agent" ? launch.prompt?.trim() : undefined;
      // The host observer's subscription brings the new workspace into the tree.
      const handle = await api.workspaces.create({
        source,
        ...(launch.kind === "agent"
          ? {
              agent: {
                config: {
                  provider: `${launch.provider}/${launch.model}`,
                  ...(launch.modeId ? { modeId: launch.modeId } : {}),
                  ...(launch.featureValues && Object.keys(launch.featureValues).length ? { featureValues: launch.featureValues } : {}),
                },
                cwd: input.rootPath,
                ...(prompt ? { prompt } : {}),
              },
            }
          : {}),
      });
      if (launch.kind === "terminal") await handle.terminals.create();
      return handle.id;
    },
    async archiveWorkspace(serverId, workspaceId) {
      await apiFor(serverId).workspaces.archive(workspaceId);
    },
    dispose() {
      if (timers.stop !== undefined) clearTimeout(timers.stop);
      if (timers.emit !== undefined) clearTimeout(timers.emit);
      if (started) stop();
      else {
        flushCollapse();
        flushReads();
      }
      if (timers.collapse !== undefined) clearTimeout(timers.collapse);
      if (timers.reads !== undefined) clearTimeout(timers.reads);
      timers = {};
      listeners.clear();
      unregister?.();
    },
  };
}

interface ProviderEntry {
  provider: string;
  label?: string | null;
  enabled?: boolean;
  status: string;
  defaultModeId?: string | null;
  models?: readonly { id: string; label: string; isDefault?: boolean; isSelectable?: boolean }[] | null;
  modes?: readonly { id: string; label: string }[] | null;
}

/** Ready providers with selectable models, and which enabled providers are still being discovered. */
export function providerListState(entries: readonly ProviderEntry[]): ProviderListState {
  const enabled = entries.filter((entry) => entry.enabled !== false);
  return {
    ready: enabled
      .filter((entry) => entry.status === "ready" && (entry.models?.length ?? 0) > 0)
      .map((entry) => ({
        id: entry.provider,
        label: entry.label ?? entry.provider,
        models: (entry.models ?? []).filter((model) => model.isSelectable !== false).map((model) => ({ id: model.id, label: model.label, isDefault: !!model.isDefault })),
        modes: (entry.modes ?? []).map((mode) => ({ id: mode.id, label: mode.label })),
        defaultModeId: entry.defaultModeId ?? null,
      })),
    loading: enabled.filter((entry) => entry.status === "loading").map((entry) => entry.label ?? entry.provider),
    error: null,
  };
}
