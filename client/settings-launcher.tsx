// What Paseo's plugin page shows under the plugin's description: a way into the full settings screen,
// and Updates. The profile settings live on their own screen, where the preview can stay on top.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { UpdatesSection } from "./updates-section";

export function SettingsLauncher({ layout, openProfiles }: PluginSurfaceProps & { openProfiles(): void }) {
  const { snapshot } = useNavigatorStore();
  const active = useActiveProfile(snapshot, layout.platform, layout.compact);
  return (
    <>
      <SettingsSection title="Profiles">
        <SettingsCard>
          <SettingsAction
            label="Views, rows, hosts and order"
            hint={`${snapshot.profiles.length} ${snapshot.profiles.length === 1 ? "profile" : "profiles"}; this device uses "${active.name}".`}
            actionLabel="Open"
            onPress={openProfiles}
          />
        </SettingsCard>
      </SettingsSection>
      <UpdatesSection />
    </>
  );
}
