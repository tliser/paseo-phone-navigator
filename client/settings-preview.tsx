// Preview for the settings screen: a few rows drawn exactly as the navigator draws them, from sample
// data (never a real host), built with the profile being edited, so density, shown fields, filter and
// order show at once.
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Profile } from "../shared/profiles";
import { buildTree, type TreeRow } from "../shared/tree";
import type { HostInput, WorkspaceInput } from "../shared/types";
import { Row } from "./navigator-screen";

const MINUTE = 60_000;

/** Sample workspaces covering every row state: asking, running (with agents), unread, read and old. */
function sampleHosts(now: number): HostInput[] {
  const ws = (id: string, project: string, title: string, status: WorkspaceInput["status"], minutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
    id, projectId: project, projectName: project, projectKind: "git", projectRootPath: "", title, status,
    needsYou: status === "needs_input", unreadAt: 0, branch: `feat/${id}`, additions: 42, deletions: 7,
    activityAt: now - minutes * MINUTE, model: "anthropic/claude-sonnet-4-5", ...extra,
  });
  return [{
    serverId: "preview", label: "Sample host", status: "online", loading: false, error: null,
    workspaces: [
      ws("checkout", "web-app", "Checkout redesign", "needs_input", 3),
      ws("tokens", "web-app", "Dark mode tokens", "running", 1, {
        agents: [
          { id: "a1", title: "Build the palette", model: "anthropic/claude-sonnet-4-5", status: "running", activityAt: now - MINUTE, parentId: null, unreadAt: 0 },
          { id: "a2", title: "Check contrast", model: "openai/gpt-5.4", status: "finished", activityAt: now - 5 * MINUTE, parentId: "a1", unreadAt: now - 5 * MINUTE },
        ],
      }),
      ws("login", "web-app", "Fix flaky login test", "attention", 12, { unreadAt: now - 12 * MINUTE }),
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
      filter: settings.defaultFilter, query: "", settings: expanded, collapse: { "agents:preview:tokens": false }, reads: {},
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
            lifted={null}
          />
        ))
      ) : (
        <Text style={{ color: c.foregroundMuted, padding: 12 }}>Nothing matches this profile's default filter.</Text>
      )}
    </View>
  );
}
