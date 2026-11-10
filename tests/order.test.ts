import { describe, expect, it } from "vitest";
import { applyOrder, moveRelative, pruneOrder } from "../shared/order";

const byName = (a: string, b: string) => a.localeCompare(b);
const id = (value: string) => value;

describe("applyOrder", () => {
  it("falls back to the automatic order without a saved one", () => {
    expect(applyOrder(["c", "a", "b"], id, undefined, byName)).toEqual(["a", "b", "c"]);
  });
  it("follows the saved order and puts new items first, in automatic order", () => {
    expect(applyOrder(["a", "b", "c", "z", "y"], id, ["c", "a", "b"], byName)).toEqual(["y", "z", "c", "a", "b"]);
  });
  it("ignores saved ids that no longer exist", () => {
    expect(applyOrder(["a", "b"], id, ["gone", "b", "a"], byName)).toEqual(["b", "a"]);
  });
});

describe("moveRelative", () => {
  const ids = ["a", "b", "c", "d"];
  it.each([
    ["a", "c", "after", ["b", "c", "a", "d"]],
    ["a", "c", "before", ["b", "a", "c", "d"]],
    ["d", "a", "before", ["d", "a", "b", "c"]],
    ["d", "a", "after", ["a", "d", "b", "c"]],
    ["b", "b", "after", ["a", "b", "c", "d"]],
    ["x", "a", "after", ["a", "b", "c", "d"]],
  ] as const)("move %s %s %s", (from, to, place, expected) => {
    expect(moveRelative(ids, from, to, place)).toEqual(expected);
  });
  it("keeps hidden items' places when moving among visible ones", () => {
    // Visible: a, c, d (b hidden by a filter). Moving d before c keeps b after a.
    expect(moveRelative(["a", "b", "c", "d"], "d", "c", "before")).toEqual(["a", "b", "d", "c"]);
  });
});

describe("pruneOrder", () => {
  it("keeps only live groups", () => {
    expect(pruneOrder({ "host:a": ["p"], "proj:a:p": ["w"], "host:gone": ["q"] }, new Set(["host:a", "proj:a:p"]))).toEqual({ "host:a": ["p"], "proj:a:p": ["w"] });
  });
});
