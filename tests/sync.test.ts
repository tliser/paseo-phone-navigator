import { describe, expect, it } from "vitest";
import { builtinProfiles, normalizeDocument, type Profile } from "../shared/profiles";
import { mergeProfileDocs, mergeReadDocs, mergeUpdateDocs, sameDoc } from "../shared/sync";

const profile = (id: string, updatedAt: number, name = id): Profile => ({ ...builtinProfiles(0)[0]!, id, name, updatedAt });
const noCatchUp = { model: null, rename: true, at: 0 };

describe("mergeProfileDocs", () => {
  it("takes the newest copy of each profile and keeps every profile", () => {
    const a = { profiles: [profile("phone", 5, "old"), profile("x", 1)], deleted: {}, projectColors: {}, catchUp: noCatchUp };
    const b = { profiles: [profile("phone", 9, "new"), profile("y", 2)], deleted: {}, projectColors: {}, catchUp: noCatchUp };
    const merged = mergeProfileDocs([a, b]);
    expect(merged.profiles.map((p) => `${p.id}:${p.name}`)).toEqual(["phone:new", "x:x", "y:y"]);
  });
  it("a deletion beats older edits but not newer ones", () => {
    const a = { profiles: [profile("x", 3), profile("phone", 1)], deleted: {}, projectColors: {}, catchUp: noCatchUp };
    const b = { profiles: [profile("phone", 1)], deleted: { x: 5 }, projectColors: {}, catchUp: noCatchUp };
    expect(mergeProfileDocs([a, b]).profiles.map((p) => p.id)).toEqual(["phone"]);
    const edited = { profiles: [profile("x", 7), profile("phone", 1)], deleted: {}, projectColors: {}, catchUp: noCatchUp };
    expect(mergeProfileDocs([edited, b]).profiles.map((p) => p.id)).toEqual(["x", "phone"]);
  });
  it("is idempotent, and a fresh host's built-ins lose to edited ones", () => {
    const edited = { profiles: [profile("phone", 9, "Mine")], deleted: { desktop: 4 }, projectColors: {}, catchUp: noCatchUp };
    const fresh = normalizeDocument(undefined);
    const once = mergeProfileDocs([fresh, edited]);
    expect(once.profiles.map((p) => p.name)).toEqual(["Mine"]);
    expect(sameDoc(mergeProfileDocs([once, edited, fresh]), mergeProfileDocs([once]))).toBe(true);
  });
  it("keeps the newest catch-up settings; a host that never set them does not reset them", () => {
    const chosen = { profiles: [profile("phone", 1)], deleted: {}, projectColors: {}, catchUp: { model: "omp/haiku", rename: false, at: 5 } };
    const older = { ...chosen, catchUp: { model: "codex/mini", rename: true, at: 2 } };
    expect(mergeProfileDocs([normalizeDocument(undefined), older, chosen]).catchUp).toEqual(chosen.catchUp);
  });
});

describe("mergeReadDocs", () => {
  it("the later event wins: a later view, or a later mark-unread", () => {
    const now = Date.now();
    const a = { seen: { k: now - 1000, u: -(now - 10) } };
    const b = { seen: { k: now - 500, u: now - 100 } };
    expect(mergeReadDocs([a, b], now).seen).toEqual({ k: now - 500, u: -(now - 10) });
  });
  it("merges per-chat keys independently of their workspace key", () => {
    const now = Date.now();
    const a = { seen: { "h:w": now - 900, "h:agent:x": now - 100 } };
    const b = { seen: { "h:agent:x": -(now - 50), "h:agent:y": now - 10 } };
    expect(mergeReadDocs([a, b], now).seen).toEqual({ "h:w": now - 900, "h:agent:x": -(now - 50), "h:agent:y": now - 10 });
  });
});

describe("mergeUpdateDocs", () => {
  it("the newest switch change wins and the newest installed version is kept", () => {
    const merged = mergeUpdateDocs([
      { autoUpdate: true, updatedAt: 0, latestVersion: { commit: "a", installedAt: 10 } },
      { autoUpdate: false, updatedAt: 5, latestVersion: { commit: "b", installedAt: 20 } },
    ]);
    expect(merged).toEqual({ autoUpdate: false, updatedAt: 5, latestVersion: { commit: "b", installedAt: 20 } });
  });
});

describe("project colours", () => {
  it("the newest choice per project wins and colours survive normalisation", () => {
    const a = { ...normalizeDocument({ projectColors: { "h:p": { color: "red", at: 5 } } }) };
    const b = { ...normalizeDocument({ projectColors: { "h:p": { color: "teal", at: 9 }, "h:q": { color: "pink", at: 1 } } }) };
    expect(mergeProfileDocs([a, b]).projectColors).toEqual({ "h:p": { color: "teal", at: 9 }, "h:q": { color: "pink", at: 1 } });
  });
});
