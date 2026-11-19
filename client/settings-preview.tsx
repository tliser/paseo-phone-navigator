// Row preview under the line settings: a few workspace rows drawn exactly as the navigator draws them,
// from sample data (never a real host), so the lines and density show at once.
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { View } from "react-native";
import type { Profile } from "../shared/profiles";
import { buildTree } from "../shared/tree";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";
import { Row } from "./navigator-screen";

const MINUTE = 60_000;

/** Sample workspaces: one that asks you (with tabs), one running, one read. */
function sampleHosts(now: number): HostInput[] {
  const chat = (id: string, title: string, status: AgentInput["status"], minutes: number, extra: Partial<AgentInput> = {}): AgentInput => ({
    id, title, model: "anthropic/claude-sonnet-4-5", status, parentId: null, activityAt: now - minutes * MINUTE, unreadAt: status === "finished" ? now - minutes * MINUTE : 0, ...extra,
  });
  const ws = (id: string, title: string, status: WorkspaceInput["status"], minutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
    id, projectId: "web-app", projectName: "web-app", projectKind: "git", projectRootPath: "", title, status,
    needsYou: status === "needs_input", unreadAt: 0, branch: `feat/${id}`, additions: 42, deletions: 7,
    activityAt: now - minutes * MINUTE, orderAt: now - minutes * MINUTE, model: "anthropic/claude-sonnet-4-5", ...extra,
  });
  return [{
    serverId: "preview", label: "Sample host", status: "online", loading: false, error: null,
    workspaces: [
      ws("checkout", "Checkout redesign", "needs_input", 3, {
        agents: [chat("c1", "Payment states", "asking", 3), chat("c2", "Accessibility review", "finished", 8, { model: "openai/gpt-5.4" })],
        terminals: [{ id: "t1", title: "Terminal 1" }],
      }),
      ws("tokens", "Dark mode tokens", "running", 1, { agents: [chat("a1", "Build the palette", "running", 1)] }),
      ws("docs", "Update the docs", "done", 3 * 24 * 60, { branch: "main", additions: 0, deletions: 0 }),
    ],
  }];
}

export function SettingsPreview({ theme, profile, touch }: { theme: PluginTheme; profile: Profile; touch: boolean }) {
  const c = theme.colors;
  const settings = profile.settings;
  const now = Date.now();
  const rows = useMemo(() => {
    const tree = buildTree(sampleHosts(now), { filter: "all", query: "", settings: { ...settings, hiddenHosts: [] }, collapse: {}, reads: {}, now, pins: new Set() });
    return tree.rows.filter((row) => row.type === "workspace");
    // `now` changes every render; the preview only needs the profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const noop = () => undefined;
  return (
    <View accessibilityLabel="Preview" style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }} pointerEvents="none">
      {rows.map((row) => (
        <Row
          key={row.key}
          row={row}
          theme={theme}
          profile={profile}
          comfortable={settings.density === "comfortable"}
          touch={touch}
          searching={false}
          now={now}
          canOpen={false}
          onToggle={noop}
          onOpen={noop}
          onMenu={noop}
          onCreate={noop}
          arranging={false}
          lifted={null}
        />
      ))}
    </View>
  );
}
