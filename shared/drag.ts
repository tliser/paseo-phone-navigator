// Drag-and-drop geometry for the flattened tree. Pure: no React, testable.
import type { Place } from "./order";
import type { TreeRow } from "./tree";

export interface RowHeights {
  /** Host divider: a thin label line, not a band. */
  host: number;
  project: number;
  workspace: number;
  note: number;
  tab: number;
}

/**
 * Row heights for the density and the workspace row's line count (1–3), grown with the interface font
 * size (`scale`, 1 = Paseo's default). Touch screens keep one-line rows at 44 pt.
 */
export function heightsFor(comfortable: boolean, scale = 1, touch = false, lines = 2): RowHeights {
  const grow = (px: number) => Math.round(px * Math.max(1, scale));
  const workspace = (comfortable ? 28 : 24) + lines * (comfortable ? 20 : 16);
  return {
    host: grow(comfortable ? 34 : 30),
    project: grow(Math.max(comfortable ? 42 : 36, touch ? 40 : 0)),
    workspace: grow(Math.max(workspace, touch ? 44 : 0)),
    note: grow(44),
    tab: grow(comfortable || touch ? 44 : 40),
  };
}

function rowHeight(row: TreeRow, heights: RowHeights): number {
  if (row.type === "host") return heights.host;
  if (row.type === "project") return heights.project;
  if (row.type === "workspace" || row.type === "skeleton") return heights.workspace;
  if (row.type === "tab") return heights.tab;
  return heights.note;
}

/** Top offset of every row, plus the total as the last entry. */
export function rowOffsets(rows: readonly TreeRow[], heights: RowHeights): number[] {
  const offsets: number[] = [];
  let y = 0;
  for (const row of rows) {
    offsets.push(y);
    y += rowHeight(row, heights);
  }
  offsets.push(y);
  return offsets;
}

/** The id a draggable row carries in its order group, or null for rows that cannot be dragged. */
export function dragId(row: TreeRow): string | null {
  if (row.type === "workspace") return row.workspace.id;
  if (row.type === "project") return row.projectId;
  return null;
}

function dragGroup(row: TreeRow): string | null {
  return row.type === "workspace" || row.type === "project" ? row.group : null;
}

/** Index after the last row of the block that moves with a dragged row (a project carries its open workspaces). */
export function blockEnd(rows: readonly TreeRow[], index: number): number {
  const row = rows[index];
  if (row?.type === "workspace") {
    let end = index + 1;
    while (rows[end]?.type === "tab") end++;
    return end;
  }
  if (row?.type !== "project") return index + 1;
  let end = index + 1;
  while (end < rows.length && rows[end]!.type !== "project" && rows[end]!.type !== "host") end++;
  return end;
}

/**
 * While a row is dragged towards `drop`, the rows it passes glide out of its way: rows with an index in
 * [start, end) move by `shift` px (up when dragging down, down when dragging up). Rows in
 * [from, carried) travel with the pointer.
 */
export interface DragShift {
  carried: number;
  start: number;
  end: number;
  shift: number;
}

export function dragShift(rows: readonly TreeRow[], offsets: readonly number[], from: number, drop: DropTarget | null): DragShift {
  const carried = blockEnd(rows, from);
  const none = { carried, start: 0, end: 0, shift: 0 };
  if (!drop) return none;
  const target = rows.findIndex((row) => dragId(row) === drop.targetId && row.type === rows[from]?.type);
  if (target === -1) return none;
  const height = (offsets[carried] ?? 0) - (offsets[from] ?? 0);
  if (target > from) {
    // Dragged down: everything from the block's end up to the landing slot moves up.
    const end = drop.place === "after" ? blockEnd(rows, target) : target;
    return { carried, start: carried, end, shift: -height };
  }
  const start = drop.place === "before" ? target : blockEnd(rows, target);
  return { carried, start, end: from, shift: height };
}

export interface DropTarget {
  targetId: string;
  place: Place;
  /** Where to draw the insertion line, in content coordinates. */
  lineY: number;
}

/**
 * Where the dragged row would land when its centre is at `centerY` (content coordinates).
 * Only rows of the same group are candidates; the slot is before the first sibling whose middle
 * lies below the centre, else after the last sibling. Returns null when the row would not move.
 */
export function findDropTarget(rows: readonly TreeRow[], offsets: readonly number[], dragIndex: number, centerY: number): DropTarget | null {
  const dragged = rows[dragIndex];
  if (!dragged) return null;
  const group = dragGroup(dragged);
  if (!group) return null;
  const siblings: { index: number; id: string }[] = [];
  rows.forEach((row, index) => {
    const id = dragId(row);
    if (id && dragGroup(row) === group && row.type === dragged.type) siblings.push({ index, id });
  });
  const position = siblings.findIndex((sibling) => sibling.index === dragIndex);
  const others = siblings.filter((sibling) => sibling.index !== dragIndex);
  if (!others.length) return null;

  const middle = (index: number) => ((offsets[index] ?? 0) + (offsets[index + 1] ?? 0)) / 2;
  const before = others.findIndex((sibling) => middle(sibling.index) > centerY);
  // Dropping into the slot the row already occupies changes nothing.
  const slot = before === -1 ? others.length : before;
  if (slot === position) return null;

  if (before === -1) {
    const last = others[others.length - 1]!;
    // After the last sibling, below its whole block (a project's block includes its open workspaces).
    return { targetId: last.id, place: "after", lineY: offsets[blockEnd(rows, last.index)] ?? 0 };
  }
  const target = others[before]!;
  return { targetId: target.id, place: "before", lineY: offsets[target.index] ?? 0 };
}

/** Host and project headers pinned to the top of the list, and how far the next header pushes each up (≤ 0). */
export interface StickyHeaders {
  host: number | null;
  hostShift: number;
  project: number | null;
  projectShift: number;
}

/**
 * Which headers stick at scroll offset `scrollY`: the host whose section is under the top edge, and below
 * it the project whose section is under the host header (under the top edge when the tree has no host
 * rows). The next header of the same level pushes the pinned one up, so they hand over instead of overlapping.
 */
export function stickyHeaders(rows: readonly TreeRow[], offsets: readonly number[], scrollY: number, heights: Pick<RowHeights, "host" | "project">): StickyHeaders {
  const result: StickyHeaders = { host: null, hostShift: 0, project: null, projectShift: 0 };
  if (scrollY <= 0) return result;
  const top = (index: number) => offsets[index] ?? 0;
  for (let index = 0; index < rows.length && top(index) < scrollY; index++) if (rows[index]!.type === "host") result.host = index;
  const hasHosts = rows.some((row) => row.type === "host");
  if (hasHosts && result.host === null) return result;
  const start = result.host ?? -1;
  let nextHost = rows.length;
  for (let index = start + 1; index < rows.length; index++) if (rows[index]!.type === "host") { nextHost = index; break; }
  if (result.host !== null) result.hostShift = nextHost < rows.length ? Math.min(0, top(nextHost) - scrollY - heights.host) : 0;
  const line = scrollY + (result.host !== null ? heights.host : 0);
  for (let index = start + 1; index < nextHost && top(index) < line; index++) if (rows[index]!.type === "project") result.project = index;
  if (result.project === null) return result;
  let next = nextHost;
  for (let index = result.project + 1; index < nextHost; index++) if (rows[index]!.type === "project") { next = index; break; }
  result.projectShift = next < rows.length ? Math.min(0, top(next) - line - heights.project) : 0;
  return result;
}
