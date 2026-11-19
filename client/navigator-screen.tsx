import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, TerminalRef } from "@getpaseo/plugin/client";
import { FlatList, Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, findNodeHandle, Platform, Pressable, Text, View, type GestureResponderHandlers } from "react-native";
import { timeAgo } from "../shared/format";
import { expandForAttention, expandOrCollapseAll, isCollapsed, toggleCollapsed, type Profile, type RowField } from "../shared/profiles";
import { blockEnd, dragId, dragShift, heightsFor, rowOffsets, stickyHeaders, type DropTarget, type StickyHeaders } from "../shared/drag";
import { inboxTally, type InboxEntry } from "../shared/inbox";
import { buildTree, workspaceState, type HostRow, type ProjectRow, type TabRow, type Tally, type TreeRow, type WorkspaceRow } from "../shared/tree";
import type { Filter, WorkspaceState } from "../shared/types";
import { GLIDE_MS, useDragController } from "./drag-controller";
import { MONO_FONT, useFontScale } from "./font-scale";
import { NamesCard, type Peek } from "./names-card";
import { NewProjectSheet } from "./new-project-sheet";
import { NewWorkspaceSheet } from "./new-workspace-sheet";
import { InboxSheet } from "./inbox-sheet";
import { OptionsMenu } from "./options-menu";
import { useActiveProfile, useInbox, useNavigatorStore, withTerminals, type TerminalTabs } from "./runtime";
import type { Anchor } from "./sheet";
import type { Place } from "../shared/order";
import { SearchField, TitleBar, ViewsControl } from "./title-bar";
import { HostButton, HostMenu, HostTabs } from "./host-switch";
import { Toast, useToastState } from "./toast";
import { Mark, MARK_LABEL, markColor, TallyMarks, type MarkKind } from "./marks";
import { unreadColor } from "./colors";
import { canMarkWorkspaceRead, markWorkspaceRead, toggleRecent, WorkspaceMenu, type MenuTarget } from "./workspace-menu";
import { SwipeRow } from "./swipe-row";
import { ProjectMenu } from "./project-menu";
import { measureAnchor } from "./sheet";
import { ColorPicker, type ColorTarget } from "./color-picker";
import { colorHex, hostColorKey, projectColorKey } from "../shared/colors";

/** Filter and host picked in this session per profile; the filter starts at the profile's default, the host at all. */
const sessionFilters = new Map<string, Filter>();
const sessionHosts = new Map<string, string | null>();

/**
 * A chat was opened from the Inbox on the phone screen: coming back to the screen reopens the Inbox.
 * The sidebar view leaves the plugin when it opens a chat, so it never sets this.
 */
const NO_TERMINALS: TerminalTabs = { byWorkspace: new Map(), refs: new Map() };

let reopenInboxUntil = 0;
const REOPEN_WINDOW_MS = 10 * 60_000;

type Navigation = NonNullable<PluginScreenProps["navigation"]> & {
  /** Sidebar view only. */
  openTerminal?(ref: TerminalRef): void;
};

