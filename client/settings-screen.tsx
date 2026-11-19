// Settings of one profile, in sections: View · Rows · Order · Groups · Profile · Updates. Desktop: controls
// on the left, the live preview on the right. Phones: section tabs and controls scroll, the preview sits
// at the bottom and can be made larger.
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { bindPlatform, defaultSettings, newProfileId, pruneCollapse, type Profile, type ProfileSettings, type RowField } from "../shared/profiles";
import type { Platform } from "../shared/types";
import { PLATFORM_LABEL } from "./options-menu";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { SettingsPreview } from "./settings-preview";
import { VIEW_LABEL } from "./title-bar";
import { Toast, useToastState } from "./toast";
import { UpdatesSection } from "./updates-section";

type PlatformChoice = Platform | "none";
type Section = "view" | "rows" | "order" | "groups" | "profile" | "updates";

const SECTIONS: readonly [Section, string][] = [
  ["view", "View"],
  ["rows", "Rows"],
  ["order", "Order"],
  ["groups", "Groups"],
  ["profile", "Profile"],
  ["updates", "Updates"],
];
const RECENT_DAYS = [1, 2, 3, 7, 14, 30];
const FIELD_LABEL: Record<RowField, string> = { branch: "Branch", model: "Model", diff: "Changes" };
const FIELD_SAMPLE: Record<RowField, string> = { branch: "feature/checkout", model: "sonnet-4-5", diff: "+142 −38" };

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const { store, snapshot } = useNavigatorStore();
  const active = useActiveProfile(snapshot, layout.platform, layout.compact);
  const [editId, setEditId] = useState(active.id);
  const edit = snapshot.profiles.find((profile) => profile.id === editId) ?? active;
  const [name, setName] = useState(edit.name);
  useEffect(() => setName(edit.name), [edit.id, edit.name]);
  const [section, setSection] = useState<Section>("view");
  const [largePreview, setLargePreview] = useState(false);
  const { toast, show: showToast, hide: hideToast } = useToastState();
  const window = useWindowDimensions();
  const c = theme.colors;
  const ready = snapshot.profilesReady;

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
    const gone = edit;
    const wasActive = active.id === gone.id;
    store.editProfiles((profiles) => (profiles.length < 2 ? profiles : profiles.filter((profile) => profile.id !== gone.id)));
    const next = snapshot.profiles.find((profile) => profile.id !== gone.id);
    if (next) {
      setEditId(next.id);
      if (wasActive) store.selectProfile(next.id);
    }
    showToast({
      text: `Deleted "${gone.name}"`,
      undo: () => {
        store.editProfiles((profiles) => [...profiles, { ...gone, updatedAt: Date.now() }]);
        setEditId(gone.id);
        if (wasActive) store.selectProfile(gone.id);
      },
    });
  };

  const resetOrder = () => {
    const was = edit.order;
    update((profile) => ({ ...profile, order: {} }));
    showToast({ text: `Manual order of "${edit.name}" reset`, undo: () => update((profile) => ({ ...profile, order: was })) });
  };

  const s = edit.settings;
  const yesNo = (value: boolean, set: (value: boolean) => void, label: string, hint?: string, key?: string, disabled = false) => (
    <SettingsSwitch key={key ?? label} label={label} hint={hint} value={value} onValueChange={set} disabled={!ready || disabled} />
  );
  const moveField = (field: RowField, direction: -1 | 1) => {
    const order = [...s.fieldOrder];
    const from = order.indexOf(field);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, field);
    updateSettings({ fieldOrder: order });
  };

  const sections: Record<Section, ReactNode> = {
    view: (
      <SettingsCard>
        <SettingsSelect label="Density" value={s.density} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} onValueChange={(density) => updateSettings({ density })} disabled={!ready} />
        <SettingsSelect
          label="Opens on"
          value={s.defaultFilter}
          options={(["all", "recent", "active", "pinned"] as const).map((value) => ({ value, label: VIEW_LABEL[value] }))}
          onValueChange={(defaultFilter) => updateSettings({ defaultFilter })}
          disabled={!ready}
        />
        <SettingsSelect
          label="Recent means"
          hint="Plus anything running, unread or asking you."
          value={String(s.recentDays)}
          options={RECENT_DAYS.map((days) => ({ value: String(days), label: days === 1 ? "Last day" : `Last ${days} days` }))}
          onValueChange={(value) => updateSettings({ recentDays: Number(value) })}
          disabled={!ready}
        />
      </SettingsCard>
    ),
    rows: (
      <>
        <SettingsCard>
          <SettingsRow label="Second line, in this order" hint="Each value shows only when it is switched on." />
          {s.fieldOrder.map((field, index) => (
            <FieldRow
              key={field}
              theme={theme}
              field={field}
              shown={s.show[field]}
              first={index === 0}
              last={index === s.fieldOrder.length - 1}
              disabled={!ready}
              onToggle={(on) => updateSettings({ show: { ...s.show, [field]: on } })}
              onMove={(direction) => moveField(field, direction)}
            />
          ))}
        </SettingsCard>
        <SettingsCard>
          {yesNo(s.show.time, (time) => updateSettings({ show: { ...s.show, time } }), "Last activity")}
          {yesNo(s.show.tabs, (tabs) => updateSettings({ show: { ...s.show, tabs } }), "Tabs", "Status marks of a workspace's chats and terminals; tap them to list the tabs.")}
          {yesNo(s.show.subagents, (subagents) => updateSettings({ show: { ...s.show, subagents } }), "Sub-agents", s.show.tabs ? "Under their parent tab." : "Needs Tabs.", undefined, !s.show.tabs)}
          {yesNo(s.statusLine, (statusLine) => updateSettings({ statusLine }), "Say why a row needs you", "Rows that ask you, failed or are unread show the reason instead of branch and model.")}
          {layout.compact ? null : yesNo(s.namesCard, (namesCard) => updateSettings({ namesCard }), "Info card on hover", "Full details of workspaces, tabs and projects.")}
        </SettingsCard>
      </>
    ),
    order: (
      <SettingsCard>
        <SettingsSelect
          label="Order"
          hint={s.sort === "manual" ? (layout.compact ? "Options → Arrange order… shows the grips." : "Drag a project or workspace by its grip.") : "Newest prompt or workspace first. Agent output never moves rows."}
          value={s.sort}
          options={[{ value: "auto", label: "Automatic" }, { value: "manual", label: "Manual" }]}
          onValueChange={(sort) => updateSettings({ sort })}
          disabled={!ready}
        />
        <SettingsSelect label="Hide finished, read workspaces" value={s.hideDone} options={[{ value: "off", label: "Never" }, { value: "1d", label: "After 1 day" }, { value: "7d", label: "After 7 days" }]} onValueChange={(hideDone) => updateSettings({ hideDone })} disabled={!ready} />
        <SettingsAction label="Manual order" hint="Your drag-and-drop order in this profile." actionLabel="Reset" disabled={!Object.keys(edit.order).length || !ready} onPress={resetOrder} />
      </SettingsCard>
    ),
    groups: (
      <>
        <SettingsCard>
          {yesNo(s.newGroupsExpanded.hosts, (hosts) => updateSettings({ newGroupsExpanded: { ...s.newGroupsExpanded, hosts } }), "New hosts start open")}
          {yesNo(s.newGroupsExpanded.projects, (projects) => updateSettings({ newGroupsExpanded: { ...s.newGroupsExpanded, projects } }), "New projects start open")}
          <SettingsAction
            label="Remembered folding"
            hint={snapshot.deviceStorage ? "Stored on this device." : "Stored in the profile."}
            actionLabel="Forget"
            onPress={() => {
              store.setCollapse(edit.id, {});
              update((profile) => ({ ...profile, collapse: {} }));
            }}
          />
        </SettingsCard>
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
              `Show ${host.label}`,
              `${host.status}. The Inbox covers every host either way.`,
              host.serverId,
            ),
          )}
        </SettingsCard>
      </>
    ),
    profile: (
      <>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {snapshot.profiles.map((profile) => (
            <Chip key={profile.id} theme={theme} label={`${profile.name}${profile.id === active.id ? " · this device" : ""}`} selected={profile.id === edit.id} onPress={() => setEditId(profile.id)} />
          ))}
          <Chip theme={theme} label="+ New profile" selected={false} disabled={!ready} onPress={() => addProfile(null)} />
        </View>
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
            disabled={!ready}
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
            disabled={!ready}
          />
          <SettingsAction label="Use on this device" actionLabel={edit.id === active.id ? "In use" : "Use"} disabled={edit.id === active.id} onPress={() => store.selectProfile(edit.id)} />
          <SettingsAction label="Duplicate this profile" actionLabel="Duplicate" disabled={!ready} onPress={() => addProfile(edit)} />
          <SettingsAction label="Delete this profile" hint={snapshot.profiles.length < 2 ? "The last profile cannot be deleted." : undefined} actionLabel="Delete" disabled={snapshot.profiles.length < 2 || !ready} onPress={remove} />
        </SettingsCard>
        {snapshot.savingError ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{snapshot.savingError}</Text> : null}
      </>
    ),
    updates: <UpdatesSection />,
  };

  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="tablist">
      {SECTIONS.map(([id, label]) => (
        <Chip key={id} theme={theme} label={label} selected={section === id} role="tab" onPress={() => setSection(id)} />
      ))}
    </ScrollView>
  );
  const editing = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 13 }} numberOfLines={1}>{`Editing ${edit.name}${edit.id === active.id ? " · this device" : ""}`}</Text>
      {section === "profile" ? null : (
        <Pressable accessibilityRole="button" onPress={() => setSection("profile")} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>Change</Text>
        </Pressable>
      )}
    </View>
  );
  const body = section === "updates" ? sections.updates : <SettingsSection title={SECTIONS.find(([id]) => id === section)![1]}>{sections[section]}</SettingsSection>;

  if (layout.compact) {
    const previewHeight = largePreview ? Math.round(window.height * 0.55) : 150;
    return (
      <View style={{ flex: 1, backgroundColor: c.surface0 }}>
        <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 4 }}>
          {editing}
          {tabs}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}>
          {body}
        </ScrollView>
        <View style={{ height: previewHeight, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 12 }}>
            <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>Preview</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={largePreview ? "Smaller preview" : "Larger preview"} onPress={() => setLargePreview((value) => !value)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
              <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>{largePreview ? "Smaller" : "Larger"}</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}>
            <SettingsPreview theme={theme} profile={edit} maxRows={14} />
          </ScrollView>
        </View>
        <Toast theme={theme} toast={toast} onHide={hideToast} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.surface0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 16, maxWidth: 640 }}>
        {editing}
        {tabs}
        {body}
      </ScrollView>
      <View style={{ width: 380, padding: 24, paddingLeft: 0, gap: 8 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>Preview · sample workspaces</Text>
        <SettingsPreview theme={theme} profile={edit} maxRows={14} />
      </View>
      <Toast theme={theme} toast={toast} onHide={hideToast} />
    </View>
  );
}

