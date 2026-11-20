// Settings preview: the top of the navigator (host switch, views) and a small tree drawn exactly as the
// navigator draws them, from sample data (never a real host), with the profile being edited. Everything
// the View, Rows, Order and Groups settings change shows here: density, host switch, the view it opens on
// (and what Recent means), the open-workspace marker, row lines, tabs and sub-agents, hiding finished
// workspaces, manual order grips and which groups start open.
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { View } from "react-native";
import { dragId } from "../shared/drag";
import type { Profile } from "../shared/profiles";
import { buildTree } from "../shared/tree";
import type { AgentInput, HostInput, WorkspaceInput } from "../shared/types";
import { HostButton, HostTabs } from "./host-switch";
import { Row } from "./navigator-screen";
import { ViewsControl } from "./title-bar";

const MINUTE = 60_000;

/**
 * Sample workspaces on your hosts' names (never their data), so hiding a host and the host switch show:
 * the first host has one that asks you (tabs open, one sub-agent), one running, one read three days ago
 * and, in a second project, one read; every other host has one unread.
 */
function sampleHosts(now: number, names: readonly { serverId: string; label: string }[]): HostInput[] {
  const chat = (id: string, title: string, status: AgentInput["status"], minutes: number, extra: Partial<AgentInput> = {}): AgentInput => ({
    id, title, model: "anthropic/claude-sonnet-4-5", status, parentId: null, activityAt: now - minutes * MINUTE, unreadAt: status === "finished" ? now - minutes * MINUTE : 0, ...extra,
  });
  const ws = (id: string, title: string, status: WorkspaceInput["status"], minutes: number, extra: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
    id, projectId: "web-app", projectName: "web-app", projectKind: "git", projectRootPath: "", title, status,
    needsYou: status === "needs_input", unreadAt: 0, branch: `feat/${id}`, additions: 42, deletions: 7,
    activityAt: now - minutes * MINUTE, orderAt: now - minutes * MINUTE, model: "anthropic/claude-sonnet-4-5", ...extra,
  });
  const [first, ...others] = names.length ? names : [{ serverId: "preview", label: "tardis" }];
  return [
    {
      serverId: first!.serverId, label: first!.label, status: "online", loading: false, error: null,
      workspaces: [
        ws("checkout", "Checkout redesign", "needs_input", 3, {
          agents: [chat("c1", "Payment states", "asking", 3), chat("c3", "Check contrast", "idle", 5, { parentId: "c1" }), chat("c2", "Accessibility review", "finished", 8, { model: "openai/gpt-5.4" })],
          terminals: [{ id: "t1", title: "Terminal 1" }],
        }),
        ws("tokens", "Dark mode tokens", "running", 1, { agents: [chat("a1", "Build the palette", "running", 1)] }),
        ws("docs", "Update the docs", "done", 3 * 24 * 60, { branch: "main", additions: 0, deletions: 0 }),
        ws("retry", "Webhook retries", "done", 90, { projectId: "payments-api", projectName: "payments-api", additions: 0, deletions: 0 }),
      ],
    },
    ...others.map((host): HostInput => ({ ...host, status: "online", loading: false, error: null, workspaces: [ws("notes", "Meeting notes", "attention", 30, { unreadAt: now - 30 * MINUTE })] })),
  ];
}

export function SettingsPreview({
  theme,
  profile,
  touch,
  hosts,
  colors,
}: {
  theme: PluginTheme;
  profile: Profile;
  touch: boolean;
  /** Your hosts' ids and names, in the app's order. */
  hosts: readonly { serverId: string; label: string }[];
  colors: Readonly<Record<string, string>>;
}) {
  const c = theme.colors;
  const settings = profile.settings;
  const now = Date.now();
  const hostKey = hosts.map((host) => `${host.serverId}\n${host.label}`).join("\n");
  const tree = useMemo(
    () => {
      const sample = sampleHosts(now, hosts);
      const main = sample[0]!.serverId;
      return buildTree(sample, {
        filter: settings.defaultFilter, query: "", settings,
        // The first host and project stay open so row settings always show; the second project and other hosts
        // follow "start open". The first workspace's tabs and sub-agents are open; "Checkout redesign" is pinned.
        collapse: { [`host:${main}`]: false, [`proj:${main}:web-app`]: false, [`agents:${main}:checkout`]: false, [`subagents:${main}:checkout:c1`]: false },
        reads: {}, now, pins: new Set([`${main}:checkout`]),
      });
    },
    // `now` changes every render; the preview follows the profile and the host names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, hostKey],
  );
  const manual = settings.sort === "manual";
  const noop = () => undefined;
  // "Several" shows two hosts picked, so the setting visibly changes the preview.
  const picked = settings.hostPick === "several" ? tree.hosts.slice(0, 2).map((host) => host.serverId) : [];
  return (
    <View accessibilityLabel="Preview" style={{ backgroundColor: c.surface0 }} pointerEvents="none">
      <View style={{ gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
        {/* As in the navigator: a host switch only with more than one host shown. */}
        {tree.hosts.length < 2 ? null : settings.hostSwitch === "tabs" ? (
          <HostTabs theme={theme} hosts={tree.hosts} value={picked} mode={settings.hostPick} compact={touch} colors={colors} onChange={noop} onPickColor={noop} />
        ) : (
          <View style={{ alignItems: "flex-end", paddingHorizontal: 4 }}>
            <HostButton theme={theme} hosts={tree.hosts} value={picked} compact={touch} colors={colors} onOpen={noop} />
          </View>
        )}
        <ViewsControl theme={theme} value={settings.defaultFilter} counts={tree.counts} compact={touch} onChange={noop} />
      </View>
      {tree.rows.map((row) => (
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
          colors={colors}
          dragHandle={manual && dragId(row) ? {} : undefined}
          active={row.type === "workspace" && row.workspace.id === "tokens"}
        />
      ))}
    </View>
  );
}
