// Live preview for the settings screen: a few rows drawn exactly as the navigator draws them,
// built from the profile being edited, so density, shown fields, filter and order show at once.
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Profile } from "../shared/profiles";
import { buildTree, type TreeRow } from "../shared/tree";
import type { HostInput, WorkspaceInput } from "../shared/types";
import { Row } from "./navigator-screen";
import type { StoreSnapshot } from "./store";

const MINUTE = 60_000;

/** Used when no host has workspaces yet, so the preview still shows something. */
function sampleHosts(now: number): HostInput[] {
  const ws = (id: string, title: string, status: WorkspaceInput["status"], minutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
    id, projectId: "sample", projectName: "my-project", projectKind: "git", projectRootPath: "", title, status,
    needsYou: status === "needs_input", unreadAt: 0, branch: `feat/${id}`, additions: 42, deletions: 7,
    activityAt: now - minutes * MINUTE, model: "anthropic/claude-sonnet-4-5", ...extra,
  });
  return [{
    serverId: "preview", label: "This host", status: "online", loading: false, error: null,
    workspaces: [
      ws("checkout", "Checkout redesign", "needs_input", 3),
      ws("tokens", "Dark mode tokens", "running", 1),
      ws("login", "Fix flaky login test", "attention", 12, { unreadAt: now - 12 * MINUTE }),
      ws("docs", "Update the docs", "done", 3 * 24 * 60),
    ],
  }];
}

export function SettingsPreview({ theme, profile, snapshot, maxRows }: { theme: PluginTheme; profile: Profile; snapshot: StoreSnapshot; maxRows: number }) {
  const c = theme.colors;
  const settings = profile.settings;
  const now = Date.now();
  const rows = useMemo(() => {
    const live = snapshot.hosts.filter((host) => host.status === "online" && host.workspaces.length);
    const hosts = live.length ? live.slice(0, 1) : sampleHosts(now);
    // Everything expanded, so the preview shows the row styles rather than the collapse state.
    const expanded = { ...settings, newGroupsExpanded: { hosts: true, projects: true } };
    const tree = buildTree(hosts, {
      filter: settings.defaultFilter, query: "", settings: expanded, collapse: {}, reads: snapshot.reads,
      order: profile.order, now, hostOrder: snapshot.hostOrder, pins: new Set(profile.pins),
    });
    return tree.rows.filter((row) => row.type !== "skeleton").slice(0, maxRows);
    // `now` changes every render; the preview only needs the profile and the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.hosts, snapshot.hostOrder, snapshot.reads, profile, maxRows]);

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
