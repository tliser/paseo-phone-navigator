// Picks the colour of a project's folder or a host's icon. Opened by long-pressing that icon.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { ICON_COLORS } from "../shared/colors";

export interface ColorTarget {
  /** `projectColorKey` or `hostColorKey`. */
  key: string;
  title: string;
  icon: string;
  /** What "Default" looks like for this icon. */
  fallback: string;
}

export function ColorPicker({ theme, target, current, onPick, onClose }: { theme: PluginTheme; target: ColorTarget; current: string; onPick(id: string): void; onClose(): void }) {
  const c = theme.colors;
  return (
    <Modal title={target.title} open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", paddingVertical: 4 }}>
          {ICON_COLORS.map((color) => {
            const hex = color.hex ?? target.fallback;
            const selected = color.id === current;
            return (
              <Pressable
                key={color.id}
                accessibilityRole="button"
                accessibilityLabel={`${color.label}${selected ? ", selected" : ""}`}
                accessibilityState={{ selected }}
                onPress={() => {
                  onPick(color.id);
                  onClose();
                }}
                style={{ width: 64, alignItems: "center", gap: 4 }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2, borderWidth: 2, borderColor: selected ? hex : "transparent" }}>
                  <Icon name={target.icon} size={22} color={hex} />
                </View>
                <Text numberOfLines={1} style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 12 }}>{color.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Modal.Content>
    </Modal>
  );
}
