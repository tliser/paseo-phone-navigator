// Text and rows follow the interface font size set in Paseo (Settings, Appearance), like Paseo's own
// lists. Sizes here are authored for Paseo's default of 14 px. The app does not announce a change, so
// the value is re-read every few seconds while the list is on screen. Phones have no such setting: 1.
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

declare const localStorage: { getItem(key: string): string | null };

const BASE_UI_FONT_SIZE = 14;
const POLL_MS = 3000;
/** Where the web and desktop app keep its own settings. */
const APP_SETTINGS_KEY = "@paseo:app-settings";

function readUiFontSize(): number | null {
  if (Platform.OS !== "web") return null;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    const settings: unknown = raw ? JSON.parse(raw) : null;
    if (typeof settings !== "object" || settings === null || !("uiBaseFontSize" in settings)) return null;
    const size = (settings as { uiBaseFontSize: unknown }).uiBaseFontSize;
    return typeof size === "number" && size > 0 ? size : null;
  } catch {
    return null;
  }
}

let scale = (readUiFontSize() ?? BASE_UI_FONT_SIZE) / BASE_UI_FONT_SIZE;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
  const next = (readUiFontSize() ?? BASE_UI_FONT_SIZE) / BASE_UI_FONT_SIZE;
  if (next === scale) return;
  scale = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer && Platform.OS === "web") {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The interface font size over Paseo's default (1 = 14 px). */
export function useFontScale(): number {
  return useSyncExternalStore(subscribe, () => scale, () => scale);
}

/** Monospace face for branch names. */
export const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, Consolas, monospace" });
