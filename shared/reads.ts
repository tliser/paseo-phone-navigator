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
 * reads were per chat do not turn every chat unread after the update.
 */
export function isAgentUnread(reads: ReadMap, serverId: string, workspaceId: string, agent: { id: string; unreadAt: number }): boolean {
  const own = reads[readAgentKey(serverId, agent.id)];
  return unreadFrom(own ?? reads[readKey(serverId, workspaceId)] ?? 0, agent.unreadAt);
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
