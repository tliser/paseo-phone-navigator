import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, Icon } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type GestureResponderHandlers } from "react-native";
import { timeAgo } from "../shared/format";
import { expandForAttention, expandOrCollapseAll, isCollapsed, toggleCollapsed, type Profile } from "../shared/profiles";
import { blockEnd, dragId, dragShift, heightsFor, rowOffsets, type DropTarget } from "../shared/drag";
import { inboxTally, type InboxEntry } from "../shared/inbox";
import { readAgentKey } from "../shared/reads";
import { buildTree, workspaceState, type ProjectRow, type TabRow, type Tally, type TreeRow, type WorkspaceRow } from "../shared/tree";
import type { Filter, WorkspaceState } from "../shared/types";
import { GLIDE_MS, useDragController } from "./drag-controller";
import { MONO_FONT, useFontScale } from "./font-scale";
import { NamesCard, type Peek } from "./names-card";
import { NewWorkspaceSheet } from "./new-workspace-sheet";
import { InboxSheet } from "./inbox-sheet";
import { OptionsMenu } from "./options-menu";
import { useActiveProfile, useInbox, useNavigatorStore, useTerminalTabs, withTerminals } from "./runtime";
import type { Anchor } from "./sheet";
import { SearchField, TitleBar, ViewsControl } from "./title-bar";
import { Toast, useToastState } from "./toast";
import { Mark, MARK_LABEL, markColor, TallyMarks, type MarkKind } from "./marks";
import { UNREAD_BLUE } from "./colors";
import { WorkspaceMenu } from "./workspace-menu";
import { ColorPicker } from "./color-picker";
import { projectColorHex, projectColorKey } from "../shared/colors";

/** Filter picked in this session per profile; starts at the profile's default. */
const sessionFilters = new Map<string, Filter>();

/**
 * A chat was opened from the Inbox on the phone screen: coming back to the screen reopens the Inbox.
 * The sidebar view leaves the plugin when it opens a chat, so it never sets this.
 */
let reopenInbox = false;

type Navigation = NonNullable<PluginScreenProps["navigation"]> & {
  /** Sidebar view only. */
  openTerminal?(input: { terminalId: string; workspaceId: string; serverId: string }): void;
};

