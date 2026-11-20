// Read/unread state, kept by the plugin: Paseo clears its own "finished" flag as soon as a chat is on screen,
// so the plugin remembers the news itself (`newsKey`) and only your marks clear it. Pure.
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
/**
 * When a chat last finished a turn Paseo flagged as news (epoch ms), remembered because Paseo drops the
 * flag once the chat is on screen. Merges like a read mark: the later value wins.
 */
export const newsKey = (serverId: string, agentId: string) => `${serverId}:news:${agentId}`;

/** News older than this is no longer news (also how long marks are kept, so a dropped mark cannot revive it). */
export const KEEP_DAYS = 60;
const DAY_MS = 86_400_000;

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
 * reading: it clears an earlier "mark unread", and only a turn finishing after it is news. News is
 * Paseo's live flag or the remembered one, whichever is later; with `now`, news older than KEEP_DAYS
 * only counts when you marked the chat unread.
 */
export function isAgentUnread(reads: ReadMap, serverId: string, workspaceId: string, agent: { id: string; unreadAt: number; promptAt?: number }, now?: number): boolean {
  const mark = reads[readAgentKey(serverId, agent.id)] ?? reads[readKey(serverId, workspaceId)] ?? 0;
  const prompt = agent.promptAt ?? 0;
  const seen = prompt > Math.abs(mark) ? prompt : mark;
  const news = Math.max(agent.unreadAt, reads[newsKey(serverId, agent.id)] ?? 0);
  if (now !== undefined && seen >= 0 && news < now - KEEP_DAYS * DAY_MS) return false;
  return unreadFrom(seen, news);
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

// Room for a read mark and a remembered news time per chat. A read mark is newer than the news it
// clears, so trimming drops the news first and cannot turn a read chat unread.
const MAX_ENTRIES = 2000;

/** Marks keys as seen at `now`, then drops entries older than KEEP_DAYS and keeps the newest MAX_ENTRIES. */
export function markSeen(reads: ReadMap, keys: readonly string[], now: number): Record<string, number> {
  const next: Record<string, number> = { ...reads };
  for (const key of keys) next[key] = Math.max(next[key] ?? 0, now);
  const cutoff = now - KEEP_DAYS * DAY_MS;
  const kept = Object.entries(next)
    .filter(([, at]) => Math.abs(at) >= cutoff)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}
