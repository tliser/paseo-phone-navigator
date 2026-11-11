// The only module that touches a browser global. Web and desktop keep the chosen profile and the
// collapse state here; the phone apps have no storage for plugins, so every function is a no-op there.
import { Platform } from "react-native";

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const PREFIX = "phone-navigator:";

export function hasDeviceStorage(): boolean {
  if (Platform.OS !== "web") return false;
  try {
    localStorage.getItem(`${PREFIX}probe`);
    return true;
  } catch {
    return false;
  }
}

function read(key: string): string | null {
  if (!hasDeviceStorage()) return null;
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (!hasDeviceStorage()) return;
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Blocked or full storage: the choice lasts for this session only.
  }
}

export function readDeviceProfileId(): string | null {
  return read("profile");
}

export function writeDeviceProfileId(id: string): void {
  write("profile", id);
}

export function readDeviceCollapse(profileId: string): Record<string, boolean> | null {
  const raw = read(`collapse:${profileId}`);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "boolean") out[key] = value;
    return out;
  } catch {
    return null;
  }
}

export function writeDeviceCollapse(profileId: string, map: Readonly<Record<string, boolean>> | null): void {
  write(`collapse:${profileId}`, map ? JSON.stringify(map) : null);
}

export function readDevicePins(profileId: string): string[] | null {
  const raw = read(`pins:${profileId}`);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null;
  } catch {
    return null;
  }
}

export function writeDevicePins(profileId: string, pins: readonly string[]): void {
  write(`pins:${profileId}`, pins.length ? JSON.stringify(pins) : null);
}