export function NavigatorScreen(
  props: Omit<PluginScreenProps, "navigation"> & {
    navigation?: Navigation;
    openSettings(): void;
    activeWorkspace?: { serverId: string; workspaceId: string } | null;
    surface: "screen" | "sidebar";
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

  const [query, setQuery] = useState("");
  /** Open overlay of the title bar and where its button is (desktop popovers hang under it). */
  const [overlay, setOverlay] = useState<{ kind: "inbox" | "options"; anchor: Anchor | null } | null>(() => {
    if (!reopenInbox || !layout.compact || surface !== "screen") return null;
    reopenInbox = false;
    return { kind: "inbox", anchor: null };
  });
  const { toast, show: showToast, hide: hideToast } = useToastState();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Project whose new-workspace draft is open, and workspace whose menu is open. */
  const [draftFor, setDraftFor] = useState<ProjectRow | null>(null);
  const [menuFor, setMenuFor] = useState<WorkspaceRow | null>(null);
  const [colorFor, setColorFor] = useState<ProjectRow | null>(null);

  // Relative times stay fresh without re-rendering on every data tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const terminals = useTerminalTabs();
  const hosts = useMemo(() => withTerminals(snapshot.hosts, terminals), [snapshot.hosts, terminals]);
  const tree = useMemo(
    () => buildTree(hosts, { filter, query, settings, collapse, reads: snapshot.reads, order: profile.order, now, hostOrder: snapshot.hostOrder, pins }),
    [hosts, snapshot.hostOrder, snapshot.reads, profile.order, filter, query, settings, collapse, now, pins],
  );
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
      else if (navigation.openTerminal) navigation.openTerminal({ terminalId: row.id, workspaceId: row.workspaceId, serverId: row.serverId });
      else navigation.openWorkspace({ workspaceId: row.workspaceId, serverId: row.serverId });
    },
    [navigation],
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
    const marked = [...byHost].map(([serverId, ids]) => ({ serverId, ids, at: store.markChatsRead(serverId, ids) }));
    const count = marked.reduce((sum, entry) => sum + entry.ids.length, 0);
    showToast({
      text: `Marked ${count} unread ${count === 1 ? "chat" : "chats"} read`,
      undo: () => {
        const reads = store.getSnapshot().reads;
        for (const { serverId, ids, at } of marked) for (const id of ids) if (reads[readAgentKey(serverId, id)] === at) store.markChatUnread(serverId, id);
      },
    });
  };
  const openFromInbox = (entry: InboxEntry) => {
    setOverlay(null);
    if (!navigation) return;
    if (layout.compact && surface === "screen") reopenInbox = true;
    navigation.openAgent({ agentId: entry.agentId, serverId: entry.serverId });
  };
  const switchToManual = () => {
    const now = Date.now();
    const set = (sort: "auto" | "manual") => store.editProfiles((profiles) => profiles.map((entry) => (entry.id === profile.id ? { ...entry, settings: { ...entry.settings, sort }, updatedAt: now } : entry)));
    set("manual");
    showToast({ text: "Order is now manual", undo: () => set("auto") });
  };
  const closeSearch = () => setQuery("");
  const anyCollapsed = tree.groupKeys.some((key) => isCollapsed(collapse, key, settings));

  const comfortable = settings.density === "comfortable";
  const scale = useFontScale();
  const c = theme.colors;
  const searching = query.trim().length > 0;
  // Dragging only in manual mode and outside search (search reshapes the tree temporarily).
  const canArrange = settings.sort === "manual" && !searching;
  const heights = useMemo(() => heightsFor(comfortable, scale), [comfortable, scale]);

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
  // Rows are dragged by their grip: at once with a mouse, after a short hold on touch screens, so a
  // swipe that starts on the grip still scrolls.
  const touch = layout.platform !== "web";
  const drag = useDragController({ rows: tree.rows, heights, hold: touch, onDrop: drop });
  const dragging = drag.state;
  const shift = useMemo(() => (dragging ? dragShift(tree.rows, offsets, dragging.index, dragging.drop) : null), [dragging, tree.rows, offsets]);
  // After a drop the new order is drawn at once; the moved block glides from where it was let go.
  const landing = useMemo(() => {
    if (!drag.landing) return null;
    const index = tree.rows.findIndex((row) => row.key === drag.landing!.key);
    if (index === -1) return null;
    return { start: index, end: blockEnd(tree.rows, index), from: drag.landing.top - (offsets[index] ?? 0) };
  }, [drag.landing, tree.rows, offsets]);

  // Full names: on hover (desktop) or while long-pressing (phones).
  const [peek, setPeek] = useState<Peek | null>(null);
  const [areaHeight, setAreaHeight] = useState(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekAt = useCallback(
    (row: TreeRow, index: number, show: boolean, delay: number) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
      if (!show) {
        setPeek((current) => (current?.row.key === row.key ? null : current));
        return;
      }
      const place = () => setPeek({ row, top: (offsets[index + 1] ?? 0) - drag.scrollY(), rowTop: (offsets[index] ?? 0) - drag.scrollY() });
      if (delay) hoverTimer.current = setTimeout(place, delay);
      else place();
    },
    [offsets, drag],
  );
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const canPeek = settings.namesCard && !dragging;

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
          arranging={false}
          onMenu={setMenuFor}
          onCreate={setDraftFor}
          projectColors={snapshot.projectColors}
          onPickColor={setColorFor}
          canOpen={!!navigation}
          dragHandle={canArrange && dragId(item) ? drag.handleFor(index) : undefined}
          active={!!activeWorkspace && item.type === "workspace" && item.serverId === activeWorkspace.serverId && item.workspace.id === activeWorkspace.workspaceId}
          lifted={dragging?.index === index ? dragging.dy : null}
          onPeek={canPeek ? (show) => peekAt(item, index, show, touch ? 0 : 450) : undefined}
        />
      </Glide>
    );
  };

  const empty = snapshot.hosts.length === 0 ? (
    <EmptyState theme={theme} icon="Server" title="No hosts configured" text="Add a host in Paseo to see its workspaces here." />
  ) : tree.emptyBecauseFiltered ? (
    <EmptyState
      theme={theme}
      icon="Search"
      title={query.trim() ? `No workspaces match "${query.trim()}"` : filter === "pinned" ? "Nothing pinned" : filter === "recent" ? `Nothing active in the last ${settings.recentDays === 1 ? "day" : `${settings.recentDays} days`}` : "Nothing running, new or asking"}
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
          theme={theme}
          compact={layout.compact}
          inbox={inboxCounts}
          running={tree.running}
          scale={scale}
          onInbox={(anchor) => setOverlay({ kind: "inbox", anchor })}
          onRunning={() => setFilter("active")}
          onOptions={(anchor) => setOverlay({ kind: "options", anchor })}
        />
        {/* Search sits at the top on desktop and docks at the bottom on phones (thumb reach). */}
        {layout.compact ? null : <SearchField theme={theme} query={query} onChange={setQuery} />}
        <ViewsControl theme={theme} value={filter} counts={tree.counts} compact={layout.compact} onChange={setFilter} />
      </View>

      {snapshot.errors.length || snapshot.savingError ? (
        <Text style={{ fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, color: c.statusDanger }} numberOfLines={3}>
          {[...snapshot.errors, ...(snapshot.savingError ? [snapshot.savingError] : [])].join("\n")}
        </Text>
      ) : null}

      {/* While a row is dragged, the text it passes must not get selected (web/desktop). */}
      <View style={{ flex: 1, ...(dragging ? { userSelect: "none" } : null) } as never} {...drag.handlers} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
        <FlatList
          data={tree.rows}
          extraData={[dragging, landing, canPeek, scale, canArrange, profile]}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          ListFooterComponent={empty}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!dragging}
          onScroll={(event) => {
            drag.setScrollY(event.nativeEvent.contentOffset.y);
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
        {peek && canPeek ? <NamesCard theme={theme} peek={peek} scale={scale} now={now} areaHeight={areaHeight} /> : null}
        <Toast theme={theme} toast={toast} onHide={hideToast} />
      </View>
      {layout.compact ? (
        <View style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface0 }}>
          <SearchField theme={theme} query={query} onChange={setQuery} />
        </View>
      ) : null}

      {colorFor ? (
        <ColorPicker
          theme={theme}
          name={colorFor.name}
          current={snapshot.projectColors[projectColorKey(colorFor.serverId, colorFor.projectId)] ?? "default"}
          onPick={(id) => store.setProjectColor(colorFor.serverId, colorFor.projectId, id)}
          onClose={() => setColorFor(null)}
        />
      ) : null}
      {draftFor && !layout.compact ? <NewWorkspaceSheet theme={theme} project={draftFor} compact={false} onClose={() => setDraftFor(null)} onCreated={(id) => created(draftFor.serverId, id)} /> : null}
      {menuFor ? <WorkspaceMenu theme={theme} row={menuFor} profileId={profile.id} onClose={() => setMenuFor(null)} /> : null}
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
          onManualOrder={switchToManual}
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
  onMenu(row: WorkspaceRow): void;
  onCreate(row: ProjectRow): void;
  /** Folder colour id per project ("serverId:projectId"). */
  projectColors?: Readonly<Record<string, string>>;
  /** Long-press on a project's folder icon: choose its colour. */
  onPickColor?(row: ProjectRow): void;
  /** Set while this row is picked up (any value): it is drawn raised. */
  lifted: number | null;
  /** Set in manual mode: responder handlers for the grip at the row's end. */
  dragHandle?: GestureResponderHandlers;
  /** Show (true) or hide the full-names card for this row (hover, desktop). */
  onPeek?: (show: boolean) => void;
  /** The workspace open in the app (sidebar view): drawn highlighted. */
  active?: boolean;
}

