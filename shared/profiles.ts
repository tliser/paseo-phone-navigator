// Profiles: schema, built-ins, resolution, and the collapse map. Pure.
import { z } from "zod";
import type { Platform } from "./types";

const platformSchema = z.enum(["ios", "android", "web"]);
/** The Inbox (earlier "attention") was a view; it is a sheet now, so a profile that opened on it opens on Active. */
const filterSchema = z.preprocess((value) => (value === "attention" || value === "inbox" ? "active" : value), z.enum(["all", "recent", "active", "pinned"]));

const ROW_FIELDS = ["branch", "model", "diff"] as const;
export type RowField = (typeof ROW_FIELDS)[number];

/** Known values once each, in the given order; missing ones are appended. */
export function normalizeFieldOrder(raw: unknown): RowField[] {
  const given = Array.isArray(raw) ? raw.filter((value): value is RowField => (ROW_FIELDS as readonly unknown[]).includes(value)) : [];
  return [...new Set([...given, ...ROW_FIELDS])];
}

const profileSettingsSchema = z.object({
  density: z.enum(["compact", "comfortable"]).default("compact"),
  show: z
    .object({
      model: z.boolean().default(true),
      branch: z.boolean().default(true),
      diff: z.boolean().default(true),
      time: z.boolean().default(true),
      /** Tab marks and the tab list of a workspace. */
      tabs: z.boolean().default(true),
      /** Sub-agents under their parent tab; has no effect while `tabs` is off. */
      subagents: z.boolean().default(true),
    })
    .default({ model: true, branch: true, diff: true, time: true, tabs: true, subagents: true }),
  /** Order of the values on a row's second line. */
  fieldOrder: z.unknown().optional().transform(normalizeFieldOrder),
  /** Rows that ask you, failed or are unread say why instead of branch and model. */
  statusLine: z.boolean().default(true),
  defaultFilter: filterSchema.default("all"),
  hideDone: z.enum(["off", "1d", "7d"]).default("off"),
  /** The Recent filter shows workspaces active within this many days. */
  recentDays: z.number().int().min(1).max(90).default(2),
  /** "auto": asking, unread, running first, then by activity. "manual": your drag-and-drop order. */
  sort: z.enum(["auto", "manual"]).default("auto"),
  hiddenHosts: z.array(z.string()).default([]),
  newGroupsExpanded: z
    .object({ hosts: z.boolean().default(true), projects: z.boolean().default(false) })
    .default({ hosts: true, projects: false }),
  /** Hovering (desktop) or long-pressing (phones) a row shows its full names in a card. */
  namesCard: z.boolean().default(true),
});

const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  platform: platformSchema.nullable().default(null),
  updatedAt: z.number().default(0),
  settings: profileSettingsSchema.default(() => profileSettingsSchema.parse({})),
  /** Only keys that differ from the defaults in `settings.newGroupsExpanded`. true = collapsed. */
  collapse: z.record(z.string(), z.boolean()).default({}),
  /** Manual order per group: "host:<id>" -> project ids, "proj:<id>:<projectId>" -> workspace ids. */
  order: z.record(z.string(), z.array(z.string())).default({}),
  /** Pinned workspaces ("serverId:workspaceId"). Only used where the device has no storage of its own (phones). */
  pins: z.array(z.string()).default([]),
});

export type ProfileSettings = z.output<typeof profileSettingsSchema>;
export type Profile = z.output<typeof profileSchema>;
export type CollapseMap = Readonly<Record<string, boolean>>;

export const profilesDocumentSchema = z.object({
  profiles: z.array(profileSchema).default(() => builtinProfiles(0)),
  /** Deleted profiles (id -> when), so a host that still has one does not bring it back when hosts sync. */
  deleted: z.record(z.string(), z.number()).default({}),
  /**
   * Folder colour per project ("serverId:projectId"), for every profile and device. Set by long-pressing
   * the folder icon; `color` is a PROJECT_COLORS id ("default" = theme accent). `at` lets the newest win.
   */
  projectColors: z.record(z.string(), z.object({ color: z.string(), at: z.number() })).default({}),
});
export type ProfilesDocument = z.output<typeof profilesDocumentSchema>;

export function defaultSettings(): ProfileSettings {
  return profileSettingsSchema.parse({});
}

const PHONE_ID = "phone";
const DESKTOP_ID = "desktop";

export function builtinProfiles(now: number): Profile[] {
  return [
    {
      id: PHONE_ID,
      name: "Phone",
      platform: "ios",
      updatedAt: now,
      settings: { ...defaultSettings(), density: "compact", defaultFilter: "active" },
      collapse: {},
      order: {},
      pins: [],
    },
    {
      id: DESKTOP_ID,
      name: "Desktop",
      platform: "web",
      updatedAt: now,
      settings: { ...defaultSettings(), density: "comfortable", defaultFilter: "all", sort: "manual" },
      collapse: {},
      order: {},
      pins: [],
    },
  ];
}

/** The document with built-ins when empty or unreadable; never returns zero profiles. */
export function normalizeDocument(raw: unknown): ProfilesDocument {
  const parsed = profilesDocumentSchema.safeParse(raw ?? {});
  const profiles = parsed.success ? parsed.data.profiles : [];
  const deleted = parsed.success ? parsed.data.deleted : {};
  const projectColors = parsed.success ? parsed.data.projectColors : {};
  return { profiles: profiles.length ? dedupe(profiles) : builtinProfiles(0), deleted, projectColors };
}