export function NavigatorScreen(
  props: Omit<PluginScreenProps, "navigation"> & {
    navigation?: Navigation;
    openSettings(): void;
    activeWorkspace?: { serverId: string; workspaceId: string } | null;
    surface: "screen" | "sidebar";
    /** Terminal tabs; only the sidebar view can read them. */
    terminals?: TerminalTabs;
  },
) {
  const { theme, layout, navigation, openSettings, activeWorkspace, surface } = props;
  const { store, snapshot } = useNavigatorStore();
  const profile = useActiveProfile(snapshot, layout.platform, layout.compact);
  const settings = profile.settings;
  const collapse = snapshot.collapseFor(profile.id);
  // Stable identity so the tree is only rebuilt when the pins actually change.
  const pinKey = [...snapshot.pinsFor(profile.id)].sort().join("\n");
  const pins = useMemo(() => new Set(pinKey ? pinKey.split("\n") : []), [pinKey]);

  const [filter, setFilterState] = useState<Filter>(() => sessionFilters.get(profile.id) ?? settings.defaultFilter);
  useEffect(() => setFilterState(sessionFilters.get(profile.id) ?? settings.defaultFilter), [profile.id, settings.defaultFilter]);
  const setFilter = (next: Filter) => {
    sessionFilters.set(profile.id, next);
    setFilterState(next);
  };

  const [hostView, setHostViewState] = useState<string | null>(() => sessionHosts.get(profile.id) ?? null);
  useEffect(() => setHostViewState(sessionHosts.get(profile.id) ?? null), [profile.id]);
  const setHostView = (next: string | null) => {
    sessionHosts.set(profile.id, next);
    setHostViewState(next);
  };

  const [query, setQuery] = useState("");
  /** Phones: the search field shows only after the search icon is tapped. */
  const [searchOpen, setSearchOpen] = useState(false);
  /** Open overlay of the title bar and where its button is (desktop popovers hang under it). */
  const [overlay, setOverlay] = useState<{ kind: "inbox" | "options" | "hosts"; anchor: Anchor | null } | null>(() => {
    const reopen = Date.now() < reopenInboxUntil && layout.compact && surface === "screen";
    reopenInboxUntil = 0;
    return reopen ? { kind: "inbox", anchor: null } : null;
  });
  const { toast, show: showToast, hide: hideToast } = useToastState();
  const inboxButton = useRef<View>(null);
  /** Closing the Inbox returns focus to its button. */
  const closeInbox = () => {
    setOverlay(null);
    const node = findNodeHandle(inboxButton.current);
    if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
  };
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Project whose new-workspace draft is open, and workspace whose menu is open. */
  const [draftFor, setDraftFor] = useState<ProjectRow | null>(null);
  const [menuFor, setMenuFor] = useState<MenuTarget | null>(null);
  const [projectFor, setProjectFor] = useState<{ row: ProjectRow; anchor: Anchor | null } | null>(null);
  const [colorFor, setColorFor] = useState<ColorTarget | null>(null);
  const pickHostColor = (host: { serverId: string; label: string }) =>
    setColorFor({ key: hostColorKey(host.serverId), title: `Host colour · ${host.label}`, icon: "Server", fallback: theme.colors.foregroundMuted });
  const pickColor = (row: ProjectRow | HostRow) =>
    row.type === "host"
      ? pickHostColor(row)
      : setColorFor({ key: projectColorKey(row.serverId, row.projectId), title: `Folder colour · ${row.name}`, icon: "Folder", fallback: theme.colors.accent });
  const [newProjectFor, setNewProjectFor] = useState<{ hosts: { serverId: string; label: string }[]; anchor: Anchor | null } | null>(null);

  // Relative times stay fresh without re-rendering on every data tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const terminals = props.terminals ?? NO_TERMINALS;
  const hosts = useMemo(() => withTerminals(snapshot.hosts, terminals.byWorkspace), [snapshot.hosts, terminals]);
  const tree = useMemo(
    () => buildTree(hosts, { filter, query, settings, collapse, reads: snapshot.reads, order: profile.order, now, hostOrder: snapshot.hostOrder, pins, archiving: snapshot.archiving, hostView }),
    [hosts, snapshot.hostOrder, snapshot.reads, snapshot.archiving, profile.order, filter, query, settings, collapse, now, pins, hostView],
  );
  // New project goes to the host on screen, or asks which online host when all are shown.
  const projectHosts = tree.hosts.filter((host) => host.state === "online" && (!tree.hostView || host.serverId === tree.hostView));
  const hostSwitch = tree.hosts.length > 1 ? settings.hostSwitch : null;
  const loading = snapshot.hosts.some((host) => host.loading);
  useEffect(() => {
    if (refreshing && !loading) setRefreshing(false);
  }, [refreshing, loading]);

  const toggle = useCallback((key: string) => store.setCollapse(profile.id, toggleCollapsed(collapse, key, settings)), [store, profile.id, collapse, settings]);

  // A workspace that starts asking you (or whose agent errors) opens its folded host and project.
  // The first pass only records what already needs you, so opening the screen keeps your folding.
  const needingYou = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Map<string, { serverId: string; projectId: string }>();
    for (const host of snapshot.hosts) {
      if (host.status !== "online") continue;
      for (const workspace of host.workspaces) {
        const state = workspaceState(workspace, host.serverId, snapshot.reads);
        if (state === "needs_you" || state === "error") now.set(`${host.serverId}:${workspace.id}`, { serverId: host.serverId, projectId: workspace.projectId });
      }
    }
    const seen = needingYou.current;
    needingYou.current = new Set(now.keys());
    if (!seen) return;
    const fresh = [...now].filter(([key]) => !seen.has(key)).map(([, where]) => where);
    if (!fresh.length) return;
    const next = expandForAttention(collapse, fresh, settings);
    if (next !== collapse) store.setCollapse(profile.id, next);
  }, [snapshot.hosts, snapshot.reads, collapse, settings, store, profile.id]);
  const open = useCallback(
    (row: WorkspaceRow) => {
      if (!navigation) return;
      navigation.openWorkspace({ workspaceId: row.workspace.id, serverId: row.serverId });
    },
    [navigation],
  );
  const openTab = useCallback(
    (row: TabRow) => {
      if (!navigation) return;
      if (row.kind === "chat") navigation.openAgent({ agentId: row.id, serverId: row.serverId });
      // Only the sidebar view can open a terminal; elsewhere its workspace opens.
      else if (navigation.openTerminal && terminals.refs.has(`${row.serverId}:${row.id}`)) navigation.openTerminal(terminals.refs.get(`${row.serverId}:${row.id}`)!);
      else navigation.openWorkspace({ workspaceId: row.workspaceId, serverId: row.serverId });
    },
    [navigation, terminals],
  );
  const created = useCallback(
    (serverId: string, workspaceId: string) => {
      setDraftFor(null);
      navigation?.openWorkspace({ workspaceId, serverId });
    },
    [navigation],
  );
  const inbox = useInbox(snapshot);
  const inboxCounts = useMemo(() => inboxTally(inbox.entries), [inbox]);
  /** Marks exactly the unread chats the Inbox lists; Undo puts back only those still marked by this. */
  const markInboxUnreadRead = () => {
    const byHost = new Map<string, string[]>();
    for (const entry of inbox.entries) if (entry.state === "unread") byHost.set(entry.serverId, [...(byHost.get(entry.serverId) ?? []), entry.agentId]);
    const changes = [...byHost].flatMap(([serverId, ids]) => store.markChatsRead(serverId, ids));
    showToast({ text: `Marked ${changes.length} unread ${changes.length === 1 ? "chat" : "chats"} read`, undo: () => store.undoReads(changes) });
  };
  const openFromInbox = (entry: InboxEntry) => {
    setOverlay(null);
    if (!navigation) return;
    if (layout.compact && surface === "screen") reopenInboxUntil = Date.now() + REOPEN_WINDOW_MS;
    navigation.openAgent({ agentId: entry.agentId, serverId: entry.serverId });
  };
  /** Desktop: manual order. Phones: arrange mode, switching to manual order first when needed. */
  const startArranging = () => {
    if (layout.compact) setArrangeMode(true);
    if (settings.sort === "manual") return;
    const set = (sort: "auto" | "manual") => {
      const now = Date.now();
      store.editProfiles((profiles) => profiles.map((entry) => (entry.id === profile.id ? { ...entry, settings: { ...entry.settings, sort }, updatedAt: now } : entry)));
    };
    set("manual");
    showToast({
      text: "Order is now manual",
      undo: () => {
        set("auto");
        setArrangeMode(false);
      },
    });
  };
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  /** Moves an item one place up or down in its manual order group. */
  const step = (group: string, id: string, direction: -1 | 1) => {
    const ids = tree.groups[group] ?? [];
    const target = ids[ids.indexOf(id) + direction];
    if (target) store.move(profile.id, group, ids, id, target, (direction < 0 ? "before" : "after") as Place);
  };
  const archive = (row: WorkspaceRow) => {
    store.archiveWorkspace(row.serverId, row.workspace.id).catch(() => showToast({ text: `Could not archive ${row.workspace.title}` }));
  };
  /** The workspace row a tab row belongs to. */
  const rowOfTab = (tab: TabRow) => tree.rows.find((entry): entry is WorkspaceRow => entry.type === "workspace" && entry.serverId === tab.serverId && entry.workspace.id === tab.workspaceId);
  const anyCollapsed = tree.groupKeys.some((key) => isCollapsed(collapse, key, settings));

  const comfortable = settings.density === "comfortable";
  const scale = useFontScale();
  const c = theme.colors;
  const searching = query.trim().length > 0;
  // Dragging only in manual mode and outside search (search reshapes the tree temporarily). Phones show
  // grips only in arrange mode, so they never steal a swipe; there a grip lifts at once.
  const [arrangeMode, setArrangeMode] = useState(false);
  const arranging = layout.compact && arrangeMode;
  const canArrange = settings.sort === "manual" && !searching && (!layout.compact || arranging);
  const touch = layout.platform !== "web";
  const heights = useMemo(() => heightsFor(comfortable, scale, touch, settings.lines.length), [comfortable, scale, touch, settings.lines.length]);

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
  // Rows are dragged by their grip: at once with a mouse or in arrange mode; otherwise after a short hold
  // on touch screens, so a swipe that starts on the grip still scrolls.
  const drag = useDragController({ rows: tree.rows, heights, hold: touch && !arranging, onDrop: drop });
  const dragging = drag.state;
  const shift = useMemo(() => (dragging ? dragShift(tree.rows, offsets, dragging.index, dragging.drop) : null), [dragging, tree.rows, offsets]);
  // After a drop the new order is drawn at once; the moved block glides from where it was let go.
  const landing = useMemo(() => {
    if (!drag.landing) return null;
    const index = tree.rows.findIndex((row) => row.key === drag.landing!.key);
    if (index === -1) return null;
    return { start: index, end: blockEnd(tree.rows, index), from: drag.landing.top - (offsets[index] ?? 0) };
  }, [drag.landing, tree.rows, offsets]);

  // Info card on hover (desktop): a first delay, then it swaps almost at once while moving between rows.
  // Phones show the same card at the top of a row's action sheet instead.
  const [peek, setPeek] = useState<Peek | null>(null);
  const [areaHeight, setAreaHeight] = useState(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPeekAt = useRef(0);
  const peekAt = useCallback(
    (row: TreeRow, index: number, show: boolean) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
      if (!show) {
        setPeek((current) => {
          if (current?.row.key !== row.key) return current;
          lastPeekAt.current = Date.now();
          return null;
        });
        return;
      }
      const scanning = Date.now() - lastPeekAt.current < 400;
      const place = () => setPeek({ row, top: (offsets[index + 1] ?? 0) - drag.scrollY(), rowTop: (offsets[index] ?? 0) - drag.scrollY() });
      hoverTimer.current = setTimeout(place, scanning ? 60 : 450);
    },
    [offsets, drag],
  );
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const canPeek = settings.namesCard && !dragging && !touch;

  // Host and project headers stay at the top while their rows scroll under them.
  // Only a change of the pinned headers re-renders, not every scroll event.
  const [sticky, setSticky] = useState<StickyHeaders | null>(null);
  const updateSticky = useCallback(
    (scrollY: number) => {
      const next = stickyHeaders(tree.rows, offsets, scrollY, heights);
      setSticky((current) =>
        current && current.host === next.host && current.project === next.project && current.hostShift === next.hostShift && current.projectShift === next.projectShift ? current : next,
      );
    },
    [tree.rows, offsets, heights],
  );
  // Rows changed (folding, data): re-check against the current scroll position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => updateSticky(drag.scrollY()), [updateSticky]);

  const rowFor = (item: TreeRow, index: number) => (
    <Row
      row={item}
      theme={theme}
      profile={profile}
      comfortable={comfortable}
      scale={scale}
      touch={touch}
      searching={searching}
      now={now}
      onToggle={toggle}
      onOpen={open}
      onOpenTab={openTab}
      arranging={arranging}
      onMenu={(row, anchor) => setMenuFor({ row, anchor })}
      onTabMenu={(tab, anchor) => {
        const row = rowOfTab(tab);
        if (row) setMenuFor({ row, tab, anchor });
      }}
      onProjectMenu={(row, anchor) => setProjectFor({ row, anchor })}
      onCreate={setDraftFor}
      onSwipeAction={(row, action) => (action === "read" ? markWorkspaceRead(store, row, showToast) : toggleRecent(store, snapshot.reads, row, showToast))}
      colors={snapshot.colors}
      onPickColor={pickColor}
      canOpen={!!navigation}
      dragHandle={canArrange && dragId(item) ? drag.handleFor(index) : undefined}
      active={!layout.compact && !!activeWorkspace && item.type === "workspace" && item.serverId === activeWorkspace.serverId && item.workspace.id === activeWorkspace.workspaceId}
      lifted={dragging?.index === index ? dragging.dy : null}
      onPeek={canPeek ? (show) => peekAt(item, index, show) : undefined}
    />
  );

  const renderItem = ({ item, index }: { item: TreeRow; index: number }) => {
    const carried = !!dragging && !!shift && index >= dragging.index && index < shift.carried;
    const lands = landing && index >= landing.start && index < landing.end ? landing.from : null;
    return (
      <Glide
        follow={carried ? dragging!.dy : null}
        shift={shift && index >= shift.start && index < shift.end ? shift.shift : 0}
        dragging={!!dragging}
        landFrom={lands}
      >
        {rowFor(item, index)}
      </Glide>
    );
  };

  const empty = snapshot.hosts.length === 0 ? (
    <EmptyState theme={theme} icon="Server" title="No hosts configured" text="Add a host in Paseo to see its workspaces here." />
  ) : tree.emptyBecauseFiltered ? (
    <EmptyState
      theme={theme}
      icon="Search"
      title={query.trim() ? `No workspaces match "${query.trim()}"` : filter === "pinned" ? "Nothing pinned" : filter === "recent" ? `Nothing active in the last ${settings.recentDays === 1 ? "day" : `${settings.recentDays} days`}` : "Nothing running"}
      action={{ label: "Show all", onPress: () => { setFilter("all"); closeSearch(); } }}
    />
  ) : null;

  // Phones: the new-workspace form replaces the list as a full page (scrolls like the list does).
  if (draftFor && layout.compact) {
    return <NewWorkspaceSheet theme={theme} project={draftFor} compact onClose={() => setDraftFor(null)} onCreated={(id) => created(draftFor.serverId, id)} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <View style={{ gap: 8, paddingTop: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface0 }}>
        <TitleBar
          inboxRef={inboxButton}
          theme={theme}
          compact={layout.compact}
          inbox={inboxCounts}
          running={tree.running}
          scale={scale}
          onInbox={(anchor) => setOverlay({ kind: "inbox", anchor })}
          onRunning={() => setFilter("active")}
          onOptions={(anchor) => setOverlay({ kind: "options", anchor })}
          host={hostSwitch === "menu" ? <HostButton theme={theme} hosts={tree.hosts} value={tree.hostView} compact={layout.compact} colors={snapshot.colors} onOpen={(anchor) => setOverlay({ kind: "hosts", anchor })} /> : null}
          onNewProject={projectHosts.length && !arranging ? (anchor) => setNewProjectFor({ hosts: projectHosts, anchor }) : undefined}
          onSearch={layout.compact && !searchOpen ? () => setSearchOpen(true) : undefined}
        />
        {/* Desktop: search always under the title bar. Phones: only after the search icon, to save space. */}
        {!layout.compact ? <SearchField theme={theme} query={query} onChange={setQuery} /> : searchOpen ? <SearchField theme={theme} query={query} onChange={setQuery} onClose={closeSearch} /> : null}
        {hostSwitch === "tabs" ? <HostTabs theme={theme} hosts={tree.hosts} value={tree.hostView} compact={layout.compact} colors={snapshot.colors} onChange={setHostView} onPickColor={pickHostColor} /> : null}
        <ViewsControl theme={theme} value={filter} counts={tree.counts} compact={layout.compact} onChange={setFilter} />
      </View>
      {arranging ? (
        <View accessibilityRole="summary" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 4, minHeight: 48, backgroundColor: c.surface1, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Text style={{ flex: 1, color: c.foreground, fontSize: 13 }}>Drag the grips to reorder.</Text>
          <Pressable accessibilityRole="button" onPress={() => setArrangeMode(false)} style={{ minWidth: 64, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 }}>
            <Text style={{ color: c.accent, fontSize: 15, fontWeight: "700" }}>Done</Text>
          </Pressable>
        </View>
      ) : null}

      {snapshot.errors.length || snapshot.savingError ? (
        <Text style={{ fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, color: c.statusDanger }} numberOfLines={3}>
          {[...snapshot.errors, ...(snapshot.savingError ? [snapshot.savingError] : [])].join("\n")}
        </Text>
      ) : null}

      {/* While a row is dragged, the text it passes must not get selected (web/desktop). */}
      <View style={{ flex: 1, ...(dragging ? { userSelect: "none" } : null) } as never} {...drag.handlers} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
        <FlatList
          data={tree.rows}
          extraData={[dragging, landing, canPeek, scale, canArrange, arranging, profile, activeWorkspace, snapshot.colors, searching]}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          ListFooterComponent={empty}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!dragging}
          onScroll={(event) => {
            drag.setScrollY(event.nativeEvent.contentOffset.y);
            updateSticky(event.nativeEvent.contentOffset.y);
            if (peek) setPeek(null);
          }}
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
        {sticky && !dragging && (sticky.host !== null || sticky.project !== null) ? (
          <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: heights.host + heights.project, overflow: "hidden", zIndex: 30, elevation: 6 }}>
            {sticky.project !== null && tree.rows[sticky.project] ? (
              <View style={{ position: "absolute", left: 0, right: 0, top: (sticky.host !== null ? heights.host + sticky.hostShift : 0) + sticky.projectShift }}>{rowFor(tree.rows[sticky.project]!, sticky.project)}</View>
            ) : null}
            {sticky.host !== null && tree.rows[sticky.host] ? (
              <View style={{ position: "absolute", left: 0, right: 0, top: sticky.hostShift }}>{rowFor(tree.rows[sticky.host]!, sticky.host)}</View>
            ) : null}
          </View>
        ) : null}
        {peek && canPeek ? <NamesCard theme={theme} peek={peek} scale={scale} now={now} areaHeight={areaHeight} /> : null}
        <Toast theme={theme} toast={toast} onHide={hideToast} />
      </View>

      {colorFor ? (
        <ColorPicker
          theme={theme}
          target={colorFor}
          current={snapshot.colors[colorFor.key] ?? "default"}
          onPick={(id) => store.setColor(colorFor.key, id)}
          onClose={() => setColorFor(null)}
        />
      ) : null}
      {draftFor && !layout.compact ? <NewWorkspaceSheet theme={theme} project={draftFor} compact={false} onClose={() => setDraftFor(null)} onCreated={(id) => created(draftFor.serverId, id)} /> : null}
      {menuFor ? (
        <WorkspaceMenu
          theme={theme}
          compact={layout.compact}
          scale={scale}
          now={now}
          target={menuFor}
          profileId={profile.id}
          manual={settings.sort === "manual"}
          siblings={tree.groups[menuFor.row.group] ?? []}
          onMove={(direction) => step(menuFor.row.group, menuFor.row.workspace.id, direction)}
          onArchive={() => archive(menuFor.row)}
          onToast={showToast}
          onClose={() => setMenuFor(null)}
        />
      ) : null}
      {newProjectFor ? (
        <NewProjectSheet
          theme={theme}
          compact={layout.compact}
          hosts={newProjectFor.hosts}
          anchor={newProjectFor.anchor}
          onAdded={(serverId, workspaceId) => {
            setNewProjectFor(null);
            created(serverId, workspaceId);
          }}
          onClose={() => setNewProjectFor(null)}
        />
      ) : null}
      {projectFor ? (
        <ProjectMenu
          theme={theme}
          compact={layout.compact}
          scale={scale}
          now={now}
          row={projectFor.row}
          anchor={projectFor.anchor}
          manual={settings.sort === "manual"}
          siblings={tree.groups[projectFor.row.group] ?? []}
          onCreate={() => setDraftFor(projectFor.row)}
          onMove={(direction) => step(projectFor.row.group, projectFor.row.projectId, direction)}
          onPickColor={() => pickColor(projectFor.row)}
          onClose={() => setProjectFor(null)}
        />
      ) : null}
      {overlay?.kind === "inbox" ? (
        <InboxSheet
          theme={theme}
          compact={layout.compact}
          anchor={overlay.anchor}
          inbox={inbox}
          now={now}
          onOpen={openFromInbox}
          onMarkUnreadRead={() => {
            setOverlay(null);
            markInboxUnreadRead();
          }}
          onClose={closeInbox}
        />
      ) : null}
      {overlay?.kind === "hosts" ? (
        <HostMenu
          theme={theme}
          hosts={tree.hosts}
          value={tree.hostView}
          compact={layout.compact}
          anchor={overlay.anchor}
          colors={snapshot.colors}
          onChange={setHostView}
          onPickColor={pickHostColor}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === "options" ? (
        <OptionsMenu
          theme={theme}
          compact={layout.compact}
          anchor={overlay.anchor}
          platform={layout.platform}
          profile={profile}
          anyCollapsed={anyCollapsed}
          unread={inboxCounts.unread}
          onFoldAll={() => store.setCollapse(profile.id, expandOrCollapseAll(collapse, tree.groupKeys, settings))}
          onMarkUnreadRead={markInboxUnreadRead}
          onArrange={startArranging}
          onSettings={openSettings}
          onClose={() => setOverlay(null)}
        />
      ) : null}
    </View>
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
        <Pressable accessibilityRole="button" onPress={action.onPress} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, justifyContent: "center", backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foreground, fontWeight: "500" }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One list row's motion. While dragging: the carried rows follow the pointer (`follow`), the rows they
 * pass glide aside by `shift`. After the drop the list is drawn in its new order and the moved rows glide
 * from where they were let go (`landFrom`) into place, so nothing snaps back first.
 */
