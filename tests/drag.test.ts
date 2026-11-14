import { describe, expect, it } from "vitest";
import { dragShift, findDropTarget, heightsFor, rowOffsets } from "../shared/drag";
import { moveRelative } from "../shared/order";
import type { TreeRow } from "../shared/tree";
import type { WorkspaceInput } from "../shared/types";

const h = heightsFor(false); // group 44, workspace 56
const hostRow = (id: string): TreeRow => ({ type: "host", key: `host:${id}`, serverId: id, label: id, state: "online", collapsed: false, count: 0, tally: { needsYou: 0, unread: 0 }, error: null });
const projRow = (host: string, id: string): TreeRow => ({ type: "project", key: `proj:${host}:${id}`, serverId: host, projectId: id, name: id, kind: "git", rootPath: `/p/${id}`, collapsed: false, count: 0, tally: { needsYou: 0, unread: 0 }, group: `host:${host}` });
const wsRow = (host: string, proj: string, id: string): TreeRow => ({
  type: "workspace", key: `ws:${host}:${id}`, serverId: host, hostLabel: host, state: "read", modelShort: "", pinned: false, group: `proj:${host}:${proj}`,
  workspace: { id } as WorkspaceInput,
});

// 0 host h (0-44) | 1 proj p (44-88) | 2 a (88-144) | 3 b (144-200) | 4 c (200-256) | 5 proj q (256-300) | 6 d (300-356) | 7 host k (356-400)
const rows: TreeRow[] = [hostRow("h"), projRow("h", "p"), wsRow("h", "p", "a"), wsRow("h", "p", "b"), wsRow("h", "p", "c"), projRow("h", "q"), wsRow("h", "q", "d"), hostRow("k")];
const offsets = rowOffsets(rows, h);

describe("findDropTarget", () => {
  it("computes offsets", () => {
    expect(offsets).toEqual([0, 44, 88, 144, 200, 256, 300, 356, 400]);
  });
  it("moves a workspace down past a sibling", () => {
    // Between b and c: "before c" is the same slot as "after b".
    expect(findDropTarget(rows, offsets, 2, 180)).toEqual({ targetId: "c", place: "before", lineY: 200 });
    expect(findDropTarget(rows, offsets, 2, 240)).toEqual({ targetId: "c", place: "after", lineY: 256 });
  });
  it("the resulting order is what the user sees", () => {
    const drop = findDropTarget(rows, offsets, 2, 180)!;
    expect(moveRelative(["a", "b", "c"], "a", drop.targetId, drop.place)).toEqual(["b", "a", "c"]);
  });
  it("moves a workspace up", () => {
    expect(findDropTarget(rows, offsets, 4, 100)).toEqual({ targetId: "a", place: "before", lineY: 88 });
  });
  it("returns null when staying in place", () => {
    expect(findDropTarget(rows, offsets, 3, 172)).toBeNull();
  });
  it("never crosses into another project", () => {
    // Dragging "a" far down into project q still lands after the last sibling of p.
    expect(findDropTarget(rows, offsets, 2, 330)).toEqual({ targetId: "c", place: "after", lineY: 256 });
    // Alone in its project: nothing to do.
    expect(findDropTarget(rows, offsets, 6, 100)).toBeNull();
  });
  it("moves projects among projects of the host", () => {
    expect(findDropTarget(rows, offsets, 5, 50)).toEqual({ targetId: "p", place: "before", lineY: 44 });
    expect(findDropTarget(rows, offsets, 1, 380)).toEqual({ targetId: "q", place: "after", lineY: 356 });
  });
  it("grows with the interface font size, never shrinks", () => {
    expect(heightsFor(false, 1.25)).toEqual({ group: 55, workspace: 70, note: 55 });
    expect(heightsFor(false, 0.8)).toEqual(h);
  });
  it("ignores rows that cannot be dragged", () => {
    expect(findDropTarget(rows, offsets, 0, 200)).toBeNull();
  });
});

describe("dragShift", () => {
  it("rows passed while dragging down glide up by the dragged row's height", () => {
    const drop = findDropTarget(rows, offsets, 2, 240)!; // a after c
    expect(dragShift(rows, offsets, 2, drop)).toEqual({ carried: 3, start: 3, end: 5, shift: -56 });
  });
  it("rows passed while dragging up glide down", () => {
    const drop = findDropTarget(rows, offsets, 4, 100)!; // c before a
    expect(dragShift(rows, offsets, 4, drop)).toEqual({ carried: 5, start: 2, end: 4, shift: 56 });
  });
  it("a project carries its open workspaces and the other project moves by the whole block", () => {
    const drop = findDropTarget(rows, offsets, 5, 50)!; // q before p
    expect(dragShift(rows, offsets, 5, drop)).toEqual({ carried: 7, start: 1, end: 5, shift: 100 });
    const down = findDropTarget(rows, offsets, 1, 380)!; // p after q
    expect(dragShift(rows, offsets, 1, down)).toEqual({ carried: 5, start: 5, end: 7, shift: -212 });
  });
  it("nothing moves without a drop target", () => {
    expect(dragShift(rows, offsets, 3, null).shift).toBe(0);
  });
});
