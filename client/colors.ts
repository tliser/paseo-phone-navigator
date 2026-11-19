import type { PluginTheme } from "@getpaseo/plugin";
import { isLightColor } from "../shared/colors";

// Paseo's theme has no colour for unread or running. Both keep their hue and take a darker shade on
// light themes, so they stay readable on every theme's surface.
export const unreadColor = (theme: PluginTheme) => (isLightColor(theme.colors.surface0) ? "#2563EB" : "#60A5FA");
/** Distinct from unread blue so running and unread never read as the same state. */
export const runningColor = (theme: PluginTheme) => (isLightColor(theme.colors.surface0) ? "#7C3AED" : "#A78BFA");
