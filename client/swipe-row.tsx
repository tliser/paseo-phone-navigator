// Horizontal swipe on a phone row: past the threshold the action fires on release, then the row slides
// back. A mostly vertical move never claims the gesture, so the list still scrolls.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Text, View } from "react-native";

export interface SwipeAction {
  icon: string;
  label: string;
  color: string;
  onFire(): void;
}

const THRESHOLD = 72;
const MAX = 120;

export function SwipeRow({ theme, height, swipeLeft, swipeRight, children }: { theme: PluginTheme; height: number; swipeLeft: SwipeAction | null; swipeRight: SwipeAction | null; children: ReactNode }) {
  const c = theme.colors;
  const offset = useRef(new Animated.Value(0)).current;
  const [side, setSide] = useState<{ action: SwipeAction; dir: -1 | 1; armed: boolean } | null>(null);
  // The handlers outlive renders; they read the newest actions from here.
  const actions = useRef({ swipeLeft, swipeRight });
  actions.current = { swipeLeft, swipeRight };

  const responder = useMemo(() => {
    const actionFor = (dx: number) => (dx < 0 ? actions.current.swipeLeft : actions.current.swipeRight);
    const settle = () => {
      Animated.timing(offset, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => setSide(null));
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2 && !!actionFor(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, g) => {
        const action = actionFor(g.dx);
        const dx = action ? Math.max(-MAX, Math.min(MAX, g.dx)) : 0;
        offset.setValue(dx);
        const next = action ? { action, dir: (dx < 0 ? -1 : 1) as -1 | 1, armed: Math.abs(dx) >= THRESHOLD } : null;
        setSide((current) => (current?.action === next?.action && current?.armed === next?.armed ? current : next));
      },
      onPanResponderRelease: (_event, g) => {
        const action = actionFor(g.dx);
        if (action && Math.abs(g.dx) >= THRESHOLD) action.onFire();
        settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [offset]);

  return (
    <View style={{ height, overflow: "hidden" }}>
      {side ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: side.dir < 0 ? "flex-end" : "flex-start",
            gap: 6,
            paddingHorizontal: 20,
            backgroundColor: side.armed ? side.action.color : c.surface2,
          }}
        >
          <Icon name={side.action.icon} size={18} color={side.armed ? c.surface0 : c.foreground} />
          <Text style={{ color: side.armed ? c.surface0 : c.foreground, fontSize: 13, fontWeight: "700" }}>{side.action.label}</Text>
        </View>
      ) : null}
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: offset }] }}>
        {children}
      </Animated.View>
    </View>
  );
}
