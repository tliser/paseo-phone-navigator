import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { timeAgo } from "../shared/format";
import { expandOrCollapseAll, isCollapsed, toggleCollapsed, type Profile } from "../shared/profiles";
import { dragId, heightsFor, rowOffsets, type DropTarget } from "../shared/drag";
import { buildTree, type TreeRow, type WorkspaceRow } from "../shared/tree";
import type { Filter } from "../shared/types";
import { useDragController } from "./drag-controller";
import { ProfileSheet } from "./profile-sheet";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { StateIcon, TallyBadge, UNREAD_BLUE } from "./visual";

const FILTER_LABEL: Record<Filter, string> = { all: "All", active: "Active", inbox: "Inbox" };
const FILTERS: Filter[] = ["all", "active", "inbox"];

/** Filter picked in this session per profile; starts at the profile's default. */
const sessionFilters = new Map<string, Filter>();

export function NavigatorScreen(props: PluginScreenProps & { openSettings(): void }) {
  const { theme, layout, navigation, openSettings } = props;
  const { store, snapshot } = useNavigatorStore();
  const profile = useActiveProfile(snapshot, layout.platform, layout.compact);
  const settings = profile.settings;
  const collapse = snapshot.collapseFor(profile.id);

  const [filter, setFilterState] = useState<Filter>(() => sessionFilters.get(profile.id) ?? settings.defaultFilter);
  useEffect(() => setFilterState(sessionFilters.get(profile.id) ?? settings.defaultFilter), [profile.id, settings.defaultFilter]);
  const setFilter = (next: Filter) => {
    sessionFilters.set(profile.id, next);
    setFilterState(next);
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Relative times stay fresh without re-rendering on every data tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const tree = useMemo(
    () => buildTree(snapshot.hosts, { filter, query, settings, collapse, reads: snapshot.reads, order: profile.order, now, hostOrder: snapshot.hostOrder }),
    [snapshot.hosts, snapshot.hostOrder, snapshot.reads, profile.order, filter, query, settings, collapse, now],
  );
  const loading = snapshot.hosts.some((host) => host.loading);
  useEffect(() => {
    if (refreshing && !loading) setRefreshing(false);
  }, [refreshing, loading]);

  const toggle = useCallback((key: string) => store.setCollapse(profile.id, toggleCollapsed(collapse, key, settings)), [store, profile.id, collapse, settings]);
  const open = useCallback(
    (row: WorkspaceRow) => {
      if (!navigation) return;
      navigation.openWorkspace({ workspaceId: row.workspace.id, serverId: row.serverId });
      // Viewing it is reading it. A prompt that is still waiting keeps the row amber regardless.
      store.markRead(row.serverId, [row.workspace.id]);
    },
    [navigation, store],
  );
  const toggleRead = useCallback(
    (row: WorkspaceRow) => (row.state === "unread" ? store.markRead(row.serverId, [row.workspace.id]) : store.markUnread(row.serverId, row.workspace.id)),
    [store],
  );
  const unreadIds = (serverId: string | null) =>
    tree.rows.flatMap((row) => (row.type === "workspace" && row.state === "unread" && (!serverId || row.serverId === serverId) ? [row] : []));
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  const anyCollapsed = tree.groupKeys.some((key) => isCollapsed(collapse, key, settings));

  const comfortable = settings.density === "comfortable";
  const c = theme.colors;
  const muted = { color: c.foregroundMuted };
  const searching = query.trim().length > 0;
  // Dragging only in manual mode and outside search (search reshapes the tree temporarily).
  const canArrange = settings.sort === "manual" && !searching;
  const heights = useMemo(() => heightsFor(comfortable), [comfortable]);

  const drop = useCallback(
    (row: TreeRow, target: DropTarget) => {
      const id = dragId(row);
      const group = row.type === "workspace" || row.type === "project" ? row.group : null;
      if (!id || !group) return;
      store.move(profile.id, group, tree.groups[group] ?? [], id, target.targetId, target.place);
    },
    [store, profile.id, tree.groups],
  );
  const offsets = useMemo(() => rowOffsets(tree.rows, heights), [tree.rows, heights]);
  const drag = useDragController({ rows: tree.rows, heights, onDrop: drop });
  const dragging = drag.state;

  const renderItem = ({ item, index }: { item: TreeRow; index: number }) => (
    <Row
      row={item}
      theme={theme}
      profile={profile}
      comfortable={comfortable}
      searching={searching}
      now={now}
      onToggle={toggle}
      onOpen={open}
      onToggleRead={toggleRead}
      canOpen={!!navigation}
      onPickUp={canArrange && dragId(item) ? () => drag.pickUp(index) : undefined}
      lifted={dragging?.index === index ? dragging.dy : null}
    />
  );

  const empty = snapshot.hosts.length === 0 ? (
    <EmptyState theme={theme} icon="Server" title="No hosts configured" text="Add a host in Paseo to see its workspaces here." />
  ) : tree.emptyBecauseFiltered ? (
    <EmptyState
      theme={theme}
      icon="Search"
      title={query.trim() ? `No workspaces match "${query.trim()}"` : filter === "inbox" ? "Inbox zero: nothing new, nothing asking" : "Nothing running, new or asking"}
      action={{ label: "Show all", onPress: () => { setFilter("all"); closeSearch(); } }}
    />
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      {/* Sticky header: one 44pt line, or the search field plus filter chips while searching. */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface0 }}>
        {searchOpen ? (
          <>
            <View style={{ height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 4 }}>
              <View style={{ flex: 1, height: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
                <Icon name="Search" size={14} color={c.foregroundMuted} />
                <TextInput
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Title, branch, project, host, model"
                  placeholderTextColor={c.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={{ flex: 1, color: c.foreground, fontSize: 15, paddingVertical: 0 }}
                />
              </View>
              <HeaderButton theme={theme} icon="X" label="Clear search" onPress={closeSearch} />
            </View>
            <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
              {FILTERS.map((key) => (
                <Chip key={key} theme={theme} active={filter === key} onPress={() => setFilter(key)} label={`${FILTER_LABEL[key]} ${tree.counts[key]}`} />
              ))}
            </View>
          </>
        ) : (
          <View style={{ height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 2 }}>
            <HeaderButton theme={theme} icon="Search" label="Search" onPress={() => setSearchOpen(true)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${tree.tally.needsYou} asking you, ${tree.tally.unread} unread. Toggle the inbox filter.`}
              onPress={() => setFilter(filter === "inbox" ? (settings.defaultFilter === "inbox" ? "all" : settings.defaultFilter) : "inbox")}
              style={{ height: 44, justifyContent: "center" }}
            >
              <View style={{ height: 32, paddingHorizontal: 9, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: filter === "inbox" ? c.foreground : c.border, backgroundColor: filter === "inbox" ? c.surface2 : "transparent" }}>
                <Icon name="Inbox" size={14} color={c.foreground} />
                {tree.tally.needsYou || tree.tally.unread ? <TallyBadge theme={theme} tally={tree.tally} small /> : <Text style={{ fontSize: 13, color: c.foregroundMuted }}>0</Text>}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${FILTER_LABEL[filter]}`} onPress={() => setMenu((value) => !value)} style={{ height: 44, justifyContent: "center", marginLeft: 4 }}>
              <View style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ fontSize: 13, color: c.foreground }}>{FILTER_LABEL[filter]}</Text>
                <Icon name="ChevronDown" size={14} color={c.foregroundMuted} />
              </View>
            </Pressable>
            <View style={{ flex: 1 }} />
            {tree.tally.unread ? (
              <HeaderButton theme={theme} icon="CheckCheck" label={`Mark ${tree.tally.unread} unread as read`} onPress={() => {
                const rows = unreadIds(null);
                const byHost = new Map<string, string[]>();
                for (const row of rows) byHost.set(row.serverId, [...(byHost.get(row.serverId) ?? []), row.workspace.id]);
                for (const [serverId, ids] of byHost) store.markRead(serverId, ids);
              }} />
            ) : null}
            <HeaderButton
              theme={theme}
              icon={anyCollapsed ? "ChevronsUpDown" : "ChevronsDownUp"}
              label={anyCollapsed ? "Expand all" : "Collapse to hosts"}
              onPress={() => store.setCollapse(profile.id, expandOrCollapseAll(collapse, tree.groupKeys, settings))}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={`Profile: ${profile.name}`} onPress={() => setSheet(true)} style={{ height: 44, justifyContent: "center", paddingRight: 4 }}>
              <View style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, maxWidth: 140 }}>
                <Icon name="UserRound" size={14} color={c.foregroundMuted} />
                <Text numberOfLines={1} style={{ fontSize: 13, color: c.foreground, flexShrink: 1 }}>{profile.name}</Text>
                <Icon name="ChevronDown" size={14} color={c.foregroundMuted} />
              </View>
            </Pressable>
          </View>
        )}
        {menu && !searchOpen ? (
          <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
            {FILTERS.map((key) => (
              <Chip key={key} theme={theme} active={filter === key} onPress={() => { setFilter(key); setMenu(false); }} label={`${FILTER_LABEL[key]} ${tree.counts[key]}`} />
            ))}
          </View>
        ) : null}
      </View>

      {snapshot.errors.length || snapshot.savingError ? (
        <Text style={{ ...muted, fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, color: c.statusDanger }} numberOfLines={3}>
          {[...snapshot.errors, ...(snapshot.savingError ? [snapshot.savingError] : [])].join("\n")}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} {...drag.handlers}>
        <FlatList
          data={tree.rows}
          extraData={dragging}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          ListFooterComponent={empty}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!dragging}
          onScroll={(event) => drag.setScrollY(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={32}
          onRefresh={() => {
            setRefreshing(true);
            store.refresh();
          }}
          refreshing={refreshing}
          initialNumToRender={30}
          windowSize={11}
          contentContainerStyle={{ paddingBottom: 40 }}
          getItemLayout={(_data, index) => {
            const top = offsets[index] ?? 0;
            return { index, offset: top, length: (offsets[index + 1] ?? top) - top };
          }}
        />
        {dragging?.drop ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 40, right: 12, top: dragging.drop.lineY - drag.scrollAtPickUp() - 1, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
        ) : null}
      </View>

      {sheet ? <ProfileSheet theme={theme} platform={layout.platform} active={profile} onClose={() => setSheet(false)} onEdit={() => { setSheet(false); openSettings(); }} /> : null}
    </View>
  );
}

