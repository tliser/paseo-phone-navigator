import { describe, expect, it } from "vitest";
import { isAgentUnread, isUnread, KEEP_DAYS, markSeen, newsKey, normalizeReads, readAgentKey, readKey, undoReads } from "../shared/reads";

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
  it("a chat is unread when its news came after Done, or when put back in the Inbox", () => {
    const agent = { id: "a", unreadAt: 10 };
    expect(isAgentUnread({ [readAgentKey("h", "a")]: 5 }, "h", "w", agent)).toBe(true);
    expect(isAgentUnread({ [readAgentKey("h", "a")]: 20 }, "h", "w", agent)).toBe(false);
    expect(isAgentUnread({ [readAgentKey("h", "a")]: -NOW }, "h", "w", { id: "a", unreadAt: 0 })).toBe(true);
  });
  it("sending a prompt clears put-back-in-Inbox; only a turn finishing after it is news again", () => {
    const putBack = { [readAgentKey("h", "a")]: -100 };
    expect(isAgentUnread(putBack, "h", "w", { id: "a", unreadAt: 0, promptAt: 200 })).toBe(false);
    expect(isAgentUnread(putBack, "h", "w", { id: "a", unreadAt: 300, promptAt: 200 })).toBe(true);
    expect(isAgentUnread(putBack, "h", "w", { id: "a", unreadAt: 0, promptAt: 50 })).toBe(true);
  });
  it("a chat without its own entry falls back to the workspace's entry from before per-chat reads", () => {
    expect(isAgentUnread({ [readKey("h", "w")]: 20 }, "h", "w", { id: "a", unreadAt: 10 })).toBe(false);
    expect(isAgentUnread({ [readKey("h", "w")]: 20, [readAgentKey("h", "a")]: -NOW }, "h", "w", { id: "a", unreadAt: 10 })).toBe(true);
  });
  it("undo writes a fresh opposite mark, only for keys nothing changed since", () => {
    const changes = [{ key: "a", after: 10 }, { key: "b", after: -10 }, { key: "c", after: 10 }];
    expect(undoReads({ a: 10, b: -10, c: 20 }, changes, 30)).toEqual({ a: -30, b: 30 });
  });
  it("marks seen, keeps the later time, and prunes views and unread marks older than 60 days", () => {
    const reads = { a: NOW - 70 * DAY, b: NOW - DAY, c: NOW, m: -(NOW - 70 * DAY) };
    expect(markSeen(reads, ["b"], NOW - 2 * DAY)).toEqual({ b: NOW - DAY, c: NOW });
  });
  it("caps the number of entries, keeping the newest", () => {
    const many = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`k${i}`, NOW - i]));
    const kept = Object.keys(markSeen(many, [], NOW));
    expect(kept).toHaveLength(2000);
    expect(kept).toContain("k0");
    expect(kept).not.toContain("k2000");
  });
  it("remembered news keeps a chat unread after Paseo drops its live flag, until a later mark or prompt", () => {
    const agent = { id: "a", unreadAt: 0 };
    expect(isAgentUnread({ [newsKey("h", "a")]: 50 }, "h", "w", agent)).toBe(true);
    expect(isAgentUnread({ [newsKey("h", "a")]: 50, [readAgentKey("h", "a")]: 40 }, "h", "w", agent)).toBe(true);
    expect(isAgentUnread({ [newsKey("h", "a")]: 50, [readAgentKey("h", "a")]: 60 }, "h", "w", agent)).toBe(false);
    expect(isAgentUnread({ [newsKey("h", "a")]: 50 }, "h", "w", { ...agent, promptAt: 60 })).toBe(false);
  });
  it(`news older than ${KEEP_DAYS} days is not unread, unless the chat was marked unread`, () => {
    const old = NOW - (KEEP_DAYS + 1) * DAY;
    const agent = { id: "a", unreadAt: 0 };
    expect(isAgentUnread({ [newsKey("h", "a")]: old }, "h", "w", agent, NOW)).toBe(false);
    expect(isAgentUnread({}, "h", "w", { id: "a", unreadAt: old }, NOW)).toBe(false);
    expect(isAgentUnread({ [newsKey("h", "a")]: NOW - DAY }, "h", "w", agent, NOW)).toBe(true);
    expect(isAgentUnread({ [newsKey("h", "a")]: old, [readAgentKey("h", "a")]: -old }, "h", "w", agent, NOW)).toBe(true);
  });
  it("treats a broken document as empty", () => {
    expect(normalizeReads({ seen: "x" })).toEqual({ seen: {} });
  });
});
