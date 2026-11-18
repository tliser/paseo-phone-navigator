// One glyph shape per status, so status never depends on colour alone.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View } from "react-native";
import type { ChatState } from "../shared/types";
import { RUNNING_VIOLET, UNREAD_BLUE } from "./colors";

export type MarkKind = ChatState | "terminal";

export const MARK_LABEL: Record<MarkKind, string> = {
  asking: "Asks you",
  error: "Agent error",
  unread: "Unread",
  running: "Running",
  read: "Read",
  terminal: "Terminal",
};

export function markColor(theme: PluginTheme, kind: MarkKind): string {
  const c = theme.colors;
  if (kind === "asking") return c.statusWarning;
  if (kind === "error") return c.statusDanger;
  if (kind === "unread") return UNREAD_BLUE;
  if (kind === "running") return RUNNING_VIOLET;
  return c.foregroundMuted;
}

const ICON: Record<Exclude<MarkKind, "unread" | "read">, string> = {
  asking: "CircleHelp",
  error: "TriangleAlert",
  running: "LoaderCircle",
  terminal: "SquareTerminal",
};

let reduceMotion = false;
const motionListeners = new Set<(value: boolean) => void>();
let motionWatched = false;
function useReduceMotion(): boolean {
  const [value, setValue] = useState(reduceMotion);
  useEffect(() => {
    if (!motionWatched) {
      motionWatched = true;
      const publish = (next: boolean) => {
        reduceMotion = next;
        for (const listener of motionListeners) listener(next);
      };
      AccessibilityInfo.isReduceMotionEnabled().then(publish, () => undefined);
      AccessibilityInfo.addEventListener("reduceMotionChanged", publish);
    }
    motionListeners.add(setValue);
    return () => void motionListeners.delete(setValue);
  }, []);
  return value;
}

function Spinner({ size, color }: { size: number; color: string }) {
  const still = useReduceMotion();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
    loop.start();
    return () => {
      loop.stop();
      turn.setValue(0);
    };
  }, [still, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="LoaderCircle" size={size} color={color} />
    </Animated.View>
  );
}

/** A status glyph. Pass `label` to announce it on its own; leave it out when the parent's label says it. */
export function Mark({ theme, kind, size = 14, label }: { theme: PluginTheme; kind: MarkKind; size?: number; label?: string }) {
  const color = markColor(theme, kind);
  let glyph;
  if (kind === "unread") glyph = <View style={{ width: size * 0.6, height: size * 0.6, borderRadius: size, backgroundColor: color }} />;
  else if (kind === "read") glyph = <View style={{ width: size * 0.55, height: size * 0.55, borderRadius: size, borderWidth: 1.5, borderColor: color }} />;
  else if (kind === "running") glyph = <Spinner size={size} color={color} />;
  else glyph = <Icon name={ICON[kind]} size={size} color={color} />;
  return (
    <View
      accessible={!!label}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {glyph}
    </View>
  );
}

const tallyCount = (n: number) => (n > 99 ? "99+" : String(n));

/** Glyph and number per waiting state (asks you, failed, unread); nothing when all are zero. */
export function TallyMarks({ theme, tally, size = 12 }: { theme: PluginTheme; tally: { asking: number; error: number; unread: number }; size?: number }) {
  const kinds = (["asking", "error", "unread"] as const).filter((kind) => tally[kind] > 0);
  if (!kinds.length) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {kinds.map((kind) => (
        <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Mark theme={theme} kind={kind} size={size} />
          <Text style={{ color: markColor(theme, kind), fontSize: size, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{tallyCount(tally[kind])}</Text>
        </View>
      ))}
    </View>
  );
}
