// Keeping the settings of every host the same. Each host stores its own copy of the profiles, the read
// state and the update settings; the app merges all copies it can reach and writes the result back.
// Every merge is idempotent and order-independent, so copies converge whoever merges first. Pure.
import type { InstalledVersion } from "./updates";
import { builtinProfiles, type Profile, type ProfilesDocument } from "./profiles";
import { markSeen, type ReadsDocument } from "./reads";

/** Per profile the newest edit wins; a deletion wins over edits made before it. */
export function mergeProfileDocs(docs: readonly ProfilesDocument[]): ProfilesDocument {
  const deleted: Record<string, number> = {};
  for (const doc of docs) for (const [id, at] of Object.entries(doc.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, at);
  const order: string[] = [];
  const newest = new Map<string, Profile>();
  for (const doc of docs) {
    for (const profile of doc.profiles) {
      const known = newest.get(profile.id);
      if (!known) order.push(profile.id);
      if (!known || profile.updatedAt > known.updatedAt) newest.set(profile.id, profile);
    }
  }
  const profiles = order.flatMap((id) => {
    const profile = newest.get(id)!;
    const gone = deleted[id];
    return gone !== undefined && gone >= profile.updatedAt ? [] : [profile];
  });
  const projectColors: ProfilesDocument["projectColors"] = {};
  for (const doc of docs) {
    for (const [key, entry] of Object.entries(doc.projectColors ?? {})) {
      const known = projectColors[key];
      if (!known || entry.at > known.at) projectColors[key] = entry;
    }
  }
  return { profiles: profiles.length ? profiles : builtinProfiles(0), deleted, projectColors };
}

/** Per workspace the later event wins: a view (positive) or a "mark unread" (negative, stored as -when). */
export function mergeReadDocs(docs: readonly ReadsDocument[], now: number): ReadsDocument {
  const seen: Record<string, number> = {};
  for (const doc of docs) {
    for (const [key, at] of Object.entries(doc.seen)) {
      const known = seen[key];
      if (known === undefined || Math.abs(at) > Math.abs(known) || (Math.abs(at) === Math.abs(known) && at < known)) seen[key] = at;
    }
  }
  return { seen: markSeen(seen, [], now) };
}

export interface UpdatesDoc {
  autoUpdate: boolean;
  updatedAt: number;
  latestVersion: InstalledVersion | null;
}

/** The newest switch setting wins; the latest version is the most recently installed one anywhere. */
export function mergeUpdateDocs(docs: readonly UpdatesDoc[]): UpdatesDoc {
  let result: UpdatesDoc = { autoUpdate: true, updatedAt: 0, latestVersion: null };
  for (const doc of docs) {
    if (doc.updatedAt > result.updatedAt) result = { ...result, autoUpdate: doc.autoUpdate, updatedAt: doc.updatedAt };
    if (doc.latestVersion && doc.latestVersion.installedAt > (result.latestVersion?.installedAt ?? 0)) result = { ...result, latestVersion: doc.latestVersion };
  }
  if (!docs.some((doc) => doc.updatedAt > 0) && docs[0]) result = { ...result, autoUpdate: docs[0].autoUpdate };
  return result;
}

/** Stable comparison of two documents, so unchanged copies are not written again. */
export function sameDoc(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