function HeaderButton({ theme, icon, label, onPress }: { theme: PluginTheme; icon: string; label: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={18} color={theme.colors.foreground} />
    </Pressable>
  );
}

function Chip({ theme, label, active, onPress }: { theme: PluginTheme; label: string; active: boolean; onPress(): void }) {
  const c = theme.colors;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", borderWidth: 1, borderColor: active ? c.foreground : c.border, backgroundColor: active ? c.foreground : c.surface1 }}>
      <Text style={{ fontSize: 13, color: active ? c.surface0 : c.foreground }}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ theme, icon, title, text, action }: { theme: PluginTheme; icon: string; title: string; text?: string; action?: { label: string; onPress(): void } }) {
  const c = theme.colors;
  return (
    <View style={{ alignItems: "center", padding: 32, gap: 10 }}>
      <Icon name={icon} size={26} color={c.foregroundMuted} />
      <Text style={{ color: c.foreground, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {text ? <Text style={{ color: c.foregroundMuted, textAlign: "center" }}>{text}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 10, justifyContent: "center", backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foreground, fontWeight: "500" }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface RowProps {
  row: TreeRow;
  theme: PluginTheme;
  profile: Profile;
  comfortable: boolean;
  searching: boolean;
  now: number;
  canOpen: boolean;
  onToggle(key: string): void;
  onOpen(row: WorkspaceRow): void;
  onToggleRead(row: WorkspaceRow): void;
  /** Set in manual mode: long-press picks the row up for dragging. */
  onPickUp?: () => void;
  /** Drag offset while this row is picked up, else null. */
  lifted: number | null;
}

function Row({ row, theme, profile, comfortable, searching, now, canOpen, onToggle, onOpen, onToggleRead, onPickUp, lifted }: RowProps) {
  const c = theme.colors;
  const liftStyle =
    lifted !== null
      ? { transform: [{ translateY: lifted }], zIndex: 20, elevation: 8, opacity: 0.95, backgroundColor: c.surface2, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }
      : null;
  const { group: groupHeight, workspace: workspaceHeight, note: noteHeight } = heightsFor(comfortable);
  const fontSize = comfortable ? 15 : 14;
  const separator = { borderBottomWidth: 1, borderBottomColor: c.border };

  if (row.type === "host") {
    const online = row.state === "online";
    const dot = row.state === "online" ? c.statusSuccess : row.state === "loading" ? c.statusWarning : c.foregroundMuted;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.label}${online ? `, ${row.count} workspaces` : row.state === "offline" ? ", offline" : ", loading"}`}
        accessibilityState={online ? { expanded: !row.collapsed } : { disabled: true }}
        disabled={!online}
        onPress={() => onToggle(row.key)}
        style={{ height: groupHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, paddingRight: 12, backgroundColor: c.surface1, opacity: row.state === "offline" ? 0.45 : 1, ...separator }}
      >
        <View style={{ width: 20, alignItems: "center" }}>{online ? <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} /> : null}</View>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontWeight: "600", fontSize }}>{row.label}</Text>
        {online ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{row.count}</Text> : <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{row.state === "offline" ? "offline" : "loading…"}</Text>}
        {online ? <TallyBadge theme={theme} tally={row.tally} /> : null}
      </Pressable>
    );
  }

  if (row.type === "project") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.name}, ${row.count} workspaces${row.collapsed && row.tally.needsYou ? ", something asks you" : row.collapsed && row.tally.unread ? ", unread" : ""}`}
        accessibilityState={{ expanded: !row.collapsed }}
        accessibilityHint={onPickUp ? "Long press and drag to reorder" : undefined}
        onPress={() => onToggle(row.key)}
        onLongPress={onPickUp}
        delayLongPress={350}
        style={{ height: groupHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 24, paddingRight: 12, backgroundColor: c.surface0, ...separator, ...liftStyle }}
      >
        <View style={{ width: 20, alignItems: "center" }}>
          <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} />
        </View>
        <Icon name="Folder" size={14} color={c.foregroundMuted} />
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize }}>{row.name}</Text>
        {row.collapsed && (row.tally.needsYou || row.tally.unread) ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.tally.needsYou ? c.statusWarning : UNREAD_BLUE }} /> : null}
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{row.count}</Text>
        {onPickUp ? <Icon name="GripVertical" size={14} color={c.foregroundMuted} /> : null}
      </Pressable>
    );
  }

  if (row.type === "skeleton") {
    return (
      <View style={{ height: workspaceHeight, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 48, paddingRight: 12 }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.surface2 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 12, width: "70%", borderRadius: 6, backgroundColor: c.surface2 }} />
          <View style={{ height: 10, width: "45%", borderRadius: 5, backgroundColor: c.surface1 }} />
        </View>
      </View>
    );
  }

  if (row.type === "note") {
    return (
      <View style={{ height: noteHeight, justifyContent: "center", paddingLeft: 56, paddingRight: 12 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{row.text}</Text>
      </View>
    );
  }

  const { workspace } = row;
  const show = profile.settings.show;
  const parts: string[] = [];
  if (searching) parts.push(row.hostLabel);
  if (show.branch && workspace.branch) parts.push(workspace.branch);
  if (show.model && row.modelShort) parts.push(row.modelShort);
  if (show.time) {
    const ago = timeAgo(workspace.activityAt, now);
    if (ago) parts.push(ago);
  }
  const hasDiff = show.diff && (workspace.additions > 0 || workspace.deletions > 0);
  return (
    <View style={{ height: workspaceHeight, flexDirection: "row", alignItems: "center", backgroundColor: c.surface0, ...liftStyle }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${workspace.title}, ${row.state === "needs_you" ? "asking you" : row.state === "unread" ? "unread" : row.state}, ${parts.join(", ")}`}
        accessibilityHint={onPickUp ? "Long press and drag to reorder" : undefined}
        disabled={!canOpen && !onPickUp}
        onPress={() => canOpen && onOpen(row)}
        onLongPress={onPickUp}
        delayLongPress={350}
        style={({ pressed }) => ({ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 48, backgroundColor: pressed && lifted === null ? c.surface1 : "transparent" })}
      >
        <StateIcon theme={theme} state={row.state} status={workspace.status} />
        <View style={{ flex: 1, minWidth: 0, gap: comfortable ? 4 : 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize, fontWeight: row.state === "unread" || row.state === "needs_you" ? "700" : "400" }}>{workspace.title}</Text>
            {hasDiff ? (
              <Text style={{ fontSize: 11.5, fontVariant: ["tabular-nums"] }}>
                <Text style={{ color: c.statusSuccess }}>{`+${workspace.additions}`}</Text>
                <Text style={{ color: c.statusDanger }}>{` −${workspace.deletions}`}</Text>
              </Text>
            ) : null}
          </View>
          {parts.length ? (
            <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: comfortable ? 13 : 12 }}>{parts.join(" · ")}</Text>
          ) : null}
        </View>
      </Pressable>
      {row.state === "unread" || row.state === "read" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.state === "unread" ? "Mark read" : "Mark unread"}
          onPress={() => onToggleRead(row)}
          hitSlop={4}
          style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name={row.state === "unread" ? "MailOpen" : "Mail"} size={16} color={row.state === "unread" ? UNREAD_BLUE : c.foregroundMuted} />
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}
      <View style={{ width: onPickUp ? 22 : 8, alignItems: "flex-start" }}>
        {onPickUp ? <Icon name="GripVertical" size={14} color={c.foregroundMuted} /> : null}
      </View>
    </View>
  );
}
