import { describe, expect, it } from "vitest";
import { isUnread, markSeen, mergeReads, normalizeReads, readKey } from "../shared/reads";

const DAY = 86_400_000;
const NOW = 100 * DAY;

describe("read state", () => {
  it("is unread when news came after the last view", () => {
    expect(isUnread({}, "h", "w", 10)).toBe(true);
    expect(isUnread({ [readKey("h", "w")]: 20 }, "h", "w", 10)).toBe(false);
    expect(isUnread({ [readKey("h", "w")]: 5 }, "h", "w", 10)).toBe(true);
    expect(isUnread({}, "h", "w", 0)).toBe(false);
  });
  it("stays unread when marked so, even with no news from Paseo", () => {
    expect(isUnread({ [readKey("h", "w")]: -NOW }, "h", "w", 0)).toBe(true);
    expect(isUnread({ [readKey("h", "w")]: -NOW }, "h", "w", NOW + 5)).toBe(true);
  });
  it("prunes marks by age like views", () => {
    expect(markSeen({ a: -(NOW - 70 * DAY), b: -(NOW - DAY) }, [], NOW)).toEqual({ b: -(NOW - DAY) });
  });
  it("marks seen, keeps the later time, and prunes old entries", () => {
    const reads = { a: NOW - 70 * DAY, b: NOW - DAY, c: NOW };
    const next = markSeen(reads, ["b"], NOW - 2 * DAY);
    expect(next).toEqual({ b: NOW - DAY, c: NOW }); // a is older than 60 days
  });
  it("caps the number of entries", () => {
    const many = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`k${i}`, NOW - i]));
    expect(Object.keys(markSeen(many, [], NOW))).toHaveLength(1000);
  });
  it("merges two copies with the later view winning", () => {
    expect(mergeReads({ a: 1, b: 5 }, { b: 3, c: 2 })).toEqual({ a: 1, b: 5, c: 2 });
  });
  it("normalizes broken documents", () => {
    expect(normalizeReads(undefined)).toEqual({ seen: {} });
    expect(normalizeReads({ seen: "x" })).toEqual({ seen: {} });
  });
});
