import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type GestureResponderHandlers } from "react-native";
import { timeAgo } from "../shared/format";
import { expandOrCollapseAll, isCollapsed, toggleCollapsed, type Profile } from "../shared/profiles";
import { blockEnd, dragId, dragShift, heightsFor, rowOffsets, type DropTarget } from "../shared/drag";
import { buildTree, type AgentRow, type ProjectRow, type TreeRow, type WorkspaceRow } from "../shared/tree";
import { FILTERS, type Filter } from "../shared/types";
import { GLIDE_MS, useDragController } from "./drag-controller";
import { MONO_FONT, useFontScale } from "./font-scale";
import { NamesCard, type Peek } from "./names-card";
import { NewWorkspaceSheet } from "./new-workspace-sheet";
import { ProfileSheet } from "./profile-sheet";
import { useActiveProfile, useNavigatorStore } from "./runtime";
import { RUNNING_VIOLET, StateIcon, TallyBadge, UNREAD_BLUE } from "./visual";
import { WorkspaceMenu } from "./workspace-menu";

const FILTER_LABEL: Record<Filter, string> = { all: "All", recent: "Recent", active: "Active", inbox: "Inbox" };

/** Filter picked in this session per profile; starts at the profile's default. */
const sessionFilters = new Map<string, Filter>();

