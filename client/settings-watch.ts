import type { PluginClientContext } from "@getpaseo/plugin/client";

/** Calls `changed` when a settings document of this host changes on any client, and after reconnects. */
export function watchSettings(client: PluginClientContext, settingsIds: readonly string[], changed: () => void): () => void {
  const lifetime = new AbortController();
  try {
    const observation = client.paseo.observeEvents(["status.plugin_settings_changed" as never], { signal: lifetime.signal });
    let snapshots = 0;
    const unsubscribe = observation.subscribe({
      // The first snapshot arrives with the subscription, when the store reads anyway.
      snapshot: () => {
        if (snapshots++ > 0) changed();
      },
      update: (message) => {
        const { type, payload } = message as { type?: string; payload?: { status?: string; settingsId?: string } };
        if (type === "status" && payload?.status === "plugin_settings_changed" && payload.settingsId !== undefined && settingsIds.includes(payload.settingsId)) changed();
      },
      error: () => undefined,
    });
    return () => {
      unsubscribe();
      lifetime.abort();
      void observation.release().catch(() => undefined);
    };
  } catch {
    // Without event observation the document is still read on open and on refresh.
    lifetime.abort();
    return () => undefined;
  }
}
