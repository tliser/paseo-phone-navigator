import { describe, expect, it } from "vitest";
import { epoch, shortenModel, timeAgo } from "../shared/format";

describe("shortenModel", () => {
  it.each([
    ["anthropic/claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
    ["claude/claude-opus-4-1-20250805", "claude-opus-4-1"],
    ["openai/gpt-5.4", "gpt-5.4"],
    ["plexus/direct/anthropic/claude-fable-5", "claude-fable-5"],
    ["gemini-2.5-pro", "gemini-2.5-pro"],
    ["vendor/model@2024-10-22", "model"],
    ["gpt-4o-latest", "gpt-4o"],
    ["model-v12345", "model-v12345"],
    ["", ""],
  ])("%s -> %s", (input, output) => expect(shortenModel(input)).toBe(output));

  it("handles null", () => expect(shortenModel(null)).toBe(""));
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  it.each([
    [0, ""],
    [now - 10_000, "now"],
    [now - 5 * 60_000, "5m"],
    [now - 3 * 3_600_000, "3h"],
    [now - 2 * 86_400_000, "2d"],
    [now - 15 * 86_400_000, "2w"],
    [now + 60_000, "now"],
  ])("%d -> %s", (at, text) => expect(timeAgo(at, now)).toBe(text));
});

describe("epoch", () => {
  it("parses ISO and rejects garbage", () => {
    expect(epoch("2026-01-01T00:00:00Z")).toBe(Date.UTC(2026, 0, 1));
    expect(epoch("nope")).toBe(0);
    expect(epoch(null)).toBe(0);
  });
});
