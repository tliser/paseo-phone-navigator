// Manual order: pure helpers.
// An order list holds the ids of one group's children: project ids under "host:<serverId>",
// workspace ids under "proj:<serverId>:<projectId>".

export type OrderMap = Readonly<Record<string, readonly string[]>>;
export type Place = "before" | "after";

/**
 * Sorts `items` by the saved order. Items not in it yet (new ones) come first, in `auto` order,
 * so a new workspace shows up at the top of its project rather than hidden at the bottom.
 */
export function applyOrder<T>(items: readonly T[], id: (item: T) => string, order: readonly string[] | undefined, auto: (a: T, b: T) => number): T[] {
  if (!order?.length) return [...items].sort(auto);
  const rank = new Map(order.map((value, index) => [value, index]));
  const fresh = items.filter((item) => !rank.has(id(item))).sort(auto);
  const known = items.filter((item) => rank.has(id(item))).sort((a, b) => (rank.get(id(a)) ?? 0) - (rank.get(id(b)) ?? 0));
  return [...fresh, ...known];
}

/**
 * Moves `id` before or after `targetId` within `ids` (the group's complete current order, hidden
 * items included, so filtering never loses their place). Unknown ids leave the list unchanged.
 */
export function moveRelative(ids: readonly string[], id: string, targetId: string, place: Place): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return [...ids];
  const without = ids.filter((value) => value !== id);
  const index = without.indexOf(targetId) + (place === "after" ? 1 : 0);
  return [...without.slice(0, index), id, ...without.slice(index)];
}

/** Drops groups whose key no longer matches anything shown, keeping the profile document small. */
export function pruneOrder(order: OrderMap, liveGroupKeys: ReadonlySet<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(order)) if (liveGroupKeys.has(key)) out[key] = [...ids];
  return out;
}