function dedupe(profiles: Profile[]): Profile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => (seen.has(profile.id) ? false : (seen.add(profile.id), true)));
}

export type ResolvedVia = "session" | "device" | "platform" | "fallback";

/**
 * Which profile this client shows, in order: the choice made this session, the device's stored
 * choice (web and desktop), the first profile bound to this platform, else Phone on compact
 * layouts and Desktop otherwise (else the first profile).
 */
export function resolveProfile(
  profiles: readonly Profile[],
  input: { sessionId: string | null; deviceId: string | null; platform: Platform; compact: boolean },
): { profile: Profile; via: ResolvedVia } {
  const byId = (id: string | null) => (id ? profiles.find((profile) => profile.id === id) : undefined);
  const session = byId(input.sessionId);
  if (session) return { profile: session, via: "session" };
  const device = byId(input.deviceId);
  if (device) return { profile: device, via: "device" };
  const bound = profiles.find((profile) => profile.platform === input.platform);
  if (bound) return { profile: bound, via: "platform" };
  const fallback = byId(input.compact ? PHONE_ID : DESKTOP_ID) ?? profiles[0];
  if (!fallback) throw new Error("no profiles");
  return { profile: fallback, via: "fallback" };
}

// ---- collapse keys and map ----

export const hostKey = (serverId: string) => `host:${serverId}`;
export const projectKey = (serverId: string, projectId: string) => `proj:${serverId}:${projectId}`;
/** A workspace's tab list; folded unless opened. */
export const agentsKey = (serverId: string, workspaceId: string) => `agents:${serverId}:${workspaceId}`;
/** The sub-agents under one tab; folded unless opened. */
export const subagentsKey = (serverId: string, workspaceId: string, agentId: string) => `subagents:${serverId}:${workspaceId}:${agentId}`;

function defaultCollapsed(key: string, settings: ProfileSettings): boolean {
  if (key.startsWith("agents:") || key.startsWith("subagents:")) return true;
  return key.startsWith("host:") ? !settings.newGroupsExpanded.hosts : !settings.newGroupsExpanded.projects;
}

export function isCollapsed(map: CollapseMap, key: string, settings: ProfileSettings): boolean {
  const stored = map[key];
  return stored === undefined ? defaultCollapsed(key, settings) : stored;
}

/** Sets one key, keeping only values that differ from the default. Returns a new map. */
export function setCollapsed(
  map: CollapseMap,
  key: string,
  collapsed: boolean,
  settings: ProfileSettings,
): Record<string, boolean> {
  const next = { ...map };
  if (collapsed === defaultCollapsed(key, settings)) delete next[key];
  else next[key] = collapsed;
  return next;
}

export function toggleCollapsed(map: CollapseMap, key: string, settings: ProfileSettings): Record<string, boolean> {
  return setCollapsed(map, key, !isCollapsed(map, key, settings), settings);
}

/** Drops entries that equal the default (e.g. after the defaults changed). */
export function pruneCollapse(map: CollapseMap, settings: ProfileSettings): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== defaultCollapsed(key, settings)) next[key] = value;
  }
  return next;
}

/**
 * Expand/collapse all: if any group is collapsed, expand everything; otherwise collapse to host
 * level (hosts collapsed, projects back to their default). `keys` are the groups currently shown.
 */
export function expandOrCollapseAll(
  map: CollapseMap,
  keys: readonly string[],
  settings: ProfileSettings,
): Record<string, boolean> {
  const anyCollapsed = keys.some((key) => isCollapsed(map, key, settings));
  let next: Record<string, boolean> = { ...map };
  for (const key of keys) {
    if (anyCollapsed) next = setCollapsed(next, key, false, settings);
    else if (key.startsWith("host:")) next = setCollapsed(next, key, true, settings);
    else delete next[key];
  }
  return next;
}

// ---- profile edits ----

export function newProfileId(existing: readonly Profile[], now: number): string {
  let id = `p${now.toString(36)}`;
  for (let n = 1; existing.some((profile) => profile.id === id); n++) id = `p${now.toString(36)}${n}`;
  return id;
}

/** Binds `id` to `platform`; any other profile bound to it is unbound. */
export function bindPlatform(
  profiles: readonly Profile[],
  id: string,
  platform: Platform | null,
  now: number,
): Profile[] {
  return profiles.map((profile) => {
    if (profile.id === id) return { ...profile, platform, updatedAt: now };
    if (platform && profile.platform === platform) return { ...profile, platform: null, updatedAt: now };
    return profile;
  });
}

/**
 * Opens the host and project of every workspace in `newlyNeedsYou` ("serverId:projectId" pairs), so
 * something that starts asking you is never hidden in a folded group. Returns the same map when
 * nothing changes. Folding a group again later sticks until the next new request.
 */
export function expandForAttention(
  map: CollapseMap,
  newlyNeedsYou: readonly { serverId: string; projectId: string }[],
  settings: ProfileSettings,
): CollapseMap {
  let next: CollapseMap = map;
  for (const { serverId, projectId } of newlyNeedsYou) {
    for (const key of [hostKey(serverId), projectKey(serverId, projectId)]) {
      if (isCollapsed(next, key, settings)) next = setCollapsed(next, key, false, settings);
    }
  }
  return next;
}
