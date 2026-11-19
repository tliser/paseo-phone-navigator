// Folder colours a project can be given (long-press its folder icon). Chosen to stay apart from the
// status colours: no amber (asking you), no light blue (unread), no violet (running). Readable on dark
// and light themes. Ids are stored; changing a hex here recolours every project using it.
export interface ProjectColor {
  id: string;
  label: string;
  /** null: the theme's accent colour. */
  hex: string | null;
}

export const PROJECT_COLORS: readonly ProjectColor[] = [
  { id: "default", label: "Default", hex: null },
  { id: "red", label: "Red", hex: "#EF4444" },
  { id: "orange", label: "Orange", hex: "#F97316" },
  { id: "lime", label: "Lime", hex: "#84CC16" },
  { id: "green", label: "Green", hex: "#22C55E" },
  { id: "teal", label: "Teal", hex: "#14B8A6" },
  { id: "cyan", label: "Cyan", hex: "#06B6D4" },
  { id: "indigo", label: "Indigo", hex: "#6366F1" },
  { id: "pink", label: "Pink", hex: "#EC4899" },
  { id: "rose", label: "Rose", hex: "#FB7185" },
  { id: "brown", label: "Brown", hex: "#B45309" },
  { id: "slate", label: "Slate", hex: "#94A3B8" },
];

export const projectColorKey = (serverId: string, projectId: string) => `${serverId}:${projectId}`;

/** The hex for a stored colour id; the accent for "default" or an id this version does not know. */
export function projectColorHex(id: string | undefined, accent: string): string {
  return PROJECT_COLORS.find((color) => color.id === id)?.hex ?? accent;
}

/** Whether a CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb() or rgba()) is light, by relative luminance. Other formats count as dark. */
export function isLightColor(color: string): boolean {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1];
  const channels = hex
    ? hex.length === 3
      ? [...hex].map((digit) => parseInt(digit + digit, 16))
      : [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16))
    : /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value)?.slice(1, 4).map(Number);
  if (!channels) return false;
  const [r, g, b] = channels.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4;
}
