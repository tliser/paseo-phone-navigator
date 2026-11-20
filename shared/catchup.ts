// Catch-up: a very short note of where a chat left off and what comes next, written by a small model you
// pick, on request. Stored on the agent (metadata), so every device sees it. Pure contracts and helpers.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Agent metadata key the catch-up is stored under. */
export const CATCH_UP_KEY = "workspace-organizer.catchup";
/** Longest `left` and `next`, in characters: a glance, not a report. */
export const CATCH_UP_MAX = 80;
const TITLE_MAX = 40;

export const catchUpSchema = z.object({
  /** 2–5 words naming the chat's topic. */
  title: z.string(),
  /** Where the chat stands. */
  left: z.string(),
  /** The next step and who takes it. */
  next: z.string(),
  /** When it was written, epoch ms. */
  at: z.number(),
});
export type CatchUp = z.output<typeof catchUpSchema>;

/** The catch-up stored on an agent, or null. */
export function readCatchUp(metadata: unknown): CatchUp | null {
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[CATCH_UP_KEY] : undefined;
  const parsed = catchUpSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Writes a catch-up for one chat on the host that runs it; renames the chat when asked and it still has Paseo's default name. */
export const catchUpRpc = defineRpc({
  name: "catchup.generate",
  input: z.object({
    agentId: z.string().min(1),
    /** `provider/model`, as Paseo takes it. */
    model: z.string().min(1),
    rename: z.boolean(),
  }),
  output: z.object({ catchUp: catchUpSchema, renamed: z.boolean() }),
});

/** Turns of the chat the model reads, and how much of their text (the newest is kept). */
export const TRANSCRIPT_TURNS = 8;
const TRANSCRIPT_CHARS = 12_000;

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

/** The newest messages as plain text, cut from the front to fit. */
export function transcriptOf(messages: readonly ChatMessage[]): string {
  const text = messages.map((message) => `${message.role === "user" ? "USER" : "AGENT"}: ${message.text.trim()}`).join("\n\n");
  return text.length > TRANSCRIPT_CHARS ? `…${text.slice(-TRANSCRIPT_CHARS)}` : text;
}

/** Plain lines, not JSON: some providers ignore an output schema, but all follow a three-line format. */
export function catchUpPrompt(transcript: string): string {
  return [
    "You write a catch-up note for a user returning to a chat with a coding agent after hours away. Do not use tools or read files.",
    "Answer with exactly three lines, nothing else:",
    "TITLE: <2-5 words naming what the chat is about>",
    `LEFT: <where it stands now, max ${CATCH_UP_MAX} characters>`,
    `NEXT: <the next step and who takes it (you = the user), max ${CATCH_UP_MAX} characters>`,
    "Plain words, no filler, no markdown.",
    "",
    "<chat>",
    transcript,
    "</chat>",
  ].join("\n");
}

function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").replace(/^[*_`"']+|[*_`"']+$/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The three fields of the model's answer, each cut to its limit; null when one is missing. */
export function parseCatchUp(answer: string, at: number): CatchUp | null {
  const field = (name: string) => answer.match(new RegExp(`^[\\s*_#>-]*${name}[*_]*\\s*:\\s*(.+)$`, "im"))?.[1] ?? "";
  const title = cut(field("TITLE"), TITLE_MAX);
  const left = cut(field("LEFT"), CATCH_UP_MAX);
  const next = cut(field("NEXT"), CATCH_UP_MAX);
  return title && left && next ? { title, left, next, at } : null;
}

/**
 * Whether the chat still has a name nobody chose: none, Paseo's default (the start of the first prompt), or the
 * last one a catch-up gave it. A name you typed yourself is never replaced.
 */
export function hasDefaultTitle(title: string | null | undefined, firstPrompt: string | null, lastCatchUp: CatchUp | null): boolean {
  const name = (title ?? "").trim();
  if (!name) return true;
  if (lastCatchUp && name === lastCatchUp.title) return true;
  const [prompt, start] = [firstPrompt ?? "", name].map((text) => text.replace(/\s+/g, " ").trim()) as [string, string];
  return !!prompt && prompt.startsWith(start);
}
