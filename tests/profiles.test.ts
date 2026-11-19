import { describe, expect, it } from "vitest";
import {
  bindPlatform,
  builtinProfiles,
  defaultSettings,
  expandForAttention,
  expandOrCollapseAll,
  isCollapsed,
  normalizeDocument,
  normalizeLines,
  pruneCollapse,
  resolveProfile,
  setCollapsed,
  toggleCollapsed,
} from "../shared/profiles";

const profiles = builtinProfiles(1);
const base = { sessionId: null, deviceId: null, platform: "ios" as const, compact: true };

describe("resolveProfile", () => {
  it("picks session, then device, then platform binding; unknown ids are skipped", () => {
    expect(resolveProfile(profiles, { ...base, sessionId: "desktop", deviceId: "phone" }).via).toBe("session");
    expect(resolveProfile(profiles, { ...base, deviceId: "desktop" })).toMatchObject({ profile: { id: "desktop" }, via: "device" });
    expect(resolveProfile(profiles, { ...base, sessionId: "gone", deviceId: "gone" }).via).toBe("platform");
    expect(resolveProfile(profiles, { ...base, platform: "web", compact: true }).profile.id).toBe("desktop");
  });
  it("falls back by layout when nothing is bound", () => {
    const unbound = profiles.map((p) => ({ ...p, platform: null }));
    expect(resolveProfile(unbound, { ...base, platform: "android", compact: true }).profile.id).toBe("phone");
    expect(resolveProfile(unbound, { ...base, platform: "android", compact: false }).profile.id).toBe("desktop");
  });
  it("falls back to the first profile when built-ins were deleted", () => {
    const custom = [{ ...profiles[0]!, id: "x", platform: null }];
    expect(resolveProfile(custom, { ...base, platform: "web" }).profile.id).toBe("x");
  });
});

describe("collapse map", () => {
  const settings = defaultSettings(); // hosts expanded, projects collapsed

  it("uses defaults for missing keys", () => {
    expect(isCollapsed({}, "host:a", settings)).toBe(false);
    expect(isCollapsed({}, "proj:a:p", settings)).toBe(true);
  });
  it("stores only differences", () => {
    const map = setCollapsed({}, "host:a", true, settings);
    expect(map).toEqual({ "host:a": true });
    expect(setCollapsed(map, "host:a", false, settings)).toEqual({});
    expect(setCollapsed({}, "proj:a:p", true, settings)).toEqual({});
    expect(toggleCollapsed({}, "proj:a:p", settings)).toEqual({ "proj:a:p": false });
  });
  it("prunes after defaults change", () => {
    const allExpanded = { ...settings, newGroupsExpanded: { hosts: true, projects: true } };
    expect(pruneCollapse({ "proj:a:p": false, "host:a": true }, allExpanded)).toEqual({ "host:a": true });
  });
  it("expands all when anything is collapsed", () => {
    const keys = ["host:a", "proj:a:p", "proj:a:q"];
    expect(expandOrCollapseAll({}, keys, settings)).toEqual({ "proj:a:p": false, "proj:a:q": false });
  });
  it("collapses to host level when everything is expanded", () => {
    const keys = ["host:a", "proj:a:p"];
    const expanded = { "proj:a:p": false };
    expect(expandOrCollapseAll(expanded, keys, settings)).toEqual({ "host:a": true });
  });
  it("collapses the projects when the tree has no host rows (one host shown)", () => {
    const open = { ...settings, newGroupsExpanded: { hosts: true, projects: true } };
    expect(expandOrCollapseAll({}, ["proj:a:p", "proj:a:q"], open)).toEqual({ "proj:a:p": true, "proj:a:q": true });
  });
});

describe("profile edits", () => {
  it("binds a platform exclusively", () => {
    const next = bindPlatform(profiles, "desktop", "ios", 5);
    expect(next.find((p) => p.id === "desktop")?.platform).toBe("ios");
    expect(next.find((p) => p.id === "phone")?.platform).toBeNull();
  });
  it("normalizes empty or broken documents to the built-ins", () => {
    expect(normalizeDocument(undefined).profiles.map((p) => p.id)).toEqual(["phone", "desktop"]);
    expect(normalizeDocument({ profiles: "x" }).profiles).toHaveLength(2);
    expect(normalizeDocument({ profiles: [] }).profiles).toHaveLength(2);
    const doc = normalizeDocument({ profiles: [{ id: "a", name: "A" }, { id: "a", name: "dup" }] });
    expect(doc.profiles).toHaveLength(1);
    expect(doc.profiles[0]?.settings.density).toBe("compact");
  });
});

describe("settings migration", () => {
  it("an old profile that opened on the Inbox opens on Active and gets the new defaults", () => {
    const doc = normalizeDocument({ profiles: [{ id: "a", name: "A", settings: { defaultFilter: "inbox" } }] });
    const s = doc.profiles[0]!.settings;
    expect(s.defaultFilter).toBe("active");
    expect(s).toMatchObject({ lines: [["title", "time"], ["branch", "model", "diff"]], show: { tabs: true, subagents: true }, hostSwitch: "tabs" });
  });
  it("an old second line becomes line 2 with its order and switches; time stays on line 1", () => {
    const doc = normalizeDocument({ profiles: [{ id: "a", name: "A", settings: { show: { model: false, time: false, tabs: false }, fieldOrder: ["diff", "branch"] } }] });
    expect(doc.profiles[0]!.settings).toMatchObject({ lines: [["title"], ["diff", "branch"]], show: { tabs: false } });
  });
  it("lines keep each value once, drop empty lines and always keep the title", () => {
    expect(normalizeLines([["branch", "nope", "branch"], [], ["model", "title"], ["diff"]])).toEqual([["branch"], ["model", "title"]]);
    expect(normalizeLines([["model"]])).toEqual([["title", "model"]]);
    expect(normalizeLines([])).toEqual([["title"]]);
  });
});

describe("expandForAttention", () => {
  const settings = defaultSettings(); // hosts expanded, projects collapsed
  it("opens the folded host and project of a workspace that newly needs you, and only those", () => {
    const map = { "host:a": true, "host:b": true };
    expect(expandForAttention(map, [{ serverId: "a", projectId: "p" }], settings)).toEqual({ "host:b": true, "proj:a:p": false });
  });
  it("returns the same map when everything is already open", () => {
    const map = { "proj:a:p": false };
    expect(expandForAttention(map, [{ serverId: "a", projectId: "p" }], settings)).toBe(map);
  });
});
