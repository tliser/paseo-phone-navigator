// Read/unread state, kept by the plugin because plugins cannot clear Paseo's own attention flag. Pure.
import { z } from "zod";

/**
 * Key -> when you marked it read (epoch ms). A negative value means you marked it unread at that time
 * (as -epoch): it stays unread until you mark it read again, whatever Paseo reports. Chats use
 * `readAgentKey`; `readKey` is for workspaces without chats and for entries from before per-chat reads.
 */
export type ReadMap = Readonly<Record<string, number>>;

export const readsDocumentSchema = z.object({
  seen: z.record(z.string(), z.number()).default({}),
});
export type ReadsDocument = z.output<typeof readsDocumentSchema>;

export const readKey = (serverId: string, workspaceId: string) => `${serverId}:${workspaceId}`;
export const readAgentKey = (serverId: string, agentId: string) => `${serverId}:agent:${agentId}`;
/**
 * When you removed a workspace from the Recent view (positive) or put it back (negative, as -when). It
 * lives in the reads document so it syncs and merges like a read mark: the later event wins.
 */
export const recentKey = (serverId: string, workspaceId: string) => `${serverId}:recent:${workspaceId}`;

/** You removed it from Recent and have not sent it a prompt since. */
export function removedFromRecent(reads: ReadMap, serverId: string, workspace: { id: string; orderAt: number }): boolean {
  const mark = reads[recentKey(serverId, workspace.id)] ?? 0;
  return mark > 0 && workspace.orderAt <= mark;
}

export function normalizeReads(raw: unknown): ReadsDocument {
  const parsed = readsDocumentSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { seen: {} };
}

function unreadFrom(seen: number, unreadAt: number): boolean {
  if (seen < 0) return true;
  if (!unreadAt) return false;
  return unreadAt > seen;
}

/** Unread when you marked it so, or when something new happened (`unreadAt`) after it was marked read. */
export function isUnread(reads: ReadMap, serverId: string, workspaceId: string, unreadAt: number): boolean {
  return unreadFrom(reads[readKey(serverId, workspaceId)] ?? 0, unreadAt);
}

/**
 * The same for one chat. Without its own entry the workspace's entry counts, so marks made before
 * reads were per chat do not turn every chat unread after the update. Sending a prompt counts as
 * reading: it clears an earlier "put back in Inbox", and only a turn finishing after it is news.
 */
export function isAgentUnread(reads: ReadMap, serverId: string, workspaceId: string, agent: { id: string; unreadAt: number; promptAt?: number }): boolean {
  const mark = reads[readAgentKey(serverId, agent.id)] ?? reads[readKey(serverId, workspaceId)] ?? 0;
  const prompt = agent.promptAt ?? 0;
  const seen = prompt > Math.abs(mark) ? prompt : mark;
  return unreadFrom(seen, agent.unreadAt);
}

/** A key and the value a mark wrote, so it can be undone. */
export interface ReadChange {
  key: string;
  after: number;
}

/**
 * Undo of `changes` at `now`, as fresh marks: hosts merge reads by the latest event, so an older value
 * written back would lose to the change. A read mark becomes unread again, an unread mark read. Keys
 * changed since (another device, a later Done) are left alone.
 */
export function undoReads(current: ReadMap, changes: readonly ReadChange[], now: number): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const { key, after } of changes) if (current[key] === after) marks[key] = after < 0 ? now : -now;
  return marks;
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
