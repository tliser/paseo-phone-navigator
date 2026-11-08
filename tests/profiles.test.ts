import { describe, expect, it } from "vitest";
import {
  bindPlatform,
  builtinProfiles,
  defaultSettings,
  expandOrCollapseAll,
  isCollapsed,
  newProfileId,
  normalizeDocument,
  pruneCollapse,
  resolveProfile,
  setCollapsed,
  toggleCollapsed,
} from "../shared/profiles";

const profiles = builtinProfiles(1);
const base = { sessionId: null, deviceId: null, platform: "ios" as const, compact: true };

describe("resolveProfile", () => {
  it("prefers the session choice", () => {
    expect(resolveProfile(profiles, { ...base, sessionId: "desktop", deviceId: "phone" })).toMatchObject({ profile: { id: "desktop" }, via: "session" });
  });
  it("then the device choice", () => {
    expect(resolveProfile(profiles, { ...base, deviceId: "desktop" })).toMatchObject({ profile: { id: "desktop" }, via: "device" });
  });
  it("ignores unknown ids", () => {
    expect(resolveProfile(profiles, { ...base, sessionId: "gone", deviceId: "gone" }).via).toBe("platform");
  });
  it("then the platform binding", () => {
    expect(resolveProfile(profiles, { ...base, platform: "web", compact: true })).toMatchObject({ profile: { id: "desktop" }, via: "platform" });
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
});

describe("profile edits", () => {
  it("binds a platform exclusively", () => {
    const next = bindPlatform(profiles, "desktop", "ios", 5);
    expect(next.find((p) => p.id === "desktop")?.platform).toBe("ios");
    expect(next.find((p) => p.id === "phone")?.platform).toBeNull();
  });
  it("makes unique ids", () => {
    const id = newProfileId(profiles, 42);
    expect(newProfileId([...profiles, { ...profiles[0]!, id }], 42)).not.toBe(id);
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
