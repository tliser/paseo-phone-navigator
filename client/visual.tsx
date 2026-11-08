import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { WorkspaceStatus } from "../shared/types";

/** Status palette. Amber/blue/grey are fixed hues; danger and success follow the theme. */
export function statusLook(theme: PluginTheme, status: WorkspaceStatus): { icon: string; color: string; label: string } {
  switch (status) {
    case "needs_input":
      return { icon: "MessageCircle", color: theme.colors.statusWarning, label: "Needs input" };
    case "failed":
      return { icon: "CircleX", color: theme.colors.statusDanger, label: "Failed" };
    case "running":
      return { icon: "LoaderCircle", color: "#60A5FA", label: "Running" };
    case "attention":
      return { icon: "CircleAlert", color: theme.colors.statusWarning, label: "Needs attention" };
    default:
      return { icon: "Check", color: theme.colors.foregroundMuted, label: "Done" };
  }
}

export function Badge({ theme, count, small }: { theme: PluginTheme; count: number; small?: boolean }) {
  if (count <= 0) return null;
  const size = small ? 16 : 18;
  return (
    <View
      style={{
        minWidth: size,
        height: size,
        paddingHorizontal: 5,
        borderRadius: size / 2,
        backgroundColor: theme.colors.statusDanger,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: small ? 10 : 11, fontWeight: "700" }}>{count > 99 ? "99+" : String(count)}</Text>
    </View>
  );
}

export function StatusIcon({ theme, status, size = 18 }: { theme: PluginTheme; status: WorkspaceStatus; size?: number }) {
  const look = statusLook(theme, status);
  return (
    <View accessibilityLabel={look.label}>
      <Icon name={look.icon} size={size} color={look.color} />
    </View>
  );
}