function Glide({ follow, shift, dragging, landFrom, children }: { follow: number | null; shift: number; dragging: boolean; landFrom: number | null; children: ReactNode }) {
  const offset = useRef(new Animated.Value(0)).current;
  // Before paint, so the first frame of the new order already has the right offsets.
  useLayoutEffect(() => {
    const glide = (toValue: number) => Animated.timing(offset, { toValue, duration: GLIDE_MS, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    if (follow !== null) {
      offset.setValue(follow);
      return;
    }
    if (landFrom !== null) {
      offset.setValue(landFrom);
      const land = glide(0);
      land.start();
      return () => land.stop();
    }
    if (!dragging) {
      offset.setValue(0);
      return;
    }
    const move = glide(shift);
    move.start();
    return () => move.stop();
  }, [follow, shift, dragging, landFrom, offset]);
  const raised = follow !== null || landFrom !== null;
  return <Animated.View style={{ transform: [{ translateY: offset }], zIndex: raised ? 20 : 0, elevation: raised ? 8 : 0 }}>{children}</Animated.View>;
}

interface RowProps {
  row: TreeRow;
  theme: PluginTheme;
  profile: Profile;
  comfortable: boolean;
  /** Interface font size over Paseo's default (1 = 14 px). */
  scale?: number;
  /** Phones and tablets: taller tap targets. */
  touch?: boolean;
  searching: boolean;
  now: number;
  canOpen: boolean;
  onToggle(key: string): void;
  onOpen(row: WorkspaceRow): void;
  onOpenTab?(row: TabRow): void;
  /** Phones in arrange mode: grips only, no tab marks. */
  arranging: boolean;
  onMenu(row: WorkspaceRow, anchor: Anchor | null): void;
  /** Hold (phones) or right-click (web) a tab row: its actions. */
  onTabMenu?(row: TabRow, anchor: Anchor | null): void;
  /** Hold (phones) or right-click (web) a project's name: its sheet. */
  onProjectMenu?(row: ProjectRow, anchor: Anchor | null): void;
  onCreate(row: ProjectRow): void;
  /** Colour id per project folder and host icon (`projectColorKey` / `hostColorKey`). */
  colors?: Readonly<Record<string, string>>;
  /** Long-press on a project's folder or a host's icon: choose its colour. */
  onPickColor?(row: ProjectRow | HostRow): void;
  /** Set while this row is picked up (any value): it is drawn raised. */
  lifted: number | null;
  /** Set in manual mode: responder handlers for the grip at the row's end. */
  dragHandle?: GestureResponderHandlers;
  /** Show (true) or hide the info card for this row (hover, desktop). */
  onPeek?: (show: boolean) => void;
  /** The workspace open in the app (sidebar view): drawn highlighted. */
  active?: boolean;
  /** Phones: swipe a workspace row left for Done ("read"), right to remove it from Recent or put it back. */
  onSwipeAction?(row: WorkspaceRow, action: "read" | "recent"): void;
}

function Grip({ theme, handlers, height, label, wide }: { theme: PluginTheme; handlers: GestureResponderHandlers; height: number; label: string; wide: boolean }) {
  return (
    <View
      {...handlers}
      accessibilityLabel={`Drag to reorder ${label}`}
      style={{ width: wide ? 44 : 24, height, alignItems: "center", justifyContent: "center", cursor: "grab", userSelect: "none", touchAction: "none" } as never}
    >
      <Icon name="GripVertical" size={wide ? 16 : 14} color={theme.colors.foregroundMuted} />
    </View>
  );
}

/** Right-click (web) opens a row's actions instead of the browser menu. */
function contextMenu(open: () => void) {
  if (Platform.OS !== "web") return {};
  return {
    onContextMenu: (event: { preventDefault(): void }) => {
      event.preventDefault();
      open();
    },
  } as object;
}

/** Hover handlers for the info card on the web; nothing elsewhere. */
function hoverProps(onPeek: ((show: boolean) => void) | undefined, touch: boolean) {
  if (!onPeek || touch) return {};
  return { onHoverIn: () => onPeek(true), onHoverOut: () => onPeek(false) };
}

const tallyWords = (tally: Tally) =>
  [tally.asking ? `${tally.asking} ask you` : "", tally.error ? `${tally.error} failed` : "", tally.unread ? `${tally.unread} unread` : ""]
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join("");

const WORKSPACE_MARK: Record<WorkspaceState, MarkKind> = { needs_you: "asking", error: "error", unread: "unread", running: "running", read: "read" };

export function Row({ row, theme, profile, comfortable, scale = 1, touch = false, searching, now, canOpen, onToggle, onOpen, onOpenTab, arranging, onMenu, onTabMenu, onProjectMenu, onCreate, colors, onPickColor, lifted, dragHandle, onPeek, active = false, onSwipeAction }: RowProps) {
  const c = theme.colors;
  const liftStyle =
    lifted !== null
      ? { opacity: 0.95, backgroundColor: c.surface2, borderRadius: 8, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }
      : null;
  const lines = profile.settings.lines;
  const { host: hostHeight, project: groupHeight, workspace: workspaceHeight, note: noteHeight, tab: tabHeight } = heightsFor(comfortable, scale, touch, lines.length);
  const anchorRef = useRef<View>(null);
  const menuRef = useRef<View>(null);
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const fontSize = fs(comfortable ? 15 : 14);
  const separator = { borderBottomWidth: 1, borderBottomColor: c.border };
  /** Trailing buttons: wider on touch screens. */
  const buttonWidth = touch ? 44 : 40;
  if (row.type === "host") {
    const online = row.state === "online";
    // Offline: name and "offline" stay readable; only the icon and chevron are dimmed.
    const dim = row.state === "offline" ? 0.45 : 1;
    return (
      // A thin divider, not a band: small caps label on the list background, so it never reads as a project.
      <View style={{ height: hostHeight, flexDirection: "row", alignItems: "center", backgroundColor: c.surface0, ...separator }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.label}${online ? `, ${row.count} workspaces${row.collapsed ? tallyWords(row.tally) : ""}` : row.state === "offline" ? ", offline" : ", loading"}`}
          accessibilityState={online ? { expanded: !row.collapsed } : { disabled: true }}
          accessibilityActions={[
            { name: "activate", label: row.collapsed ? "Expand" : "Collapse" },
            ...(onPickColor ? [{ name: "colour", label: "Host colour" }] : []),
          ]}
          onAccessibilityAction={(event) => (event.nativeEvent.actionName === "colour" ? onPickColor?.(row) : onToggle(row.key))}
          disabled={!online}
          onPress={() => onToggle(row.key)}
          style={{ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 }}
        >
          {/* Paseo's own host icon, in the 18pt left column so host and project names align; "offline"/"loading…" text carries the state.
              Long-press it to choose its colour; a tap still folds the host. */}
          <Pressable
            accessibilityLabel={`Host colour of ${row.label}`}
            accessibilityRole="button"
            onPress={() => onToggle(row.key)}
            onLongPress={onPickColor ? () => onPickColor(row) : undefined}
            {...contextMenu(() => onPickColor?.(row))}
            delayLongPress={400}
            hitSlop={13}
            style={{ width: 18, alignItems: "center", opacity: dim }}
          >
            <Icon name="Server" size={12} color={colorHex(colors?.[hostColorKey(row.serverId)], c.foregroundMuted)} />
          </Pressable>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foregroundMuted, fontWeight: "700", fontSize: fs(11), letterSpacing: 0.8, textTransform: "uppercase" }}>{row.label}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: fs(11) }}>{online ? row.count : row.state === "offline" ? "offline" : "loading…"}</Text>
          <View style={{ flex: 1 }} />
          {online && row.collapsed ? <TallyMarks theme={theme} tally={row.tally} size={11} /> : null}
          {online ? <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={c.foregroundMuted} /> : null}
        </Pressable>
      </View>
    );
  }

  if (row.type === "project") {
    const openProjectMenu = () => measureAnchor(anchorRef.current, (anchor) => onProjectMenu?.(row, anchor));
    const folder = colorHex(colors?.[projectColorKey(row.serverId, row.projectId)], c.accent);
    // A section heading: tinted band, folder icon, bold name and a coloured bar, so it never reads as a workspace.
    return (
      <View style={{ height: groupHeight, flexDirection: "row", alignItems: "center", paddingRight: row.rootPath || dragHandle ? 0 : 12, backgroundColor: c.surface1, borderTopWidth: 1, borderTopColor: c.border, ...separator, ...liftStyle }}>
      <View style={{ width: 3, alignSelf: "stretch", backgroundColor: row.tally.asking ? c.statusWarning : row.tally.error ? c.statusDanger : row.tally.unread ? unreadColor(theme) : folder, opacity: row.tally.asking || row.tally.error || row.tally.unread ? 1 : 0.55 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project ${row.name}, ${row.count} workspaces${row.collapsed ? tallyWords(row.tally) : ""}`}
        accessibilityState={{ expanded: !row.collapsed }}
        accessibilityActions={[
          { name: "activate", label: row.collapsed ? "Expand" : "Collapse" },
          { name: "actions", label: "Project actions" },
          ...(onPickColor ? [{ name: "colour", label: "Folder colour" }] : []),
        ]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === "actions") openProjectMenu();
          else if (action === "colour") onPickColor?.(row);
          else onToggle(row.key);
        }}
        onPress={() => onToggle(row.key)}
        style={{ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 9 }}
      >
        {/* Long-press the folder to choose its colour; a tap still folds the project. */}
        <Pressable
          accessibilityLabel={`Folder colour of ${row.name}`}
          accessibilityRole="button"
          onPress={() => onToggle(row.key)}
          onLongPress={onPickColor ? () => onPickColor(row) : undefined}
          {...contextMenu(() => onPickColor?.(row))}
          delayLongPress={400}
          hitSlop={13}
          style={{ width: 18, alignItems: "center" }}
        >
          <Icon name={row.collapsed ? "Folder" : "FolderOpen"} size={16} color={folder} />
        </Pressable>
        <Pressable
          ref={anchorRef}
          accessibilityRole="button"
          accessibilityLabel={`Project ${row.name}`}
          accessibilityHint={touch ? "Hold for project actions" : "Right-click for project actions"}
          onPress={() => onToggle(row.key)}
          onLongPress={openProjectMenu}
          delayLongPress={400}
          {...contextMenu(openProjectMenu)}
          {...hoverProps(onPeek, touch)}
          style={{ flexShrink: 1 }}
        >
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: fs(comfortable ? 15 : 14), fontWeight: "700", letterSpacing: 0.2 }}>{row.name}</Text>
        </Pressable>
        <View style={{ paddingHorizontal: 6, minWidth: 20, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: fs(11), fontWeight: "600" }}>{row.count}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {row.collapsed ? <TallyMarks theme={theme} tally={row.tally} /> : null}
        <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} />
      </Pressable>
        {row.rootPath && !arranging ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New workspace in ${row.name}`}
            onPress={() => onCreate(row)}
            hitSlop={{ left: 4 }}
            style={{ width: buttonWidth, height: groupHeight, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="Plus" size={16} color={c.foregroundMuted} />
          </Pressable>
        ) : null}
        {dragHandle ? <Grip theme={theme} handlers={dragHandle} height={groupHeight} label={row.name} wide={touch} /> : null}
      </View>
    );
  }

  if (row.type === "skeleton") {
    return (
      <View style={{ height: workspaceHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 12 }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.surface2 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 12, width: "70%", borderRadius: 6, backgroundColor: c.surface2 }} />
          <View style={{ height: 10, width: "45%", borderRadius: 5, backgroundColor: c.surface1 }} />
        </View>
      </View>
    );
  }

  if (row.type === "tab") {
    const openTabMenu = () => measureAnchor(anchorRef.current, (anchor) => onTabMenu?.(row, anchor));
    const hot = row.mark === "asking" || row.mark === "error" || row.mark === "unread";
    const kindLabel = row.kind === "terminal" ? "Terminal" : row.depth ? "Sub-agent" : "Chat";
    const subs = row.subagents;
    return (
      <View style={{ height: tabHeight, flexDirection: "row", alignItems: "center", backgroundColor: c.surface0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${kindLabel} ${row.title}, ${row.kind === "terminal" ? "terminal" : MARK_LABEL[row.mark].toLowerCase()}${row.modelShort ? `, ${row.modelShort}` : ""}`}
          ref={anchorRef}
          disabled={!canOpen && !onTabMenu}
          onPress={() => canOpen && onOpenTab?.(row)}
          onLongPress={openTabMenu}
          delayLongPress={400}
          accessibilityActions={[{ name: "longpress", label: "Actions" }]}
          onAccessibilityAction={() => openTabMenu()}
          {...contextMenu(openTabMenu)}
          {...hoverProps(onPeek, touch)}
          style={({ pressed }) => ({ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: row.depth ? 62 : 44, paddingRight: subs ? 4 : 12, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          <Mark theme={theme} kind={row.mark} size={13} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: fs(comfortable ? 14 : 13), fontWeight: hot ? "700" : "400" }}>{row.title}</Text>
          <Text numberOfLines={1} style={{ flex: 1, color: c.foregroundMuted, fontSize: fs(12) }}>{row.kind === "terminal" ? "Terminal" : `${row.depth ? "Sub-agent · " : ""}${row.modelShort}`}</Text>
        </Pressable>
        {subs ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${subs.open ? "Hide" : "Show"} ${subs.count} ${subs.count === 1 ? "sub-agent" : "sub-agents"} of ${row.title}${subs.waiting ? `, ${subs.waiting} waiting` : ""}`}
            accessibilityState={{ expanded: subs.open }}
            onPress={() => onToggle(subs.key)}
            style={{ minWidth: buttonWidth, height: tabHeight, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 8 }}
          >
            <Icon name="Bot" size={14} color={subs.waiting ? c.statusWarning : c.foregroundMuted} />
            <Text style={{ color: subs.waiting ? c.statusWarning : c.foregroundMuted, fontSize: fs(12), fontWeight: "600" }}>{subs.count}</Text>
            <Icon name={subs.open ? "ChevronDown" : "ChevronRight"} size={12} color={c.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (row.type === "note") {
    return (
      <View style={{ height: noteHeight, justifyContent: "center", paddingLeft: 46, paddingRight: 12 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: fs(13) }}>{row.text}</Text>
      </View>
    );
  }

  const { workspace } = row;
  const openMenu = () => measureAnchor(anchorRef.current, (anchor) => onMenu(row, anchor));
  const glyph = WORKSPACE_MARK[row.state];
  const metaSize = fs(comfortable ? 13 : 12);
  const urgent = row.state === "needs_you" || row.state === "error" || row.state === "unread";
  const muted = { color: c.foregroundMuted, fontSize: metaSize };
  /** One field's text (for screen readers) and how it is drawn; null when the row has no value for it. */
  const field = (name: RowField): { words: string; node: ReactNode } | null => {
    switch (name) {
      case "title":
        return { words: "", node: <Text key="title" numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize, fontWeight: urgent ? "700" : "500" }}>{workspace.title}</Text> };
      case "time": {
        const ago = timeAgo(workspace.activityAt, now);
        return ago ? { words: ago, node: <Text key="time" style={{ fontVariant: ["tabular-nums"] }}>{ago}</Text> } : null;
      }
      case "branch":
        return workspace.branch ? { words: workspace.branch, node: <Text key="branch" style={{ fontFamily: MONO_FONT, fontSize: fs(comfortable ? 12 : 11) }}>{workspace.branch}</Text> } : null;
      case "model":
        return row.modelShort ? { words: row.modelShort, node: <Text key="model">{row.modelShort}</Text> } : null;
      case "diff":
        if (!workspace.additions && !workspace.deletions) return null;
        return {
          words: `${workspace.additions} added, ${workspace.deletions} removed`,
          node: (
            <Text key="diff" style={{ fontVariant: ["tabular-nums"] }}>
              {workspace.additions ? <Text style={{ color: c.statusSuccess }}>{`+${workspace.additions}`}</Text> : null}
              {workspace.additions && workspace.deletions ? " " : ""}
              {workspace.deletions ? <Text style={{ color: c.statusDanger }}>{`−${workspace.deletions}`}</Text> : null}
            </Text>
          ),
        };
      case "reason":
        if (!row.reason) return null;
        return {
          words: `${MARK_LABEL[row.reason.state]}: ${row.reason.title}`,
          node: <Text key="reason" style={{ color: markColor(theme, row.reason.state), fontWeight: "600" }}>{`${MARK_LABEL[row.reason.state]} · ${row.reason.title}`}</Text>,
        };
      case "project":
        return { words: workspace.projectName, node: <Text key="project">{workspace.projectName}</Text> };
      case "host":
        return { words: row.hostLabel, node: <Text key="host">{row.hostLabel}</Text> };
    }
  };
  // Archiving or a search hit through a tab replaces the first line without the title (or the values beside it).
  const notice = row.archiving ? "Archiving…" : row.matchedTab ? `Matches ${row.matchedTab.kind} "${row.matchedTab.title}"` : "";
  const noticeLine = notice ? Math.max(0, lines.findIndex((line) => !line.includes("title"))) : -1;
  // In search results the host is named unless a line shows it already.
  const hostFirst = searching && !lines.some((line) => line.includes("host"));
  const words: string[] = [];
  const drawn = lines.map((line, index) => {
    const hasTitle = line.includes("title");
    let pieces = line.flatMap((name) => (name === "title" ? [] : [field(name)])).filter((piece) => piece !== null);
    if (index === noticeLine) pieces = [{ words: notice, node: <Text key="notice" style={{ fontStyle: "italic" }}>{notice}</Text> }];
    else if (hostFirst && index === (lines.length > 1 ? 1 : 0)) pieces.unshift({ words: row.hostLabel, node: <Text key="host">{row.hostLabel}</Text> });
    words.push(...pieces.map((piece) => piece.words));
    const rest = pieces.length ? (
      <Text key={index} numberOfLines={1} style={{ ...muted, ...(hasTitle ? { flexShrink: 0, maxWidth: "60%" } : null) }}>
        {pieces.flatMap((piece, at) => (at ? [" · ", piece.node] : [piece.node]))}
      </Text>
    ) : null;
    if (!hasTitle) return rest ?? <Text key={index} style={muted}> </Text>;
    // The title fills the line; values after it sit at the right end, values before it stay in front.
    const before = line.indexOf("title") > 0 && rest;
    return (
      <View key={index} style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        {before ? rest : null}
        {field("title")!.node}
        <View style={{ flex: 1 }} />
        {before ? null : rest}
      </View>
    );
  });
  const metaText = words.filter(Boolean).join(", ");
  const tabs = row.tabs && !arranging ? row.tabs : null;
  const swipe = touch && onSwipeAction && !arranging && lifted === null && !row.archiving;
  // The workspace open in the app, as the profile marks it (desktop only: phones never pass `active`).
  const marker = active ? profile.settings.openMarker.style : "none";
  const markerColor = colorHex(profile.settings.openMarker.color, c.accent);
  const body = (
    <View style={{ height: workspaceHeight, flexDirection: "row", alignItems: "center", backgroundColor: c.surface0, opacity: row.archiving ? 0.55 : 1, ...liftStyle }}>
      {marker === "tint" ? <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: markerColor, opacity: 0.16 }} /> : null}
      {marker === "outline" ? <View style={{ position: "absolute", top: 2, bottom: 2, left: 4, right: 4, borderRadius: 8, borderWidth: 1.5, borderColor: markerColor }} /> : null}
      {marker === "bar" ? <View style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, backgroundColor: markerColor }} /> : null}
      <Pressable
        ref={anchorRef}
        accessibilityRole="button"
        accessibilityLabel={`${row.pinned ? "Pinned, " : ""}${workspace.title}, ${row.archiving ? "archiving" : MARK_LABEL[glyph].toLowerCase()}${metaText ? `, ${metaText}` : ""}`}
        accessibilityHint={touch ? "Hold for actions" : undefined}
        disabled={row.archiving || (!canOpen && !touch)}
        onPress={() => canOpen && onOpen(row)}
        onLongPress={openMenu}
        delayLongPress={400}
        accessibilityActions={[
          { name: "longpress", label: "Actions" },
          ...(swipe ? [{ name: "read", label: "Mark read" }, { name: "recent", label: "Remove from or back to Recent" }] : []),
        ]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (swipe && (action === "read" || action === "recent")) onSwipeAction(row, action);
          else openMenu();
        }}
        {...contextMenu(openMenu)}
        {...hoverProps(onPeek, touch)}
        style={({ pressed }) => ({ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 20, paddingRight: tabs ? 0 : 12, backgroundColor: pressed && lifted === null ? c.surface1 : "transparent" })}
      >
        <View>
          <Mark theme={theme} kind={glyph} size={16} />
          {row.pinned ? (
            <View style={{ position: "absolute", right: -6, top: -6 }}>
              <Icon name="Pin" size={10} color={c.foregroundMuted} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: comfortable ? 4 : 2 }}>{drawn}</View>
      </Pressable>
      {tabs ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tabs.open ? "Hide" : "Show"} ${tabs.summary}`}
          accessibilityState={{ expanded: tabs.open }}
          onPress={() => onToggle(tabs.key)}
          style={({ pressed }) => ({ minWidth: buttonWidth, height: workspaceHeight, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, paddingHorizontal: 10, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          {tabs.marks.map((kind, index) => <Mark key={index} theme={theme} kind={kind} size={12} />)}
          {tabs.more ? <Text style={{ color: c.foregroundMuted, fontSize: fs(10.5) }}>{`+${tabs.more}`}</Text> : null}
          <View style={{ transform: [{ rotate: tabs.open ? "90deg" : "0deg" }] }}>
            <Icon name="ChevronRight" size={12} color={c.foregroundMuted} />
          </View>
        </Pressable>
      ) : null}
      {touch ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${workspace.title}`}
          ref={menuRef}
          onPress={() => measureAnchor(menuRef.current, (anchor) => onMenu(row, anchor))}
          style={{ width: 32, height: workspaceHeight, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="Ellipsis" size={16} color={c.foregroundMuted} />
        </Pressable>
      )}
      {dragHandle ? <Grip theme={theme} handlers={dragHandle} height={workspaceHeight} label={workspace.title} wide={touch} /> : null}
    </View>
  );
  if (!swipe) return body;
  return (
    <SwipeRow
      theme={theme}
      height={workspaceHeight}
      swipeLeft={canMarkWorkspaceRead(row) ? { icon: "CheckCheck", label: "Done", color: unreadColor(theme), onFire: () => onSwipeAction(row, "read") } : null}
      swipeRight={{ icon: "EyeOff", label: "Recent", color: c.foregroundMuted, onFire: () => onSwipeAction(row, "recent") }}
    >
      {body}
    </SwipeRow>
  );
}
