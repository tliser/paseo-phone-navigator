import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { bindPlatform, type Profile } from "../shared/profiles";
import type { Platform } from "../shared/types";
import { useNavigatorStore } from "./runtime";

export const PLATFORM_LABEL: Record<Platform, string> = { ios: "iOS", android: "Android", web: "Web / Desktop" };
const FILTER_LABEL = { all: "All", active: "Active", inbox: "Inbox" } as const;

export function ProfileSheet({ theme, platform, active, onClose, onEdit }: { theme: PluginTheme; platform: Platform; active: Profile; onClose(): void; onEdit(): void }) {
  const { store, snapshot } = useNavigatorStore();
  const c = theme.colors;
  const bound = active.platform === platform;
  const item = { minHeight: 52, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 4 };

  return (
    <Modal title="Profile on this device" open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        {snapshot.profiles.map((profile) => (
          <Pressable
            key={profile.id}
            accessibilityRole="button"
            accessibilityState={{ selected: profile.id === active.id }}
            onPress={() => {
              store.selectProfile(profile.id);
              onClose();
            }}
            style={item}
          >
            <View style={{ width: 22 }}>{profile.id === active.id ? <Icon name="Check" size={18} color={c.accent} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.foreground, fontSize: 16 }}>{profile.name}</Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                {`${profile.settings.density} · ${FILTER_LABEL[profile.settings.defaultFilter]}${profile.platform ? ` · default for ${PLATFORM_LABEL[profile.platform]}` : ""}`}
              </Text>
            </View>
          </Pressable>
        ))}
        <View style={{ height: 1, backgroundColor: c.border }} />
        <Pressable
          accessibilityRole="button"
          disabled={bound}
          onPress={() => {
            store.editProfiles((profiles) => bindPlatform(profiles, active.id, platform, Date.now()));
            onClose();
          }}
          style={{ ...item, opacity: bound ? 0.45 : 1 }}
        >
          <View style={{ width: 22 }}>
            <Icon name="Pin" size={18} color={c.foregroundMuted} />
          </View>
          <Text style={{ flex: 1, color: c.foreground, fontSize: 16 }}>
            {bound ? `"${active.name}" is the default for ${PLATFORM_LABEL[platform]}` : `Use "${active.name}" as default for ${PLATFORM_LABEL[platform]}`}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEdit} style={item}>
          <View style={{ width: 22 }}>
            <Icon name="Settings" size={18} color={c.foregroundMuted} />
          </View>
          <Text style={{ flex: 1, color: c.foreground, fontSize: 16 }}>Edit in Settings</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}
