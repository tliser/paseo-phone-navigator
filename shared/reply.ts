// The opening of an agent's last reply as plain text, for the Inbox when no current catch-up exists. Free:
// no model reads it. Headings, code, tables and rules are skipped; markdown marks are dropped. Pure.

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
