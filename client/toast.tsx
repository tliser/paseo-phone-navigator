// A small bar at the bottom of the navigator: what just happened, with Undo. Hides after 5 s.
import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export interface ToastMessage {
  text: string;
  undo?: () => void;
}

const SHOW_MS = 5_000;

export function useToastState(): { toast: ToastMessage | null; show(message: ToastMessage): void; hide(): void } {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);
  const show = useCallback((message: ToastMessage) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(null), SHOW_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, show, hide };
}

export function Toast({ theme, toast, onHide }: { theme: PluginTheme; toast: ToastMessage | null; onHide(): void }) {
  if (!toast) return null;
  const c = theme.colors;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 16, alignItems: "center", paddingHorizontal: 10 }}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "100%", minHeight: 44, paddingLeft: 16, paddingRight: toast.undo ? 4 : 16, borderRadius: 22, backgroundColor: c.foreground, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}
      >
        <Text numberOfLines={2} style={{ flexShrink: 1, color: c.surface0, fontSize: 13 }}>{toast.text}</Text>
        {toast.undo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            onPress={() => {
              toast.undo?.();
              onHide();
            }}
            style={{ minHeight: 44, minWidth: 64, paddingHorizontal: 14, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: c.surface0, fontWeight: "700", fontSize: 13 }}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
