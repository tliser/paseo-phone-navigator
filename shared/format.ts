// Display helpers. Pure.

/**
 * Short model name: provider prefix and date suffix removed.
 * "anthropic/claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5", "openai/gpt-5.4" -> "gpt-5.4".
 */
export function shortenModel(model: string | null | undefined): string {
  if (!model) return "";
  const last = model.split("/").filter(Boolean).pop()?.trim() ?? "";
  return last
    .replace(/[-@_](\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/[-@](latest)$/, "")
    .trim();
}

/** "now", "5m", "3h", "2d", "4w". Unknown (0) gives "". */
export function timeAgo(at: number, now: number): string {
  if (!at) return "";
  const minutes = Math.max(0, (now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 7)}w`;
}

/** ISO timestamp to epoch ms; null, undefined and unparsable give 0. */
export function epoch(iso: string | null | undefined): number {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}
