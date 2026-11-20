// The opening of an agent's last reply as plain text, for the Inbox when no current catch-up exists. Free:
// no model reads it. The chat's host stores it on the agent (metadata) when a turn ends, while the agent is
// still loaded: reading a closed agent's history would start it again. Headings, code, tables and rules are
// skipped; markdown marks are dropped. Pure.

/** Agent metadata key the reply opening is stored under. */
export const REPLY_KEY = "workspace-organizer.reply";

/** The stored reply opening, or "" when there is none. */
export function readReply(metadata: unknown): string {
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[REPLY_KEY] : undefined;
  return typeof raw === "string" ? raw : "";
}

/** Longest text kept, in characters (about two Inbox lines). */
export const REPLY_MAX = 160;

export function replySummary(markdown: string): string {
  const sentences: string[] = [];
  let code = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      code = !code;
      continue;
    }
    if (code || !line || /^(#|\||>?\s*$|[-*_]{3,}$|<)/.test(line)) continue;
    const plain = line
      .replace(/^(>\s*)+/, "")
      .replace(/^([-*+]|\d+[.)])\s+/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/\$\$?([^$]*)\$\$?/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) continue;
    sentences.push(plain);
    if (sentences.join(" ").length >= REPLY_MAX) break;
  }
  const text = sentences.join(" ");
  return text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX - 1).trimEnd()}…` : text;
}