function Grip({ theme, handlers, height, label, wide }: { theme: PluginTheme; handlers: GestureResponderHandlers; height: number; label: string; wide: boolean }) {
  return (
    <View
      {...handlers}
      accessibilityLabel={`Drag to reorder ${label}`}
      accessibilityHint={wide ? "Hold, then drag" : undefined}
      style={{ width: wide ? 36 : 24, height, alignItems: "center", justifyContent: "center", cursor: "grab", userSelect: "none", touchAction: "none" } as never}
    >
      <Icon name="GripVertical" size={wide ? 16 : 14} color={theme.colors.foregroundMuted} />
    </View>
  );
}

/** Hover handlers for the names card on the web; nothing elsewhere. */
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

export function Row({ row, theme, profile, comfortable, scale = 1, touch = false, searching, now, canOpen, onToggle, onOpen, onOpenTab, arranging, onMenu, onCreate, projectColors, onPickColor, lifted, dragHandle, onPeek, active = false }: RowProps) {
  const c = theme.colors;
  const liftStyle =
    lifted !== null
      ? { opacity: 0.95, backgroundColor: c.surface2, borderRadius: 8, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }
      : null;
  const { group: groupHeight, workspace: workspaceHeight, note: noteHeight, tab: tabHeight } = heightsFor(comfortable, scale);
  const [metaWidth, setMetaWidth] = useState(0);
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const fontSize = fs(comfortable ? 15 : 14);
  const separator = { borderBottomWidth: 1, borderBottomColor: c.border };
  /** Trailing buttons: wider on touch screens. */
  const buttonWidth = touch ? 44 : 40;
  if (row.type === "host") {
    const online = row.state === "online";
    // Offline: name and "offline" stay readable; only the dot and chevron are dimmed.
    const dim = row.state === "offline" ? 0.45 : 1;
    const dot = row.state === "online" ? c.statusSuccess : row.state === "loading" ? c.statusWarning : c.foregroundMuted;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.label}${online ? `, ${row.count} workspaces${row.collapsed ? tallyWords(row.tally) : ""}` : row.state === "offline" ? ", offline" : ", loading"}`}
        accessibilityState={online ? { expanded: !row.collapsed } : { disabled: true }}
        disabled={!online}
        onPress={() => onToggle(row.key)}
        style={{ height: groupHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12, backgroundColor: c.surface1, ...separator }}
      >
        {/* Status dot in the 18pt left column so host and project names align; the chevron moves to the trailing end. */}
        <View style={{ width: 18, alignItems: "center", opacity: dim }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontWeight: "600", fontSize }}>{row.label}</Text>
        {online ? <Text style={{ color: c.foregroundMuted, fontSize: fs(12) }}>{row.count}</Text> : <Text style={{ color: c.foregroundMuted, fontSize: fs(12) }}>{row.state === "offline" ? "offline" : "loading…"}</Text>}
        {online && row.collapsed ? <TallyMarks theme={theme} tally={row.tally} /> : null}
        {online ? <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} /> : null}
      </Pressable>
    );
  }

  if (row.type === "project") {
    const folder = projectColorHex(projectColors?.[projectColorKey(row.serverId, row.projectId)], c.accent);
    // A section heading: tinted band, folder icon, bold name and a coloured bar, so it never reads as a workspace.
    return (
      <View style={{ height: groupHeight, flexDirection: "row", alignItems: "center", paddingRight: row.rootPath || dragHandle ? 0 : 12, backgroundColor: c.surface1, borderTopWidth: 1, borderTopColor: c.border, ...separator, ...liftStyle }}>
      <View style={{ width: 3, alignSelf: "stretch", backgroundColor: row.tally.asking ? c.statusWarning : row.tally.error ? c.statusDanger : row.tally.unread ? UNREAD_BLUE : folder, opacity: row.tally.asking || row.tally.error || row.tally.unread ? 1 : 0.55 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project ${row.name}, ${row.count} workspaces${row.collapsed ? tallyWords(row.tally) : ""}`}
        accessibilityState={{ expanded: !row.collapsed }}
        onPress={() => onToggle(row.key)}
        style={{ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 9 }}
      >
        {/* Long-press the folder to choose its colour; a tap still folds the project. */}
        <Pressable
          accessibilityLabel={`Folder colour of ${row.name}`}
          onPress={() => onToggle(row.key)}
          onLongPress={onPickColor ? () => onPickColor(row) : undefined}
          delayLongPress={400}
          hitSlop={8}
          style={{ width: 18, alignItems: "center" }}
        >
          <Icon name={row.collapsed ? "Folder" : "FolderOpen"} size={16} color={folder} />
        </Pressable>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: fs(comfortable ? 15 : 14), fontWeight: "700", letterSpacing: 0.2 }}>{row.name}</Text>
        <View style={{ paddingHorizontal: 6, minWidth: 20, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: fs(11), fontWeight: "600" }}>{row.count}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {row.collapsed ? <TallyMarks theme={theme} tally={row.tally} /> : null}
        <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} />
      </Pressable>
        {row.rootPath ? (
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
    const hot = row.mark === "asking" || row.mark === "error" || row.mark === "unread";
    const kindLabel = row.kind === "terminal" ? "Terminal" : row.depth ? "Sub-agent" : "Chat";
    const subs = row.subagents;
    return (
      <View style={{ height: tabHeight, flexDirection: "row", alignItems: "center", backgroundColor: c.surface0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${kindLabel} ${row.title}, ${row.kind === "terminal" ? "terminal" : MARK_LABEL[row.mark].toLowerCase()}${row.modelShort ? `, ${row.modelShort}` : ""}`}
          disabled={!canOpen}
          onPress={() => onOpenTab?.(row)}
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
  const settings = profile.settings;
  const show = settings.show;
  const glyph = WORKSPACE_MARK[row.state];
  const metaSize = fs(comfortable ? 13 : 12);
  const ago = show.time ? timeAgo(workspace.activityAt, now) : "";
  // The second line: why search found it, else why it needs you, else the profile's values in its order.
  let meta: ReactNode = null;
  let metaText = "";
  if (row.archiving) {
    metaText = "Archiving…";
    meta = <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: metaSize, fontStyle: "italic" }}>{metaText}</Text>;
  } else if (row.matchedTab) {
    metaText = `Matches ${row.matchedTab.kind} "${row.matchedTab.title}"`;
    meta = <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: metaSize, fontStyle: "italic" }}>{metaText}</Text>;
  } else if (settings.statusLine && row.reason) {
    metaText = `${MARK_LABEL[row.reason.state]} · ${row.reason.title}`;
    meta = <Text numberOfLines={1} style={{ color: markColor(theme, row.reason.state), fontSize: metaSize, fontWeight: "600" }}>{metaText}</Text>;
  } else {
    const branch = show.branch && workspace.branch ? workspace.branch : "";
    // Narrow rows drop the model rather than cut it to a stub; the branch shows in full.
    const charWidth = metaSize * 0.58;
    const modelFits = !metaWidth || metaWidth - (branch.length + 3) * charWidth >= 7 * charWidth;
    const pieces: ReactNode[] = [];
    const words: string[] = [];
    for (const field of settings.fieldOrder) {
      if (field === "branch" && branch) {
        pieces.push(<Text key="branch" style={{ fontFamily: MONO_FONT, fontSize: fs(comfortable ? 12 : 11) }}>{branch}</Text>);
        words.push(branch);
      } else if (field === "model" && show.model && row.modelShort && modelFits) {
        pieces.push(<Text key="model">{row.modelShort}</Text>);
        words.push(row.modelShort);
      } else if (field === "diff" && show.diff && (workspace.additions || workspace.deletions)) {
        pieces.push(
          <Text key="diff" style={{ fontVariant: ["tabular-nums"] }}>
            {workspace.additions ? <Text style={{ color: c.statusSuccess }}>{`+${workspace.additions}`}</Text> : null}
            {workspace.additions && workspace.deletions ? " " : ""}
            {workspace.deletions ? <Text style={{ color: c.statusDanger }}>{`−${workspace.deletions}`}</Text> : null}
          </Text>,
        );
        words.push(`${workspace.additions} added, ${workspace.deletions} removed`);
      }
    }
    if (searching) words.unshift(row.hostLabel);
    metaText = words.join(", ");
    meta = pieces.length ? (
      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: metaSize }}>
        {searching ? `${row.hostLabel} · ` : ""}
        {pieces.flatMap((piece, index) => (index ? [" · ", piece] : [piece]))}
      </Text>
    ) : null;
  }
  const tabs = row.tabs && !arranging ? row.tabs : null;
  const urgent = row.state === "needs_you" || row.state === "error" || row.state === "unread";
  return (
    <View style={{ height: workspaceHeight, flexDirection: "row", alignItems: "center", backgroundColor: active ? c.surface2 : c.surface0, opacity: row.archiving ? 0.55 : 1, ...liftStyle }}>
      {active ? <View style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, backgroundColor: c.accent }} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.pinned ? "Pinned, " : ""}${workspace.title}, ${row.archiving ? "archiving" : MARK_LABEL[glyph].toLowerCase()}${metaText ? `, ${metaText}` : ""}`}
        accessibilityHint={touch ? "Hold for actions" : undefined}
        disabled={row.archiving || (!canOpen && !touch)}
        onPress={() => canOpen && onOpen(row)}
        {...(touch ? { onLongPress: () => onMenu(row), delayLongPress: 400 } : {})}
        {...hoverProps(onPeek, touch)}
        style={({ pressed }) => ({ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 20, paddingRight: 4, backgroundColor: pressed && lifted === null ? c.surface1 : "transparent" })}
      >
        <View>
          <Mark theme={theme} kind={glyph} size={16} />
          {row.pinned ? (
            <View style={{ position: "absolute", right: -6, top: -6 }}>
              <Icon name="Pin" size={10} color={c.foregroundMuted} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: comfortable ? 4 : 2 }} onLayout={(event) => setMetaWidth(Math.round(event.nativeEvent.layout.width))}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize, fontWeight: urgent ? "700" : "500" }}>{workspace.title}</Text>
          {meta}
        </View>
      </Pressable>
      {tabs ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tabs.open ? "Hide" : "Show"} ${tabs.summary}`}
          accessibilityState={{ expanded: tabs.open }}
          onPress={() => onToggle(tabs.key)}
          style={({ pressed }) => ({ minWidth: buttonWidth, height: workspaceHeight, alignItems: "flex-end", justifyContent: "center", gap: 4, paddingHorizontal: 10, backgroundColor: pressed ? c.surface1 : "transparent" })}
        >
          {ago ? <Text style={{ color: c.foregroundMuted, fontSize: fs(11.5), fontVariant: ["tabular-nums"] }}>{ago}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            {tabs.marks.map((kind, index) => <Mark key={index} theme={theme} kind={kind} size={12} />)}
            {tabs.more ? <Text style={{ color: c.foregroundMuted, fontSize: fs(10.5) }}>{`+${tabs.more}`}</Text> : null}
            <View style={{ transform: [{ rotate: tabs.open ? "90deg" : "0deg" }] }}>
              <Icon name="ChevronRight" size={12} color={c.foregroundMuted} />
            </View>
          </View>
        </Pressable>
      ) : ago && !arranging ? (
        <Text style={{ paddingHorizontal: 10, color: c.foregroundMuted, fontSize: fs(11.5), fontVariant: ["tabular-nums"] }}>{ago}</Text>
      ) : null}
      {touch ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${workspace.title}`}
          onPress={() => onMenu(row)}
          style={{ width: 28, height: workspaceHeight, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="Ellipsis" size={16} color={c.foregroundMuted} />
        </Pressable>
      )}
      {dragHandle ? <Grip theme={theme} handlers={dragHandle} height={workspaceHeight} label={workspace.title} wide={touch} /> : null}
    </View>
  );
}
