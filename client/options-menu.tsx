// Options (sliders button): folding, mark read, order, profile switcher, Settings.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { bindPlatform, type Profile } from "../shared/profiles";
import type { Platform } from "../shared/types";
import { useNavigatorStore } from "./runtime";
import { Sheet, SheetDivider, SheetItem, SheetNote, type Anchor } from "./sheet";

export const PLATFORM_LABEL: Record<Platform, string> = { ios: "iOS", android: "Android", web: "Web / Desktop" };

export function OptionsMenu({
  theme,
  compact,
  anchor,
  platform,
  profile,
  anyCollapsed,
  unread,
  onFoldAll,
  onMarkUnreadRead,
  onArrange,
  onSettings,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  anchor: Anchor | null;
  platform: Platform;
  profile: Profile;
  anyCollapsed: boolean;
  unread: number;
  onFoldAll(): void;
  onMarkUnreadRead(): void;
  /** Phones: arrange mode. Desktop: switch to manual order. */
  onArrange(): void;
  onSettings(): void;
  onClose(): void;
}) {
  const { store, snapshot } = useNavigatorStore();
  const c = theme.colors;
  const manual = profile.settings.sort === "manual";
  const bound = profile.platform === platform;
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Sheet theme={theme} title="Options" compact={compact} anchor={anchor} width={300} onClose={onClose}>
      <SheetNote theme={theme}>{`${profile.name} profile · ${manual ? "manual order" : "automatic order"}`}</SheetNote>
      <SheetItem theme={theme} compact={compact} icon={anyCollapsed ? "ChevronsUpDown" : "ChevronsDownUp"} label={anyCollapsed ? "Expand all" : "Collapse all"} onPress={then(onFoldAll)} />
      <SheetItem theme={theme} compact={compact} icon="CheckCheck" label={unread ? `Mark ${unread} unread as read` : "No unread chats"} disabled={!unread} onPress={then(onMarkUnreadRead)} />
      {compact ? (
        <SheetItem theme={theme} compact={compact} icon="GripVertical" label="Arrange order…" onPress={then(onArrange)} />
      ) : manual ? null : (
        <SheetItem theme={theme} compact={compact} icon="GripVertical" label="Switch to manual order" onPress={then(onArrange)} />
      )}
      <SheetDivider theme={theme} />
      {snapshot.profiles.map((entry) => (
        <SheetItem
          key={entry.id}
          theme={theme}
          compact={compact}
          icon="UserRound"
          label={entry.name}
          onPress={then(() => store.selectProfile(entry.id))}
          trailing={entry.id === profile.id ? <Icon name="Check" size={16} color={c.accent} /> : null}
        />
      ))}
      <SheetItem
        theme={theme}
        compact={compact}
        icon="Pin"
        label={bound ? `"${profile.name}" is the default for ${PLATFORM_LABEL[platform]}` : `Use "${profile.name}" as default for ${PLATFORM_LABEL[platform]}`}
        disabled={bound}
        onPress={then(() => store.editProfiles((profiles) => bindPlatform(profiles, profile.id, platform, Date.now())))}
      />
      <SheetDivider theme={theme} />
      <SheetItem theme={theme} compact={compact} icon="Settings" label="Settings…" onPress={then(onSettings)} />
    </Sheet>
  );
}
