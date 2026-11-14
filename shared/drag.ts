// Drag-and-drop geometry for the flattened tree. Pure: no React, testable.
import type { Place } from "./order";
import type { TreeRow } from "./tree";

export interface RowHeights {
  group: number;
  workspace: number;
  note: number;
}

/** Row heights for the density, grown with the interface font size (`scale`, 1 = Paseo's default). */
export function heightsFor(comfortable: boolean, scale = 1): RowHeights {
  const grow = (px: number) => Math.round(px * Math.max(1, scale));
  return { group: grow(comfortable ? 52 : 44), workspace: grow(comfortable ? 68 : 56), note: grow(44) };
}

function rowHeight(row: TreeRow, heights: RowHeights): number {
  if (row.type === "host" || row.type === "project" || row.type === "pinned") return heights.group;
  if (row.type === "workspace" || row.type === "skeleton") return heights.workspace;
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
  // Rows in the Pinned section are copies outside the manual order: not draggable.
  if (row.type === "workspace") return row.inPinned ? null : row.workspace.id;
  if (row.type === "project") return row.projectId;
  return null;
}

function dragGroup(row: TreeRow): string | null {
  return row.type === "workspace" || row.type === "project" ? row.group : null;
}

/** Index after the last row of the block that moves with a dragged row (a project carries its open workspaces). */
export function blockEnd(rows: readonly TreeRow[], index: number): number {
  const row = rows[index];
  if (row?.type !== "project") return index + 1;
  let end = index + 1;
  while (end < rows.length && rows[end]!.type !== "project" && rows[end]!.type !== "host" && rows[end]!.type !== "pinned") end++;
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