export function NavigatorScreen(props: PluginScreenProps & { openSettings(): void }) {
  const { theme, layout, navigation, openSettings } = props;
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Project whose new-workspace draft is open, and workspace whose menu is open. */
  const [draftFor, setDraftFor] = useState<ProjectRow | null>(null);
  const [menuFor, setMenuFor] = useState<WorkspaceRow | null>(null);

  // Relative times stay fresh without re-rendering on every data tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const tree = useMemo(
    () => buildTree(snapshot.hosts, { filter, query, settings, collapse, reads: snapshot.reads, order: profile.order, now, hostOrder: snapshot.hostOrder, pins }),
    [snapshot.hosts, snapshot.hostOrder, snapshot.reads, profile.order, filter, query, settings, collapse, now, pins],
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
  const openAgent = useCallback(
    (row: AgentRow) => {
      if (!navigation) return;
      navigation.openAgent({ agentId: row.agent.id, serverId: row.serverId });
      store.markRead(row.serverId, [row.workspaceId]);
    },
    [navigation, store],
  );
  const created = useCallback(
    (serverId: string, workspaceId: string) => {
      setDraftFor(null);
      store.markRead(serverId, [workspaceId]);
      navigation?.openWorkspace({ workspaceId, serverId });
    },
    [store, navigation],
  );
  const unreadIds = (serverId: string | null) =>
    tree.rows.flatMap((row) => (row.type === "workspace" && row.state === "unread" && (!serverId || row.serverId === serverId) ? [row] : []));
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  const anyCollapsed = tree.groupKeys.some((key) => isCollapsed(collapse, key, settings));

  const comfortable = settings.density === "comfortable";
  const scale = useFontScale();
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const c = theme.colors;
  const muted = { color: c.foregroundMuted };
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
          onOpenAgent={openAgent}
          onMenu={setMenuFor}
          onCreate={setDraftFor}
          canOpen={!!navigation}
          dragHandle={canArrange && dragId(item) ? drag.handleFor(index) : undefined}
          lifted={dragging?.index === index ? dragging.dy : null}
          onPeek={canPeek ? (show) => peekAt(item, index, show, touch ? 0 : 600) : undefined}
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
      title={query.trim() ? `No workspaces match "${query.trim()}"` : filter === "inbox" ? "Inbox zero: nothing new, nothing asking" : filter === "recent" ? `Nothing active in the last ${settings.recentDays === 1 ? "day" : `${settings.recentDays} days`}` : "Nothing running, new or asking"}
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
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
                {tree.tally.needsYou || tree.tally.unread ? <TallyBadge theme={theme} tally={tree.tally} small /> : <Text style={{ fontSize: fs(13), color: c.foregroundMuted }}>0</Text>}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Filter: ${FILTER_LABEL[filter]}`} onPress={() => setMenu((value) => !value)} style={{ height: 44, justifyContent: "center", marginLeft: 4 }}>
              <View style={{ height: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ fontSize: fs(13), color: c.foreground }}>{FILTER_LABEL[filter]}</Text>
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
                <Text numberOfLines={1} style={{ fontSize: fs(13), color: c.foreground, flexShrink: 1 }}>{profile.name}</Text>
                <Icon name="ChevronDown" size={14} color={c.foregroundMuted} />
              </View>
            </Pressable>
          </View>
        )}
        {menu && !searchOpen ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
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
      </View>

      {draftFor ? <NewWorkspaceSheet theme={theme} project={draftFor} onClose={() => setDraftFor(null)} onCreated={(id) => created(draftFor.serverId, id)} /> : null}
      {menuFor ? <WorkspaceMenu theme={theme} row={menuFor} profileId={profile.id} onClose={() => setMenuFor(null)} /> : null}
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
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} hitSlop={{ top: 6, bottom: 6 }} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: "center", borderWidth: 1, borderColor: active ? c.foreground : c.border, backgroundColor: active ? c.foreground : c.surface1 }}>
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
  onOpenAgent?(row: AgentRow): void;
  onMenu(row: WorkspaceRow): void;
  onCreate(row: ProjectRow): void;
  /** Set while this row is picked up (any value): it is drawn raised. */
  lifted: number | null;
  /** Set in manual mode: responder handlers for the grip at the row's end. */
  dragHandle?: GestureResponderHandlers;
  /** Show (true) or hide the full-names card for this row: hover on desktop, long-press on phones. */
  onPeek?: (show: boolean) => void;
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

export function Row({ row, theme, profile, comfortable, scale = 1, touch = false, searching, now, canOpen, onToggle, onOpen, onOpenAgent, onMenu, onCreate, lifted, dragHandle, onPeek }: RowProps) {
  const c = theme.colors;
  const liftStyle =
    lifted !== null
      ? { opacity: 0.95, backgroundColor: c.surface2, borderRadius: 8, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }
      : null;
  const { group: groupHeight, workspace: workspaceHeight, note: noteHeight, agent: agentHeight } = heightsFor(comfortable, scale);
  const fs = (size: number) => Math.round(size * scale * 2) / 2;
  const fontSize = fs(comfortable ? 15 : 14);
  const separator = { borderBottomWidth: 1, borderBottomColor: c.border };
  /** Trailing buttons: wider on touch screens. */
  const buttonWidth = touch ? 44 : 40;
  if (row.type === "pinned") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Pinned, ${row.count} workspaces`}
        accessibilityState={{ expanded: !row.collapsed }}
        onPress={() => onToggle(row.key)}
        style={{ height: groupHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12, backgroundColor: c.surface1, ...separator }}
      >
        <View style={{ width: 18, alignItems: "center" }}>
          <Icon name="Pin" size={14} color={c.foregroundMuted} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontWeight: "600", fontSize }}>Pinned</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: fs(12) }}>{row.count}</Text>
        <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} />
      </Pressable>
    );
  }

  if (row.type === "host") {
    const online = row.state === "online";
    // Offline: name and "offline" stay readable; only the dot and chevron are dimmed.
    const dim = row.state === "offline" ? 0.45 : 1;
    const dot = row.state === "online" ? c.statusSuccess : row.state === "loading" ? c.statusWarning : c.foregroundMuted;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.label}${online ? `, ${row.count} workspaces` : row.state === "offline" ? ", offline" : ", loading"}`}
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
        {online ? <TallyBadge theme={theme} tally={row.tally} /> : null}
        {online ? <Icon name={row.collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={c.foregroundMuted} /> : null}
      </Pressable>
    );
  }

  if (row.type === "project") {
    // A section heading: tinted band, folder icon, bold name and a coloured bar, so it never reads as a workspace.
    return (
      <View style={{ height: groupHeight, flexDirection: "row", alignItems: "center", paddingRight: row.rootPath || dragHandle ? 0 : 12, backgroundColor: c.surface1, borderTopWidth: 1, borderTopColor: c.border, ...separator, ...liftStyle }}>
      <View style={{ width: 3, alignSelf: "stretch", backgroundColor: row.tally.needsYou ? c.statusWarning : row.tally.unread ? UNREAD_BLUE : c.accent, opacity: row.tally.needsYou || row.tally.unread ? 1 : 0.55 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project ${row.name}, ${row.count} workspaces${row.collapsed && row.tally.needsYou ? ", something asks you" : row.collapsed && row.tally.unread ? ", unread" : ""}`}
        accessibilityState={{ expanded: !row.collapsed }}
        onPress={() => onToggle(row.key)}
        style={{ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 9 }}
      >
        <View style={{ width: 18, alignItems: "center" }}>
          <Icon name={row.collapsed ? "Folder" : "FolderOpen"} size={16} color={c.accent} />
        </View>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: fs(comfortable ? 15 : 14), fontWeight: "700", letterSpacing: 0.2 }}>{row.name}</Text>
        <View style={{ paddingHorizontal: 6, minWidth: 20, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: fs(11), fontWeight: "600" }}>{row.count}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {row.collapsed ? <TallyBadge theme={theme} tally={row.tally} small /> : null}
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

  if (row.type === "agent") {
    const { agent } = row;
    const look =
      agent.status === "asking"
        ? { icon: "MessageCircleQuestion", color: c.statusWarning, label: "asking you" }
        : agent.status === "running"
          ? { icon: "LoaderCircle", color: RUNNING_VIOLET, label: "running" }
          : agent.status === "failed"
            ? { icon: "CircleX", color: c.statusDanger, label: "failed" }
            : agent.status === "finished"
              ? { icon: "CircleDot", color: UNREAD_BLUE, label: "finished" }
              : { icon: "Bot", color: c.foregroundMuted, label: "idle" };
    const ago = timeAgo(agent.activityAt, now);
    const meta = [row.modelShort, ago].filter(Boolean).join(" · ");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Agent ${agent.title}, ${look.label}${meta ? `, ${meta}` : ""}`}
        disabled={!canOpen}
        onPress={() => onOpenAgent?.(row)}
        style={({ pressed }) => ({ height: agentHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 29, paddingRight: 12, backgroundColor: pressed ? c.surface1 : c.surface0 })}
      >
        {/* Thread line from the workspace's icon down to its agents. */}
        <View style={{ width: 1, alignSelf: "stretch", backgroundColor: c.border, marginRight: 6 }} />
        <Icon name={look.icon} size={14} color={look.color} />
        <Text numberOfLines={1} style={{ flex: 1, color: agent.status === "idle" ? c.foregroundMuted : c.foreground, fontSize: fs(comfortable ? 14 : 13), fontWeight: agent.status === "asking" || agent.status === "finished" || agent.status === "failed" ? "600" : "400" }}>{agent.title}</Text>
        {meta ? <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: "45%", color: c.foregroundMuted, fontSize: fs(12) }}>{meta}</Text> : null}
      </Pressable>
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
  const show = profile.settings.show;
  const parts: string[] = [];
  // In the Pinned section a row names where it lives; in search it names its host.
  if (row.inPinned) parts.push(`${workspace.projectName} · ${row.hostLabel}`);
  else if (searching) parts.push(row.hostLabel);
  // The branch is drawn in monospace before the other details.
  const branch = show.branch && workspace.branch ? workspace.branch : null;
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
        accessibilityLabel={`${row.pinned ? "Pinned, " : ""}${workspace.title}, ${row.state === "needs_you" ? "asking you" : row.state === "unread" ? "unread" : row.state}, ${[branch, ...parts].filter(Boolean).join(", ")}`}
        accessibilityHint={onPeek && touch ? "Long press to see full names" : undefined}
        disabled={!canOpen && !onPeek}
        onPress={() => canOpen && onOpen(row)}
        {...(onPeek && touch ? { onLongPress: () => onPeek(true), onPressOut: () => onPeek(false), delayLongPress: 400 } : {})}
        {...hoverProps(onPeek, touch)}
        style={({ pressed }) => ({ flex: 1, height: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, backgroundColor: pressed && lifted === null ? c.surface1 : "transparent" })}
      >
        <View>
          <StateIcon theme={theme} state={row.state} status={workspace.status} />
          {row.pinned ? (
            <View accessibilityLabel="Pinned" style={{ position: "absolute", right: -5, top: -5 }}>
              <Icon name="Pin" size={10} color={c.foregroundMuted} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: comfortable ? 4 : 2 }}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize, fontWeight: row.state === "unread" || row.state === "needs_you" ? "700" : "400" }}>{workspace.title}</Text>
          {parts.length || branch || hasDiff ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* Meta truncates first; the diff keeps its width at the right end. */}
              <Text numberOfLines={1} style={{ flex: 1, color: c.foregroundMuted, fontSize: fs(comfortable ? 13 : 12) }}>
                {branch ? <Text style={{ fontFamily: MONO_FONT, fontSize: fs(comfortable ? 12 : 11) }}>{branch}</Text> : null}
                {branch && parts.length ? " · " : ""}
                {parts.join(" · ")}
              </Text>
              {hasDiff ? (
                <Text style={{ flexShrink: 0, fontSize: fs(11.5), fontVariant: ["tabular-nums"] }}>
                  <Text style={{ color: c.statusSuccess }}>{`+${workspace.additions}`}</Text>
                  <Text style={{ color: c.statusDanger }}>{` −${workspace.deletions}`}</Text>
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
      {row.agentsKey ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.agentsOpen ? "Hide" : "Show"} ${workspace.agents?.length ?? 0} agents of ${workspace.title}`}
          accessibilityState={{ expanded: !!row.agentsOpen }}
          onPress={() => onToggle(row.agentsKey!)}
          style={{ height: workspaceHeight, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, height: 22, borderRadius: 11, backgroundColor: row.agentsOpen ? c.surface2 : "transparent", borderWidth: 1, borderColor: c.border }}>
            <Icon name="Bot" size={12} color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: fs(11), fontWeight: "600" }}>{workspace.agents?.length ?? 0}</Text>
            <Icon name={row.agentsOpen ? "ChevronUp" : "ChevronDown"} size={12} color={c.foregroundMuted} />
          </View>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${workspace.title}`}
        onPress={() => onMenu(row)}
        hitSlop={{ left: 4 }}
        style={{ width: buttonWidth, height: workspaceHeight, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="Ellipsis" size={16} color={row.state === "unread" ? UNREAD_BLUE : c.foregroundMuted} />
      </Pressable>
      {dragHandle ? <Grip theme={theme} handlers={dragHandle} height={workspaceHeight} label={workspace.title} wide={touch} /> : null}
    </View>
  );
}
