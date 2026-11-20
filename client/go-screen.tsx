// Composer pills and their popovers cannot navigate; only screens get `navigation`. Outside the sidebar view
// (which publishes Paseo's own opener) they open this screen with the chat, and it forwards at once.
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

export const GO_SCREEN_ID = "go";

export function GoScreen({ theme, navigation, params }: PluginScreenProps) {
  const { agentId, serverId } = params;
  const openAgent = navigation?.openAgent;
  // `navigation` may be a new object on every render: open each chat once.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!agentId || !openAgent || opened.current === `${serverId}:${agentId}`) return;
    opened.current = `${serverId}:${agentId}`;
    openAgent(serverId ? { agentId, serverId } : { agentId });
  }, [openAgent, agentId, serverId]);
  if (agentId && openAgent) return <Loading />;
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground }}>This version of Paseo cannot open a chat from a plugin.</Text>
    </View>
  );
}
