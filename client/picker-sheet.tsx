// A choice from a long list: a search field, then the matching entries in a list that scrolls inside the
// sheet. Used for the catch-up provider and model, which Paseo's settings selects cannot scroll through.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useOwnField } from "./chat-nav";
import { Sheet } from "./sheet";

export interface PickerItem {
  value: string;
  label: string;
  /** A second line, e.g. the model id; also searched. */
  detail?: string;
}

export function PickerSheet({
  theme,
  compact,
  title,
  items,
  selected,
  loading,
  error,
  onPick,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  title: string;
  items: readonly PickerItem[];
  selected: string | null;
  loading: boolean;
  error: string | null;
  onPick(value: string): void;
  onClose(): void;
}) {
  const c = theme.colors;
  const field = useOwnField();
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((item) => {
    const text = `${item.label} ${item.detail ?? ""} ${item.value}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const note = (text: string) => <Text style={{ color: c.foregroundMuted, fontSize: 13, padding: 10 }}>{text}</Text>;

  return (
    <Sheet theme={theme} title={title} compact={compact} anchor={null} width={420} onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 6, marginBottom: 6, paddingHorizontal: 10, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}>
        <Icon name="Search" size={15} color={c.foregroundMuted} />
        <TextInput
          {...field}
          value={query}
          onChangeText={setQuery}
          autoFocus={!compact}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`Search: ${title}`}
          placeholder="Search"
          placeholderTextColor={c.foregroundMuted}
          style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 8 }}
        />
      </View>
      {/* Grows with the list up to the sheet's height, then scrolls. */}
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {error ? note(error) : null}
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10 }}>
            <ActivityIndicator size="small" color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Loading…</Text>
          </View>
        ) : !shown.length ? (
          note(words.length ? "Nothing matches." : "Nothing to choose from.")
        ) : (
          shown.map((item) => {
            const on = item.value === selected;
            return (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={item.label}
                onPress={() => {
                  onPick(item.value);
                  onClose();
                }}
                style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pressed || on ? c.surface2 : "transparent" })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 14, fontWeight: on ? "600" : "400" }}>{item.label}</Text>
                  {item.detail && item.detail !== item.label ? <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{item.detail}</Text> : null}
                </View>
                {on ? <Icon name="Check" size={16} color={c.accent} /> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </Sheet>
  );
}
