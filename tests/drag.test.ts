import { describe, expect, it } from "vitest";
import { dragShift, findDropTarget, heightsFor, rowOffsets, stickyHeaders } from "../shared/drag";
import { moveRelative } from "../shared/order";
import type { TreeRow } from "../shared/tree";
import type { WorkspaceInput } from "../shared/types";

// Host and project rows of 44 keep the geometry below easy to follow: host/project 44, workspace 56.
const h = { ...heightsFor(false), host: 44, project: 44 };
const hostRow = (id: string): TreeRow => ({ type: "host", key: `host:${id}`, serverId: id, label: id, state: "online", collapsed: false, count: 0, tally: { asking: 0, error: 0, unread: 0 }, error: null });
const projRow = (host: string, id: string): TreeRow => ({ type: "project", key: `proj:${host}:${id}`, serverId: host, projectId: id, name: id, kind: "git", rootPath: `/p/${id}`, collapsed: false, count: 0, tally: { asking: 0, error: 0, unread: 0 }, group: `host:${host}` });
const wsRow = (host: string, proj: string, id: string): TreeRow => ({
  type: "workspace", key: `ws:${host}:${id}`, serverId: host, hostLabel: host, state: "read", modelShort: "", pinned: false, unreadChats: [], group: `proj:${host}:${proj}`,
  workspace: { id } as WorkspaceInput,
});

// 0 host h (0-44) | 1 proj p (44-88) | 2 a (88-144) | 3 b (144-200) | 4 c (200-256) | 5 proj q (256-300) | 6 d (300-356) | 7 host k (356-400)
const rows: TreeRow[] = [hostRow("h"), projRow("h", "p"), wsRow("h", "p", "a"), wsRow("h", "p", "b"), wsRow("h", "p", "c"), projRow("h", "q"), wsRow("h", "q", "d"), hostRow("k")];
const offsets = rowOffsets(rows, h);

describe("findDropTarget", () => {
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
    expect(heightsFor(false, 1.25)).toEqual({ host: 38, project: 45, workspace: 70, note: 55, tab: 50 });
    expect(heightsFor(false, 0.8)).toEqual(heightsFor(false));
  });
  it("workspace rows grow with their line count", () => {
    expect([1, 2, 3].map((lines) => heightsFor(false, 1, false, lines).workspace)).toEqual([40, 56, 72]);
    expect(heightsFor(false, 1, true, 1).workspace).toBe(44);
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
});

describe("sticky headers", () => {
  // host a (0), project p (44), 3 workspaces (88..), project q (256), 1 workspace, host b (344)
  const rows = [hostRow("a"), projRow("a", "p"), wsRow("a", "p", "1"), wsRow("a", "p", "2"), wsRow("a", "p", "3"), projRow("a", "q"), wsRow("a", "q", "4"), hostRow("b")];
  const offsets = [0, 44, 88, 144, 200, 256, 300, 356, 400];
  const g = { host: 44, project: 44 };
  it("pin nothing at the top, then the host and the project under it", () => {
    expect(stickyHeaders(rows, offsets, 0, g)).toEqual({ host: null, hostShift: 0, project: null, projectShift: 0 });
    expect(stickyHeaders(rows, offsets, 100, g)).toEqual({ host: 0, hostShift: 0, project: 1, projectShift: 0 });
  });
  it("the next project pushes the pinned one up, then takes its place", () => {
    expect(stickyHeaders(rows, offsets, 200, g)).toMatchObject({ project: 1, projectShift: -32 });
    expect(stickyHeaders(rows, offsets, 220, g)).toMatchObject({ project: 5, projectShift: 0 });
  });
  it("the next host pushes the pinned host up", () => {
    expect(stickyHeaders(rows, offsets, 330, g)).toMatchObject({ host: 0, hostShift: -18 });
    expect(stickyHeaders(rows, offsets, 360, g)).toMatchObject({ host: 7, hostShift: 0, project: null });
  });
  it("without host rows (one host shown) the project pins to the top", () => {
    // project p (0), 3 workspaces (44..), project q (212), 1 workspace
    const flat = rows.slice(1, 7);
    const flatOffsets = [0, 44, 100, 156, 212, 256, 312];
    expect(stickyHeaders(flat, flatOffsets, 50, g)).toEqual({ host: null, hostShift: 0, project: 0, projectShift: 0 });
    expect(stickyHeaders(flat, flatOffsets, 190, g)).toMatchObject({ project: 0, projectShift: -22 });
    expect(stickyHeaders(flat, flatOffsets, 220, g)).toMatchObject({ project: 4, projectShift: 0 });
  });
});
