// Picks a project's folder colour. Opened by long-pressing the folder icon of a project heading.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { PROJECT_COLORS } from "../shared/colors";

export function ColorPicker({ theme, name, current, onPick, onClose }: { theme: PluginTheme; name: string; current: string; onPick(id: string): void; onClose(): void }) {
  const c = theme.colors;
  return (
    <Modal title={`Folder colour · ${name}`} open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", paddingVertical: 4 }}>
          {PROJECT_COLORS.map((color) => {
            const hex = color.hex ?? c.accent;
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
                  <Icon name="Folder" size={22} color={hex} />
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
