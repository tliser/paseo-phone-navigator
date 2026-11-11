// Read/unread state, kept by the plugin because plugins cannot clear Paseo's own attention flag. Pure.
import { z } from "zod";

/**
 * "<serverId>:<workspaceId>" -> when you last viewed it (epoch ms). A negative value means you marked
 * it unread at that time (as -epoch): it stays unread until you view it again, whatever Paseo reports.
 */
export type ReadMap = Readonly<Record<string, number>>;

export const readsDocumentSchema = z.object({
  seen: z.record(z.string(), z.number()).default({}),
});
export type ReadsDocument = z.output<typeof readsDocumentSchema>;

export const readKey = (serverId: string, workspaceId: string) => `${serverId}:${workspaceId}`;

export function normalizeReads(raw: unknown): ReadsDocument {
  const parsed = readsDocumentSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { seen: {} };
}

/** Unread when you marked it so, or when something new happened (`unreadAt`) after the last view. */
export function isUnread(reads: ReadMap, serverId: string, workspaceId: string, unreadAt: number): boolean {
  const seen = reads[readKey(serverId, workspaceId)] ?? 0;
  if (seen < 0) return true;
  if (!unreadAt) return false;
  return unreadAt > seen;
}

const KEEP_DAYS = 60;
const MAX_ENTRIES = 1000;

/** Marks keys as seen at `now`, then drops entries older than 60 days and keeps the newest 1000. */
export function markSeen(reads: ReadMap, keys: readonly string[], now: number): Record<string, number> {
  const next: Record<string, number> = { ...reads };
  for (const key of keys) next[key] = Math.max(next[key] ?? 0, now);
  const cutoff = now - KEEP_DAYS * 86_400_000;
  const kept = Object.entries(next)
    .filter(([, at]) => Math.abs(at) >= cutoff)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

/** Merge two copies (another device saved meanwhile): the later view wins per key. */
export function mergeReads(a: ReadMap, b: ReadMap): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, at] of Object.entries(b)) out[key] = Math.max(out[key] ?? 0, at);
  return out;
}
