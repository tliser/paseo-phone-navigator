// Settings: automatic updates of this plugin on the host, the installed version, and "Check now".
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { checkForUpdateRpc, installedVersionRpc, updatesSettings, type InstalledVersion } from "../shared/updates";

export function UpdatesSection() {
  const settings = useSettings(updatesSettings);
  const installed = useRpc(installedVersionRpc);
  const checkNow = useRpc(checkForUpdateRpc);
  const [version, setVersion] = useState<InstalledVersion | null | undefined>(undefined);
  const [result, setResult] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    installed({}).then((value) => live && setVersion(value), () => live && setVersion(null));
    return () => {
      live = false;
    };
    // The RPC helper is stable for the screen's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromGit = !!version;
  const versionText =
    version === undefined ? "Checking…" : version ? `${version.commit.slice(0, 7)}, installed ${new Date(version.installedAt).toLocaleDateString()}` : "Local folder (development): not updated automatically";

  return (
    <SettingsSection title="Updates" info="Installed from GitHub, the plugin checks for a new version a few minutes after the host starts and every 6 hours, and installs it on its own.">
      <SettingsCard>
        <SettingsRow label="Installed version" hint={versionText} />
        <SettingsSwitch
          label="Update automatically"
          value={settings.status === "ready" ? settings.values.autoUpdate : true}
          disabled={settings.status !== "ready" || !fromGit}
          onValueChange={(autoUpdate) => {
            if (settings.status === "ready") void settings.save({ ...settings.values, autoUpdate }, settings.revision);
          }}
        />
        <SettingsAction
          label="Check for an update now"
          hint={result ?? undefined}
          actionLabel={checking ? "Checking…" : "Check now"}
          disabled={checking || !fromGit}
          onPress={() => {
            setChecking(true);
            setResult(null);
            checkNow({})
              .then((answer) => setResult(answer.result), (error: unknown) => setResult(`Failed: ${error instanceof Error ? error.message : String(error)}`))
              .finally(() => setChecking(false));
          }}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
