// Settings of one profile, in sections: View · Rows · Inbox · Order · Groups · Profile, plus this plugin's
// Updates. Section tabs and a preview of sample rows (or Inbox entries) stay at the top; only the settings
// below them scroll.
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView, SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { bindPlatform, defaultSettings, INBOX_LINES, newProfileId, pruneCollapse, ROW_LINES, type Profile, type ProfileSettings, type ProfilesDocument } from "../shared/profiles";
import { INBOX_FIELD_LABEL, LineEditor, ROW_FIELD_LABEL } from "./line-editor";
import { InboxPreview } from "./inbox-preview";
import { SectionPicker } from "./popup-sections";
import { PickerSheet } from "./picker-sheet";
import type { ProviderListState, Store } from "./store";
import { ICON_COLORS } from "../shared/colors";
import type { Platform } from "../shared/types";
import { PLATFORM_LABEL } from "./options-menu";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { SettingsPreview } from "./settings-preview";
import { VIEW_LABEL } from "./title-bar";
import { Toast, useToastState } from "./toast";
import { ownScreenOpen } from "./chat-nav";
import { UpdatesSection } from "./updates-section";

type PlatformChoice = Platform | "none";
type Section = "view" | "rows" | "inbox" | "order" | "groups" | "profile" | "updates";

const SECTIONS: readonly [Section, string][] = [
  ["view", "View"],
  ["rows", "Rows"],
  ["inbox", "Inbox"],
  ["order", "Order"],
  ["groups", "Groups"],
  ["profile", "Profile"],
  ["updates", "Updates"],
];
const RECENT_DAYS = [1, 2, 3, 7, 14, 30];

