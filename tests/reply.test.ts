import { describe, expect, it } from "vitest";
import { REPLY_MAX, replySummary } from "../shared/reply";

describe("replySummary", () => {
  it("skips headings, code and tables and keeps the first real sentences as plain text", () => {
    const reply = [
      "## Done",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "| a | b |",
      "|---|---|",
      "All three are **fixed** and live on `tardis` ([commit](https://x/y)).",
      "- You still need to pick a model.",
    ].join("\n");
    expect(replySummary(reply)).toBe("All three are fixed and live on tardis (commit). You still need to pick a model.");
  });
  it("cuts a long reply to two Inbox lines", () => {
    const text = replySummary("word ".repeat(100));
    expect(text.length).toBe(REPLY_MAX);
    expect(text.endsWith("…")).toBe(true);
  });
  it("leaves nothing when the reply is only code", () => {
    expect(replySummary("```\nnpm test\n```")).toBe("");
  });
});
