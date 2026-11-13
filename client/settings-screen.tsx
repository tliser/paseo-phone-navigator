import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  bindPlatform,
  defaultSettings,
  newProfileId,
  pruneCollapse,
  type Profile,
  type ProfileSettings,
} from "../shared/profiles";
import type { Platform } from "../shared/types";
import { PLATFORM_LABEL } from "./profile-sheet";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { SettingsPreview } from "./settings-preview";

type PlatformChoice = Platform | "none";

const RECENT_DAYS = [1, 2, 3, 7, 14, 30];

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const { store, snapshot } = useNavigatorStore();
  const active = useActiveProfile(snapshot, layout.platform, layout.compact);
  const [editId, setEditId] = useState(active.id);
  const edit = snapshot.profiles.find((profile) => profile.id === editId) ?? active;
  const [name, setName] = useState(edit.name);
  useEffect(() => setName(edit.name), [edit.id, edit.name]);
  const c = theme.colors;

  const update = (change: (profile: Profile) => Profile) => {
    const now = Date.now();
    store.editProfiles((profiles) => profiles.map((profile) => (profile.id === edit.id ? { ...change(profile), updatedAt: now } : profile)));
  };
  const updateSettings = (patch: Partial<ProfileSettings>) =>
    update((profile) => {
      const settings = { ...profile.settings, ...patch };
      return { ...profile, settings, collapse: pruneCollapse(profile.collapse, settings) };
    });

  const addProfile = (base: Profile | null) => {
    const now = Date.now();
    let created = "";
    store.editProfiles((profiles) => {
      created = newProfileId(profiles, now);
      const profile: Profile = base
        ? { ...base, id: created, name: `${base.name} copy`.slice(0, 60), platform: null, updatedAt: now }
        : { id: created, name: "New profile", platform: null, updatedAt: now, settings: defaultSettings(), collapse: {}, order: {}, pins: [] };
      return [...profiles, profile];
    });
    if (created) setEditId(created);
  };

  const remove = () => {
    if (snapshot.profiles.length < 2) return;
    const id = edit.id;
    store.editProfiles((profiles) => (profiles.length < 2 ? profiles : profiles.filter((profile) => profile.id !== id)));
    const next = snapshot.profiles.find((profile) => profile.id !== id);
    if (next) {
      setEditId(next.id);
      if (active.id === id) store.selectProfile(next.id);
    }
  };

  const s = edit.settings;
  const yesNo = (value: boolean, set: (value: boolean) => void, label: string, hint?: string, key?: string) => (
    <SettingsSwitch key={key ?? label} label={label} hint={hint} value={value} onValueChange={set} disabled={!snapshot.profilesReady} />
  );

  const preview = <SettingsPreview theme={theme} profile={edit} snapshot={snapshot} maxRows={layout.compact ? 4 : 8} />;
  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    {/* Phones: the preview stays above the scrolling settings so each change shows at once. */}
    {layout.compact ? <View style={{ padding: 12, paddingBottom: 0 }}>{preview}</View> : null}
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 12 : 24, gap: 16 }}>
      <SettingsSection title="Profiles" info="Profiles are shared by every client of this host. Each device picks one; the first profile bound to a platform is used until you pick another.">
        <SettingsCard>
          <SettingsSelect
            label="Profile to edit"
            value={edit.id}
            options={snapshot.profiles.map((profile) => ({ value: profile.id, label: `${profile.name}${profile.id === active.id ? " (this device)" : ""}` }))}
            onValueChange={setEditId}
          />
          <SettingsAction label="Use on this device" actionLabel={edit.id === active.id ? "In use" : "Use"} disabled={edit.id === active.id} onPress={() => store.selectProfile(edit.id)} />
          <SettingsAction label="New profile" actionLabel="Create" disabled={!snapshot.profilesReady} onPress={() => addProfile(null)} />
          <SettingsAction label="Duplicate this profile" actionLabel="Duplicate" disabled={!snapshot.profilesReady} onPress={() => addProfile(edit)} />
          <SettingsAction label="Delete this profile" hint={snapshot.profiles.length < 2 ? "The last profile cannot be deleted." : undefined} actionLabel="Delete" disabled={snapshot.profiles.length < 2 || !snapshot.profilesReady} onPress={remove} />
        </SettingsCard>
        {snapshot.savingError ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{snapshot.savingError}</Text> : null}
      </SettingsSection>

      {layout.compact ? null : (
        <SettingsSection title="Preview" info="How the navigator looks with this profile: its density, default filter, order and the fields rows show.">
          {preview}
        </SettingsSection>
      )}

      <SettingsSection title={`Profile "${edit.name}"`}>
        <SettingsCard>
          <SettingsInput
            key={edit.id}
            label="Name"
            initialValue={name}
            onChangeText={(text) => {
              setName(text);
              const trimmed = text.trim().slice(0, 60);
              if (trimmed && trimmed !== edit.name) update((profile) => ({ ...profile, name: trimmed }));
            }}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect<PlatformChoice>
            label="Default for platform"
            value={edit.platform ?? "none"}
            options={[
              { value: "none", label: "None" },
              { value: "ios", label: PLATFORM_LABEL.ios },
              { value: "android", label: PLATFORM_LABEL.android },
              { value: "web", label: PLATFORM_LABEL.web },
            ]}
            onValueChange={(value) => store.editProfiles((profiles) => bindPlatform(profiles, edit.id, value === "none" ? null : value, Date.now()))}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect
            label="Density"
            value={s.density}
            options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]}
            onValueChange={(density) => updateSettings({ density })}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect
            label="Default filter"
            value={s.defaultFilter}
            options={[
              { value: "all", label: "All" },
              { value: "recent", label: "Recent (active lately, or new)" },
              { value: "active", label: "Active (running, new or asking)" },
              { value: "inbox", label: "Inbox (new or asking)" },
            ]}
            onValueChange={(defaultFilter) => updateSettings({ defaultFilter })}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect
            label="Recent means"
            hint="The Recent filter shows workspaces active within this time, plus anything running, new or asking."
            value={String(s.recentDays)}
            options={RECENT_DAYS.map((days) => ({ value: String(days), label: days === 1 ? "Last day" : `Last ${days} days` }))}
            onValueChange={(value) => updateSettings({ recentDays: Number(value) })}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect
            label="Order"
            hint={s.sort === "manual" ? "Drag a project or workspace: by its grip on desktop, by long-press on phones. Status shows through icons and badges." : "Asking, unread and running first, then most recent."}
            value={s.sort}
            options={[{ value: "auto", label: "Automatic" }, { value: "manual", label: "Manual (drag and drop)" }]}
            onValueChange={(sort) => updateSettings({ sort })}
            disabled={!snapshot.profilesReady}
          />
          <SettingsSelect
            label="Hide finished, read workspaces"
            value={s.hideDone}
            options={[{ value: "off", label: "Never" }, { value: "1d", label: "After 1 day" }, { value: "7d", label: "After 7 days" }]}
            onValueChange={(hideDone) => updateSettings({ hideDone })}
            disabled={!snapshot.profilesReady}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Workspace rows show">
        <SettingsCard>
          {yesNo(s.show.model, (model) => updateSettings({ show: { ...s.show, model } }), "Model", "Of the most recently active agent")}
          {yesNo(s.show.branch, (branch) => updateSettings({ show: { ...s.show, branch } }), "Branch")}
          {yesNo(s.show.diff, (diff) => updateSettings({ show: { ...s.show, diff } }), "Diff (+added −deleted)")}
          {yesNo(s.show.time, (time) => updateSettings({ show: { ...s.show, time } }), "Last activity")}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="New groups start">
        <SettingsCard>
          {yesNo(s.newGroupsExpanded.hosts, (hosts) => updateSettings({ newGroupsExpanded: { ...s.newGroupsExpanded, hosts } }), "Hosts expanded")}
          {yesNo(s.newGroupsExpanded.projects, (projects) => updateSettings({ newGroupsExpanded: { ...s.newGroupsExpanded, projects } }), "Projects expanded")}
          <SettingsAction
            label="Manual order"
            hint="Your drag-and-drop order of projects and workspaces in this profile."
            actionLabel="Reset"
            disabled={!Object.keys(edit.order).length}
            onPress={() => update((profile) => ({ ...profile, order: {} }))}
          />
          <SettingsAction
            label="Remembered collapse state"
            hint={snapshot.deviceStorage ? "Stored on this device." : "Stored in the profile."}
            actionLabel="Forget"
            onPress={() => {
              store.setCollapse(edit.id, {});
              update((profile) => ({ ...profile, collapse: {} }));
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Hosts shown">
        <SettingsCard>
          {snapshot.hosts.length === 0 ? <SettingsRow label="No hosts configured" /> : null}
          {snapshot.hosts.map((host) =>
            yesNo(
              !s.hiddenHosts.includes(host.serverId),
              (shown) => {
                const known = snapshot.hosts.map((entry) => entry.serverId);
                const hidden = new Set(s.hiddenHosts.filter((id) => known.includes(id)));
                if (shown) hidden.delete(host.serverId);
                else hidden.add(host.serverId);
                updateSettings({ hiddenHosts: [...hidden] });
              },
              host.label,
              host.status,
              host.serverId,
            ),
          )}
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
    </View>
  );
}
