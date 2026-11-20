// Picks a model (`provider/model`) from what one host offers: a search field over provider and model names,
// then the matching models grouped by provider, in a list that scrolls inside the sheet.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useOwnField } from "./chat-nav";
import { useNavigatorStore } from "./runtime";
import { Sheet } from "./sheet";
import type { ProviderListState } from "./store";

export function ModelPickerSheet({
  theme,
  compact,
  title,
  serverId,
  selected,
  onPick,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  title: string;
  serverId: string;
  /** The chosen `provider/model`, if any. */
  selected: string | null;
  onPick(model: string): void;
  onClose(): void;
}) {
  const { store } = useNavigatorStore();
  const c = theme.colors;
  const field = useOwnField();
  const [providers, setProviders] = useState<ProviderListState | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => store.watchProviders(serverId, "~", setProviders), [store, serverId]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = (providers?.ready ?? [])
    .map((provider) => ({
      provider,
      models: provider.models.filter((model) => {
        const text = `${provider.label} ${provider.id} ${model.label} ${model.id}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.models.length);
  const loading = !providers || (!providers.ready.length && providers.loading.length > 0);
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
          accessibilityLabel="Search models"
          placeholder="Search models"
          placeholderTextColor={c.foregroundMuted}
          style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 8 }}
        />
      </View>
      {/* Grows with the list up to the sheet's height, then scrolls. */}
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {providers?.error ? note(`Could not list models: ${providers.error}`) : null}
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10 }}>
            <ActivityIndicator size="small" color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Loading models…</Text>
          </View>
        ) : !groups.length ? (
          note(words.length ? "No model matches." : "This host offers no models.")
        ) : (
          groups.map(({ provider, models }) => (
            <View key={provider.id} style={{ paddingBottom: 6 }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 6 }}>{provider.label}</Text>
              {models.map((model) => {
                const value = `${provider.id}/${model.id}`;
                const on = value === selected;
                return (
                  <Pressable
                    key={model.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${provider.label} ${model.label}`}
                    onPress={() => {
                      onPick(value);
                      onClose();
                    }}
                    style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pressed || on ? c.surface2 : "transparent" })}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 14, fontWeight: on ? "600" : "400" }}>{model.label}</Text>
                      {model.label !== model.id ? <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{model.id}</Text> : null}
                    </View>
                    {on ? <Icon name="Check" size={16} color={c.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}
