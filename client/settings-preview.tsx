// Preview for the settings screen: a few rows drawn exactly as the navigator draws them, from sample
// data (never a real host), built with the profile being edited, so density, shown fields, filter and
// order show at once.
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Profile } from "../shared/profiles";
import { buildTree, type TreeRow } from "../shared/tree";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";
import { Row } from "./navigator-screen";

const MINUTE = 60_000;

/** Sample workspaces covering every row state: a chat that asks you, an unread chat, a sub-agent, a terminal, read and old. */
function sampleHosts(now: number): HostInput[] {
  const chat = (id: string, title: string, status: AgentInput["status"], minutes: number, extra: Partial<AgentInput> = {}): AgentInput => ({
    id, title, model: "anthropic/claude-sonnet-4-5", status, parentId: null, activityAt: now - minutes * MINUTE, unreadAt: status === "finished" ? now - minutes * MINUTE : 0, ...extra,
  });
  const ws = (id: string, project: string, title: string, status: WorkspaceInput["status"], minutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
    id, projectId: project, projectName: project, projectKind: "git", projectRootPath: "", title, status,
    needsYou: status === "needs_input", unreadAt: 0, branch: `feat/${id}`, additions: 42, deletions: 7,
    activityAt: now - minutes * MINUTE, model: "anthropic/claude-sonnet-4-5", ...extra,
  });
  return [{
    serverId: "preview", label: "Sample host", status: "online", loading: false, error: null,
    workspaces: [
      ws("checkout", "web-app", "Checkout redesign", "needs_input", 3, {
        agents: [chat("c1", "Payment states", "asking", 3), chat("c2", "Accessibility review", "finished", 8, { model: "openai/gpt-5.4" })],
        terminals: [{ id: "t1", title: "Terminal 1" }],
      }),
      ws("tokens", "web-app", "Dark mode tokens", "running", 1, {
        agents: [chat("a1", "Build the palette", "running", 1), chat("a2", "Check contrast", "idle", 5, { model: "openai/gpt-5.4", parentId: "a1" })],
      }),
      ws("login", "web-app", "Fix flaky login test", "attention", 12, { agents: [chat("l1", "Fix flaky login test", "finished", 12)] }),
      ws("docs", "web-app", "Update the docs", "done", 3 * 24 * 60),
      ws("retry", "payments-api", "Webhook retries", "done", 90, { branch: "main", additions: 0, deletions: 0 }),
    ],
  }];
}

export function SettingsPreview({ theme, profile, maxRows }: { theme: PluginTheme; profile: Profile; maxRows: number }) {
  const c = theme.colors;
  const settings = profile.settings;
  const now = Date.now();
  const rows = useMemo(() => {
    const hosts = sampleHosts(now);
    // Everything expanded, so the preview shows the row styles rather than the collapse state.
    const expanded = { ...settings, newGroupsExpanded: { hosts: true, projects: true } };
    const tree = buildTree(hosts, {
      filter: settings.defaultFilter, query: "", settings: expanded, collapse: { "agents:preview:checkout": false, "agents:preview:tokens": false, "subagents:preview:tokens:a1": false }, reads: {},
      order: {}, now, hostOrder: [], pins: new Set(),
    });
    return tree.rows.filter((row) => row.type !== "skeleton").slice(0, maxRows);
    // `now` changes every render; the preview only needs the profile and the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, maxRows]);

  const noop = () => undefined;
  return (
    <View accessibilityLabel="Preview" style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }} pointerEvents="none">
      {rows.length ? (
        rows.map((row: TreeRow) => (
          <Row
            key={row.key}
            row={row}
            theme={theme}
            profile={profile}
            comfortable={settings.density === "comfortable"}
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
        ))
      ) : (
        <Text style={{ color: c.foregroundMuted, padding: 12 }}>Nothing matches this profile's default filter.</Text>
      )}
    </View>
  );
}
