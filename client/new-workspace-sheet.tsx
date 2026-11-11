// A draft for a new workspace, like Paseo's own "New workspace" screen: pick what to launch, then
// create. Nothing exists on the host until Create is tapped, so closing the sheet discards the draft.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { ProjectRow } from "../shared/tree";
import { useNavigatorStore } from "./runtime";
import type { ProviderChoice, ProviderToggle } from "./store";

/** Last choice per host for this app session, so the next draft starts where you left off. */
const lastChoice = new Map<
  string,
  { provider: string; model: string; modeId: string | null; launch: "agent" | "terminal"; isolation: "worktree" | "local"; toggles: Record<string, boolean> }
>();

export function NewWorkspaceSheet({ theme, project, onClose, onCreated }: { theme: PluginTheme; project: ProjectRow; onClose(): void; onCreated(workspaceId: string): void }) {
  const { store } = useNavigatorStore();
  const c = theme.colors;
  const remembered = lastChoice.get(project.serverId);
  const isGit = project.kind === "git";

  const [providers, setProviders] = useState<ProviderChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [launch, setLaunch] = useState<"agent" | "terminal">(remembered?.launch ?? "agent");
  const [isolation, setIsolation] = useState<"worktree" | "local">(isGit ? (remembered?.isolation ?? "worktree") : "local");
  const [providerId, setProviderId] = useState<string | null>(remembered?.provider ?? null);
  const [modelId, setModelId] = useState<string | null>(remembered?.model ?? null);
  const [modeId, setModeId] = useState<string | null>(remembered?.modeId ?? null);
  const [prompt, setPrompt] = useState("");
  const [branch, setBranch] = useState("");
  const [picker, setPicker] = useState<"provider" | "model" | "mode" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    store
      .providers(project.serverId, project.rootPath)
      .then((list) => live && setProviders(list))
      .catch((reason: unknown) => live && setLoadError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      live = false;
    };
  }, [store, project.serverId, project.rootPath]);

  // Keep the selection valid once providers are known: fall back to the first provider and its default model.
  const provider = useMemo(() => providers?.find((entry) => entry.id === providerId) ?? providers?.[0] ?? null, [providers, providerId]);
  const model = provider?.models.find((entry) => entry.id === modelId) ?? provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0] ?? null;
  const mode = provider?.modes.find((entry) => entry.id === modeId) ?? provider?.modes.find((entry) => entry.id === provider.defaultModeId) ?? null;

  // On/off options such as Auto Accept depend on the provider, model and mode, so ask again when they change.
  const [toggles, setToggles] = useState<ProviderToggle[]>([]);
  const [toggleValues, setToggleValues] = useState<Record<string, boolean>>(() => remembered?.toggles ?? {});
  useEffect(() => {
    setToggles([]);
    if (launch !== "agent" || !provider || !model) return;
    let live = true;
    store
      .providerToggles(project.serverId, { provider: provider.id, model: model.id, modeId: mode?.id, cwd: project.rootPath })
      .then((list) => live && setToggles(list))
      .catch(() => live && setToggles([]));
    return () => {
      live = false;
    };
  }, [store, project.serverId, project.rootPath, launch, provider, model, mode]);
  const featureValues = Object.fromEntries(toggles.map((toggle) => [toggle.id, toggleValues[toggle.id] ?? toggle.value]));

  const canCreate = !busy && (launch === "terminal" || (!!provider && !!model));
  const create = () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    store
      .launchWorkspace(project.serverId, {
        projectId: project.projectId,
        kind: project.kind,
        rootPath: project.rootPath,
        isolation,
        branchName: isolation === "worktree" ? branch : undefined,
        launch: launch === "agent" && provider && model ? { kind: "agent", provider: provider.id, model: model.id, modeId: mode?.id, prompt, featureValues } : { kind: "terminal" },
      })
      .then((workspaceId) => {
        if (provider && model) lastChoice.set(project.serverId, { provider: provider.id, model: model.id, modeId: mode?.id ?? null, launch, isolation, toggles: { ...toggleValues, ...featureValues } });
        onCreated(workspaceId);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  const label = { color: c.foregroundMuted, fontSize: 12, marginBottom: 6 };
  const field = { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, paddingHorizontal: 12, flexDirection: "row" as const, alignItems: "center" as const, gap: 8 };

  const segmented = <T extends string>(value: T, options: { id: T; label: string; icon: string }[], onChange: (next: T) => void) => (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.id)}
            style={{ flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: active ? c.foreground : c.border, backgroundColor: active ? c.surface2 : c.surface1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Icon name={option.icon} size={15} color={c.foreground} />
            <Text style={{ color: c.foreground, fontSize: 14 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const select = (kind: "provider" | "model" | "mode", text: string) => (
    <Pressable accessibilityRole="button" onPress={() => setPicker(picker === kind ? null : kind)} style={field}>
      <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 15 }}>{text}</Text>
      <Icon name={picker === kind ? "ChevronUp" : "ChevronDown"} size={16} color={c.foregroundMuted} />
    </Pressable>
  );

  const options = (items: { id: string; label: string }[], selected: string | undefined, choose: (id: string) => void) => (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: item.id === selected }}
          onPress={() => {
            choose(item.id);
            setPicker(null);
          }}
          style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: item.id === selected ? c.surface2 : c.surface0, borderBottomWidth: 1, borderBottomColor: c.border }}
        >
          <View style={{ width: 18 }}>{item.id === selected ? <Icon name="Check" size={16} color={c.accent} /> : null}</View>
          <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 15 }}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Modal title={`New workspace · ${project.name}`} open onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Content>
        {isGit ? (
          <View>
            <Text style={label}>Where</Text>
            {segmented(isolation, [{ id: "worktree", label: "New worktree", icon: "GitBranch" }, { id: "local", label: "Project folder", icon: "Folder" }], setIsolation)}
            {isolation === "worktree" ? (
              <View style={{ ...field, marginTop: 8 }}>
                <TextInput
                  value={branch}
                  onChangeText={setBranch}
                  placeholder="Branch name (optional, generated if empty)"
                  placeholderTextColor={c.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 10 }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        <View>
          <Text style={label}>Launch</Text>
          {segmented(launch, [{ id: "agent", label: "Agent", icon: "Bot" }, { id: "terminal", label: "Terminal", icon: "SquareTerminal" }], setLaunch)}
        </View>

        {launch === "agent" ? (
          providers === null ? (
            <Text style={{ color: loadError ? c.statusDanger : c.foregroundMuted }}>{loadError ? `Could not load agents: ${loadError}` : "Loading agents…"}</Text>
          ) : providers.length === 0 ? (
            <Text style={{ color: c.foregroundMuted }}>No agent provider is ready on this host.</Text>
          ) : (
            <>
              <View>
                <Text style={label}>Agent</Text>
                {select("provider", provider?.label ?? "Choose an agent")}
                {picker === "provider" ? (
                  <View style={{ marginTop: 6 }}>
                    {options(providers, provider?.id, (id) => {
                      setProviderId(id);
                      setModelId(null);
                      setModeId(null);
                    })}
                  </View>
                ) : null}
              </View>
              <View>
                <Text style={label}>Model</Text>
                {select("model", model?.label ?? "Choose a model")}
                {picker === "model" && provider ? <View style={{ marginTop: 6 }}>{options(provider.models, model?.id, setModelId)}</View> : null}
              </View>
              {provider && provider.modes.length > 1 ? (
                <View>
                  <Text style={label}>Mode</Text>
                  {select("mode", mode?.label ?? "Default")}
                  {picker === "mode" ? <View style={{ marginTop: 6 }}>{options(provider.modes, mode?.id, setModeId)}</View> : null}
                </View>
              ) : null}
              {toggles.map((toggle) => (
                <View key={toggle.id} style={{ ...field, justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingVertical: 8 }}>
                    <Text style={{ color: c.foreground, fontSize: 15 }}>{toggle.label}</Text>
                    {toggle.description ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{toggle.description}</Text> : null}
                  </View>
                  <Switch
                    accessibilityLabel={toggle.label}
                    value={featureValues[toggle.id] ?? false}
                    onValueChange={(value) => setToggleValues((current) => ({ ...current, [toggle.id]: value }))}
                  />
                </View>
              ))}
              <View>
                <Text style={label}>First message (optional)</Text>
                <View style={{ ...field, alignItems: "flex-start" }}>
                  <TextInput
                    value={prompt}
                    onChangeText={setPrompt}
                    placeholder="What should the agent do?"
                    placeholderTextColor={c.foregroundMuted}
                    multiline
                    style={{ flex: 1, minHeight: 72, color: c.foreground, fontSize: 15, paddingVertical: 10, textAlignVertical: "top" }}
                  />
                </View>
              </View>
            </>
          )
        ) : null}

        {error ? <Text style={{ color: c.statusDanger }}>{`Could not create the workspace: ${error}`}</Text> : null}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{ flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2, opacity: busy ? 0.5 : 1 }}>
            <Text style={{ color: c.foreground, fontWeight: "500" }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCreate, busy }}
            disabled={!canCreate}
            onPress={create}
            style={{ flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.accent, opacity: canCreate ? 1 : 0.5 }}
          >
            <Text style={{ color: c.accentForeground, fontWeight: "600" }}>{busy ? "Creating…" : "Create"}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
