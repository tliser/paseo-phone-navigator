import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { Tally } from "../shared/tree";
import type { WorkspaceState, WorkspaceStatus } from "../shared/types";

export const UNREAD_BLUE = "#60A5FA";
/** Distinct from unread blue so running and unread never read as the same state. */
const RUNNING_VIOLET = "#A78BFA";
/** Dark text on amber/blue badge fills; white fails WCAG contrast there. */
const BADGE_TEXT = "#0B1220";

/** Icon per row state. Only "needs you" uses the warning colour. */
export function stateLook(theme: PluginTheme, state: WorkspaceState, status: WorkspaceStatus): { icon: string; color: string; label: string } {
  if (state === "needs_you") return { icon: "MessageCircleQuestion", color: theme.colors.statusWarning, label: "Asking you" };
  if (state === "running") return { icon: "LoaderCircle", color: RUNNING_VIOLET, label: "Running" };
  if (state === "unread") {
    return status === "failed"
      ? { icon: "CircleX", color: theme.colors.statusDanger, label: "Failed, unread" }
      : { icon: "CircleDot", color: UNREAD_BLUE, label: "New output, unread" };
  }
  return status === "failed"
    ? { icon: "CircleX", color: theme.colors.foregroundMuted, label: "Failed" }
    : { icon: "Check", color: theme.colors.foregroundMuted, label: "Done" };
}

function Pill({ color, text, small }: { color: string; text: string; small?: boolean }) {
  const size = small ? 16 : 18;
  return (
    <View style={{ minWidth: size, height: size, paddingHorizontal: 5, borderRadius: size / 2, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: BADGE_TEXT, fontSize: small ? 11 : 12, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

const count = (n: number) => (n > 99 ? "99+" : String(n));

/** Amber number = agents asking you; blue number = unread workspaces. Nothing when both are zero. */
export function TallyBadge({ theme, tally, small }: { theme: PluginTheme; tally: Tally; small?: boolean }) {
  if (!tally.needsYou && !tally.unread) return null;
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      {tally.needsYou ? <Pill color={theme.colors.statusWarning} text={count(tally.needsYou)} small={small} /> : null}
      {tally.unread ? <Pill color={UNREAD_BLUE} text={count(tally.unread)} small={small} /> : null}
    </View>
  );
}

export function StateIcon({ theme, state, status, size = 18 }: { theme: PluginTheme; state: WorkspaceState; status: WorkspaceStatus; size?: number }) {
  const look = stateLook(theme, state, status);
  return (
    <View accessibilityLabel={look.label}>
      <Icon name={look.icon} size={size} color={look.color} />
    </View>
  );
}