function Chip({ theme, label, selected, onPress, disabled, role = "button" }: { theme: PluginTheme; label: string; selected: boolean; onPress(): void; disabled?: boolean; role?: "button" | "tab" }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: selected ? c.foreground : c.border, backgroundColor: selected ? c.surface2 : "transparent", opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

/** One value of the second line: show switch, a sample, and Move up/down. */
function FieldRow({
  theme,
  field,
  shown,
  first,
  last,
  disabled,
  onToggle,
  onMove,
}: {
  theme: PluginTheme;
  field: RowField;
  shown: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onToggle(on: boolean): void;
  onMove(direction: -1 | 1): void;
}) {
  const c = theme.colors;
  const arrow = (direction: -1 | 1, off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Move ${FIELD_LABEL[field]} ${direction < 0 ? "up" : "down"}`}
      accessibilityState={{ disabled: off || disabled }}
      disabled={off || disabled}
      onPress={() => onMove(direction)}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: off ? 0.3 : 1 }}
    >
      <Icon name={direction < 0 ? "ArrowUp" : "ArrowDown"} size={16} color={c.foreground} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 12 }}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: shown, disabled }}
        accessibilityLabel={`Show ${FIELD_LABEL[field]}`}
        disabled={disabled}
        onPress={() => onToggle(!shown)}
        style={{ minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <Icon name={shown ? "SquareCheck" : "Square"} size={18} color={shown ? c.accent : c.foregroundMuted} />
        <Text style={{ color: c.foreground, fontSize: 14 }}>{FIELD_LABEL[field]}</Text>
        <Text numberOfLines={1} style={{ flex: 1, color: c.foregroundMuted, fontSize: 12 }}>{FIELD_SAMPLE[field]}</Text>
      </Pressable>
      {arrow(-1, first)}
      {arrow(1, last)}
    </View>
  );
}
