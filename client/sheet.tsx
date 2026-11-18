// A menu that is a bottom sheet on phones and a popover under its button on desktop. A modal dialog
// with a visible Close button; tapping the scrim closes it too.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";

/** Where the popover hangs on desktop: the opening button's frame in window coordinates. */
export interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Measures a pressed view for `Anchor`. */
export function measureAnchor(view: View | null, done: (anchor: Anchor | null) => void): void {
  if (!view) return done(null);
  view.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
}

export function Sheet({
  theme,
  title,
  compact,
  anchor,
  width = 300,
  onClose,
  children,
}: {
  theme: PluginTheme;
  title: string;
  compact: boolean;
  anchor: Anchor | null;
  width?: number;
  onClose(): void;
  children: ReactNode;
}) {
  const c = theme.colors;
  const window = useWindowDimensions();
  const popover = !compact && anchor;
  const panelWidth = Math.min(width, window.width - 16);
  // Under the button, or above it when there is little room below.
  const below = popover ? window.height - (anchor.y + anchor.height + 4) - 8 : 0;
  const above = popover ? anchor.y - 12 : 0;
  const placement = popover
    ? {
        position: "absolute" as const,
        left: Math.max(8, Math.min(anchor.x, window.width - panelWidth - 8)),
        width: panelWidth,
        borderRadius: 12,
        ...(below >= 240 || below >= above ? { top: anchor.y + anchor.height + 4, maxHeight: below } : { bottom: window.height - anchor.y + 4, maxHeight: above }),
      }
    : { position: "absolute" as const, left: 8, right: 8, bottom: 8, maxHeight: window.height * 0.85, borderRadius: 16 };
  return (
    <Modal transparent visible animationType={compact ? "slide" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: popover ? "transparent" : "rgba(0,0,0,0.45)" }} />
      <View
        accessibilityViewIsModal
        accessibilityLabel={title}
        style={{ ...placement, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, padding: 6, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 10 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 15, fontWeight: "700" }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}>
            <Icon name="X" size={18} color={c.foreground} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** One action line in a sheet. */
export function SheetItem({
  theme,
  icon,
  label,
  onPress,
  disabled,
  danger,
  trailing,
  compact,
}: {
  theme: PluginTheme;
  icon?: string;
  label: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
  trailing?: ReactNode;
  compact: boolean;
}) {
  const c = theme.colors;
  const color = danger ? c.statusDanger : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: compact ? 48 : 40, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 8, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? c.surface2 : "transparent" })}
    >
      {icon ? <Icon name={icon} size={16} color={danger ? c.statusDanger : c.foregroundMuted} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, color, fontSize: compact ? 15 : 13.5 }}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

export function SheetDivider({ theme }: { theme: PluginTheme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />;
}

export function SheetNote({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <Text style={{ paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: theme.colors.foregroundMuted }}>{children}</Text>;
}
