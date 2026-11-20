import { describe, expect, it } from "vitest";
import { CATCH_UP_MAX, hasDefaultTitle, parseCatchUp } from "../shared/catchup";

describe("parseCatchUp", () => {
  it("reads the three lines through markdown the model adds anyway, and cuts long ones", () => {
    const long = "x".repeat(200);
    const parsed = parseCatchUp(`Sure!\n**TITLE:** Phone access\n- LEFT: Terminal set up\nNEXT: ${long}`, 7);
    expect(parsed).toMatchObject({ title: "Phone access", left: "Terminal set up", at: 7 });
    expect(parsed!.next.length).toBe(CATCH_UP_MAX);
    expect(parsed!.next.endsWith("…")).toBe(true);
  });
  it("gives up when a line is missing, rather than storing half a catch-up", () => {
    expect(parseCatchUp('```json\n{"summary": "did things"}\n```', 1)).toBeNull();
    expect(parseCatchUp("TITLE: a\nLEFT: b", 1)).toBeNull();
  });
});

describe("hasDefaultTitle", () => {
  const prompt = "I would like to be able to configure  how the chats in the inbox are displayed";
  it("treats Paseo's prompt-start name, no name and the last catch-up name as replaceable", () => {
    expect(hasDefaultTitle("I would like to be able to configure how the chats in the in", prompt, null)).toBe(true);
    expect(hasDefaultTitle(null, prompt, null)).toBe(true);
    expect(hasDefaultTitle("Inbox layout", prompt, { title: "Inbox layout", left: "", next: "", at: 1 })).toBe(true);
  });
  it("never replaces a name you chose", () => {
    expect(hasDefaultTitle("My inbox work", prompt, { title: "Inbox layout", left: "", next: "", at: 1 })).toBe(false);
    expect(hasDefaultTitle("My inbox work", null, null)).toBe(false);
  });
});