export function SettingsScreen({ theme, layout, host, params }: PluginScreenProps) {
  // A full screen over a chat on phones: typing in its fields is not typing in that chat.
  useEffect(() => ownScreenOpen(), []);
  const { store, snapshot } = useNavigatorStore();
  const active = useActiveProfile(snapshot, layout.platform, layout.compact);
  const [editId, setEditId] = useState(active.id);
  const edit = snapshot.profiles.find((profile) => profile.id === editId) ?? active;
  const [name, setName] = useState(edit.name);
  useEffect(() => setName(edit.name), [edit.id, edit.name]);
  const [section, setSection] = useState<Section>(() => SECTIONS.find(([id]) => id === params.section)?.[0] ?? "view");
  /** How far the preview was dragged taller than its starting size. */
  const [grown, setGrown] = useState(0);
  const { toast, show: showToast, hide: hideToast } = useToastState();
  const c = theme.colors;
  const pad = layout.compact ? 12 : 24;
  /** The screen's height, so the preview takes a share of it. */
  const [areaHeight, setAreaHeight] = useState(0);
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
  const sections: Record<Section, ReactNode> = {
    view: (
      <>
      <SettingsCard>
        <SettingsSelect label="Density" value={s.density} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} onValueChange={(density) => updateSettings({ density })} disabled={!ready} />
        <SettingsSelect
          label="Choose the host with"
          hint="Shown with more than one host. All lists every host under a thin divider."
          value={s.hostSwitch}
          options={[{ value: "tabs", label: "Tabs above the list" }, { value: "menu", label: "Button in the title bar" }]}
          onValueChange={(hostSwitch) => updateSettings({ hostSwitch })}
          disabled={!ready}
        />
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
      <SettingsCard>
        <SettingsSelect
          label="Open workspace"
          hint="How the sidebar marks the workspace open beside it (desktop; phones show none)."
          value={s.openMarker.style}
          options={[{ value: "bar", label: "Bar on the left" }, { value: "tint", label: "Tinted row" }, { value: "outline", label: "Outline" }, { value: "none", label: "None" }]}
          onValueChange={(style) => updateSettings({ openMarker: { ...s.openMarker, style } })}
          disabled={!ready}
        />
        {s.openMarker.style === "none" ? null : (
          <View accessibilityRole="radiogroup" accessibilityLabel="Colour of the open workspace" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12 }}>
            {ICON_COLORS.map((color) => {
              const selected = s.openMarker.color === color.id;
              return (
                <Pressable
                  key={color.id}
                  accessibilityRole="radio"
                  accessibilityLabel={color.id === "default" ? "Theme accent" : color.label}
                  accessibilityState={{ selected, checked: selected, disabled: !ready }}
                  disabled={!ready}
                  onPress={() => updateSettings({ openMarker: { ...s.openMarker, color: color.id } })}
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: selected ? c.foreground : "transparent" }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color.hex ?? c.accent }} />
                </Pressable>
              );
            })}
          </View>
        )}
      </SettingsCard>
      </>
    ),
    rows: (
      <>
        <SettingsCard>
          <View style={{ padding: 12 }}>
            <LineEditor theme={theme} kind={ROW_LINES} labels={ROW_FIELD_LABEL} lines={s.lines} disabled={!ready} onChange={(lines) => updateSettings({ lines })} />
          </View>
        </SettingsCard>
        <SettingsCard>
          {yesNo(s.show.tabs, (tabs) => updateSettings({ show: { ...s.show, tabs } }), "Tabs", "Status marks of a workspace's chats and terminals; tap them to list the tabs.")}
          {yesNo(s.show.subagents, (subagents) => updateSettings({ show: { ...s.show, subagents } }), "Sub-agents", s.show.tabs ? "Under their parent tab." : "Needs Tabs.", undefined, !s.show.tabs)}
          {layout.compact ? null : yesNo(s.namesCard, (namesCard) => updateSettings({ namesCard }), "Info card on hover", "Full details of workspaces, tabs and projects.")}
        </SettingsCard>
      </>
    ),
    inbox: (
      <>
        <SettingsCard>
          <View style={{ padding: 12 }}>
            <LineEditor theme={theme} kind={INBOX_LINES} labels={INBOX_FIELD_LABEL} lines={s.inboxLines} disabled={!ready} onChange={(inboxLines) => updateSettings({ inboxLines })} />
          </View>
        </SettingsCard>
        <SettingsCard>
          <View style={{ paddingHorizontal: 12, paddingTop: 12, gap: 2 }}>
            <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>Inbox button under the message field</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>What its popup lists, in this order; three chats each, then "Show all".</Text>
          </View>
          <SectionPicker theme={theme} sections={s.popupSections} disabled={!ready} onChange={(popupSections) => updateSettings({ popupSections })} />
        </SettingsCard>
        <CatchUpSettings theme={theme} compact={layout.compact} store={store} hosts={snapshot.hosts} selfId={host.id} catchUp={snapshot.catchUp} disabled={!ready} />
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
    // Not per profile: the installed version and the auto-update switch apply to every host.
    updates: <UpdatesSection />,
  };

  // Underlined text tabs: one slim line instead of a row of buttons.
  const tabs = (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={{ paddingHorizontal: pad - 10 }}>
        {SECTIONS.map(([id, label]) => {
          const selected = section === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setSection(id)}
              hitSlop={{ top: 6, bottom: 6 }}
              style={{ height: 38, justifyContent: "center", paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: selected ? c.accent : "transparent", marginBottom: -1 }}
            >
              <Text style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 14, fontWeight: selected ? "700" : "500" }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
  // Updates brings its own section (title and explanation).
  const body = section === "updates" ? sections.updates : <SettingsSection title={SECTIONS.find(([id]) => id === section)![1]}>{sections[section]}</SettingsSection>;

  const touch = layout.platform !== "web";
  const link = { hitSlop: { top: 10, bottom: 10, left: 6, right: 6 }, style: { paddingHorizontal: 6, justifyContent: "center" as const } };
  // Starts at about a third of the screen; drag its bottom edge down to grow it, up to 60 % of the screen.
  const minPreview = !areaHeight ? 200 : Math.min(layout.compact ? 200 : 260, Math.round(areaHeight * 0.3));
  const maxPreview = Math.max(minPreview, Math.round(areaHeight * 0.6));
  const previewHeight = Math.min(maxPreview, minPreview + grown);
  const limits = useRef({ grown, room: maxPreview - minPreview });
  limits.current.room = maxPreview - minPreview;
  const resize = useMemo(() => {
    let start = 0;
    const clamp = (value: number) => Math.max(0, Math.min(limits.current.room, value));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start = clamp(limits.current.grown);
      },
      onPanResponderMove: (_event, gesture) => {
        limits.current.grown = clamp(start + gesture.dy);
        setGrown(limits.current.grown);
      },
    });
  }, []);
  const step = (by: number) => {
    limits.current.grown = Math.max(0, Math.min(limits.current.room, Math.min(limits.current.grown, limits.current.room) + by));
    setGrown(limits.current.grown);
  };
  // Its own full screen (not Paseo's settings page), so the tabs and the preview stay on top and only the
  // settings below them scroll.
  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
      {tabs}
      {/* Profile and Updates do not change what the navigator shows, so they have no preview. */}
      {section === "profile" || section === "updates" ? null : (
        <View style={{ paddingHorizontal: pad, paddingTop: 10, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View style={{ height: previewHeight, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, overflow: "hidden" }}>
            <View style={{ height: 34, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text numberOfLines={1} style={{ flex: 1, color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{`Preview · ${edit.name}${edit.id === active.id ? " (this device)" : ""}`}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Change the profile being edited, now ${edit.name}`} onPress={() => setSection("profile")} {...link}>
                <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>Change</Text>
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
              {section === "inbox" ? (
                <InboxPreview theme={theme} lines={s.inboxLines} sections={s.popupSections} host={snapshot.hosts.find((entry) => entry.serverId === host.id)?.label || "tardis"} compact={layout.compact} />
              ) : (
                <SettingsPreview theme={theme} profile={edit} touch={touch} hosts={snapshot.hosts} colors={snapshot.colors} />
              )}
            </ScrollView>
            {/* Drag handle: pull down to make the preview taller, push up to shrink it back. */}
            <View
              {...resize.panHandlers}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Preview size"
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 60 : -60)}
              style={{ height: 26, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface1, cursor: "ns-resize", userSelect: "none", touchAction: "none" } as never}
            >
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.foregroundMuted, opacity: 0.6 }} />
            </View>
          </View>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: pad, paddingTop: 14, paddingBottom: 40, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      <Toast theme={theme} toast={toast} onHide={hideToast} />
    </View>
  );
}

/**
 * Which model writes catch-ups on each host (hosts offer different models), one tab per host, for every
 * profile and device; and whether catch-ups rename chats. A catch-up runs on its chat's host with that host's
 * model. Provider first, then one of its models, each from a searchable list.
 */
function CatchUpSettings({ theme, compact, store, hosts, selfId, catchUp, disabled }: { theme: PluginTheme; compact: boolean; store: Store; hosts: readonly { serverId: string; label: string; status: string }[]; selfId: string; catchUp: ProfilesDocument["catchUp"]; disabled: boolean }) {
  const c = theme.colors;
  const [tab, setTab] = useState(selfId);
  const host = hosts.find((entry) => entry.serverId === tab) ?? hosts.find((entry) => entry.serverId === selfId) ?? hosts[0];
  const online = host?.status === "online";
  const [providers, setProviders] = useState<ProviderListState | null>(null);
  useEffect(() => {
    setProviders(null);
    if (!host || !online) return;
    return store.watchProviders(host.serverId, "~", setProviders);
  }, [store, host?.serverId, online]);
  const [picking, setPicking] = useState<"provider" | "model" | null>(null);

  // Stored as Paseo's `provider/model`; provider ids have no slash, model ids may.
  const chosen = host ? (catchUp.models[host.serverId]?.model ?? null) : null;
  const cut = chosen?.indexOf("/") ?? -1;
  const providerId = chosen && cut > 0 ? chosen.slice(0, cut) : null;
  const modelId = chosen && cut > 0 ? chosen.slice(cut + 1) : null;
  const ready = providers?.ready ?? [];
  const provider = ready.find((entry) => entry.id === providerId) ?? null;
  const model = provider?.models.find((entry) => entry.id === modelId) ?? null;
  const loading = online && (!providers || (!ready.length && providers.loading.length > 0));
  const pickProvider = (id: string) => {
    if (!host || id === providerId) return;
    const next = ready.find((entry) => entry.id === id);
    const first = next?.models.find((entry) => entry.isDefault) ?? next?.models[0];
    if (first) store.setCatchUpModel(host.serverId, `${id}/${first.id}`);
  };

  return (
    <>
    <SettingsCard>
      {hosts.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={{ gap: 6, padding: 12, paddingBottom: 4 }}>
          {hosts.map((entry) => (
            <Chip key={entry.serverId} theme={theme} label={entry.label} selected={entry.serverId === host?.serverId} onPress={() => setTab(entry.serverId)} />
          ))}
        </ScrollView>
      ) : null}
      {!online ? <Text style={{ color: c.foregroundMuted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 }}>{`${host?.label ?? "This host"} is offline; its models show when it is back.`}</Text> : null}
      <SettingsAction
        label="Catch-up provider"
        hint={providers?.error ? `Could not list providers: ${providers.error}` : (provider?.label ?? providerId ?? "Not chosen yet.")}
        actionLabel={providerId ? "Change" : "Choose"}
        disabled={disabled || !online}
        onPress={() => setPicking("provider")}
      />
      <SettingsAction
        label="Catch-up model"
        hint={model?.label ?? modelId ?? (providerId ? "Not chosen yet." : "Choose a provider first.") + " A small, fast model is enough."}
        actionLabel={modelId ? "Change" : "Choose"}
        disabled={disabled || !online || !providerId}
        onPress={() => setPicking("model")}
      />
      {picking && host ? (
        <PickerSheet
          theme={theme}
          compact={compact}
          title={`${picking === "provider" ? "Provider" : (provider?.label ?? "Model")}${hosts.length > 1 ? ` on ${host.label}` : ""}`}
          items={picking === "provider" ? ready.map((entry) => ({ value: entry.id, label: entry.label })) : (provider?.models ?? []).map((entry) => ({ value: entry.id, label: entry.label, detail: entry.id }))}
          selected={picking === "provider" ? providerId : modelId}
          loading={loading}
          error={providers?.error ?? null}
          onPick={(value) => (picking === "provider" ? pickProvider(value) : providerId && store.setCatchUpModel(host.serverId, `${providerId}/${value}`))}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </SettingsCard>
    <SettingsCard>
      <SettingsSwitch
        label="Name chats from the catch-up"
        hint="Replaces the start of your first prompt with a short topic, on every host. Names you gave a chat yourself stay."
        value={catchUp.rename}
        onValueChange={(rename) => store.setCatchUpRename(rename)}
        disabled={disabled}
      />
    </SettingsCard>
    </>
  );
}

function Chip({ theme, label, selected, onPress, disabled }: { theme: PluginTheme; label: string; selected: boolean; onPress(): void; disabled?: boolean }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: selected ? c.foreground : c.border, backgroundColor: selected ? c.surface2 : "transparent", opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}
