// Which chat is on screen, the chats visited (back and forward), and how to open a chat from anywhere.
// While the plugin's sidebar view is mounted it publishes Paseo's active chat, which is authoritative.
// Otherwise plugins are not told which chat is open, but a composer pill's icon renders inside its chat's
// composer, so the icons report their chat here. The app keeps chats mounted that are not on screen (other
// tabs on desktop, earlier screens in a phone's stack); the icons also report when they are hidden or
// shown again (a hidden tab lays out with no size). The open chat is the visible one shown most recently.
// Shared on globalThis: each host runs its own copy of the plugin, and history spans every host. The shape
// is a contract between plugin versions: change it together with the key.
import { useEffect, useMemo, useRef } from "react";

const KEY = "__workspaceOrganizer.chatNav.v3";
const MAX_HISTORY = 50;

/** "serverId:agentId". */
export type ChatKey = string;

export const chatKey = (serverId: string, agentId: string): ChatKey => `${serverId}:${agentId}`;

export function splitChatKey(key: ChatKey): { serverId: string; agentId: string } {
  const at = key.indexOf(":");
  return { serverId: key.slice(0, at), agentId: key.slice(at + 1) };
}

interface Shown {
  key: ChatKey;
  visible: boolean;
  shownAt: number;
}

type Opener = (serverId: string, agentId: string) => void;

interface ChatNav {
  icons: Set<Shown>;
  counter: number;
  listeners: Set<() => void>;
  /** Visited chats, oldest first; `index` is the one on screen. */
  history: ChatKey[];
  index: number;
  /** Set while back/forward opens a chat, so arriving there moves in the history instead of adding to it. */
  travelling: ChatKey | null;
  last: ChatKey | null;
  /** Paseo's active chat, published by the sidebar view while mounted; undefined while it is not. */
  active: ChatKey | null | undefined;
  /** Paseo's own way to open a chat, published by the sidebar view while it is shown. */
  opener: Opener | null;
  /** The plugin's own text fields with focus, and its full screens open (see `ownInputActive`). */
  ownFields: number;
  ownScreens: number;
}

function nav(): ChatNav {
  const holder = globalThis as unknown as Record<string, ChatNav | undefined>;
  return (holder[KEY] ??= { icons: new Set(), counter: 0, listeners: new Set(), history: [], index: -1, travelling: null, last: null, active: undefined, opener: null, ownFields: 0, ownScreens: 0 });
}

/** The chat on screen: Paseo's active chat when published, else the visible pill icon shown most recently. */
export function currentChat(): ChatKey | null {
  const state = nav();
  if (state.active !== undefined) return state.active;
  let best: Shown | null = null;
  for (const icon of state.icons) if (icon.visible && (!best || icon.shownAt > best.shownAt)) best = icon;
  return best?.key ?? null;
}

function changed() {
  const state = nav();
  const current = currentChat();
  if (current && current !== state.last) {
    if (state.travelling === current) state.index = state.history.lastIndexOf(current);
    else {
      state.history = [...state.history.slice(0, state.index + 1).filter((key) => key !== current), current].slice(-MAX_HISTORY);
      state.index = state.history.length - 1;
    }
    state.travelling = null;
  }
  state.last = current;
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

export interface ShownChat {
  /** Where visibility is known (web): hidden icons do not count, and showing one again makes it the newest. */
  setVisible(visible: boolean): void;
  remove(): void;
}

/** Reports `key` as on screen by a mounted pill icon until `remove`. */
export function reportShownChat(key: ChatKey): ShownChat {
  const state = nav();
  const entry: Shown = { key, visible: true, shownAt: ++state.counter };
  state.icons.add(entry);
  changed();
  return {
    setVisible(visible) {
      if (visible === entry.visible) return;
      entry.visible = visible;
      if (visible) entry.shownAt = ++state.counter;
      changed();
    },
    remove() {
      if (state.icons.delete(entry)) changed();
    },
  };
}

/** The chat `by` steps back (-1) or forward (+1) in the visited chats, or null at either end. */
export function historyStep(by: -1 | 1): ChatKey | null {
  const state = nav();
  return state.history[state.index + by] ?? null;
}

/** Marks `key` as the target of back/forward, so opening it moves in the history. */
export function travelTo(key: ChatKey): void {
  nav().travelling = key;
}

function setActive(key: ChatKey | null | undefined) {
  const state = nav();
  if (state.active === key) return;
  state.active = key;
  changed();
}

/** For the sidebar view: publishes Paseo's active chat (null: no chat open) while mounted. */
export function usePublishActiveChat(key: ChatKey | null): void {
  useEffect(() => {
    setActive(key);
  }, [key]);
  // Separate, so switching chats never passes through "unpublished" (the icons' guess would enter the history).
  useEffect(() => () => setActive(undefined), []);
}

export function publishOpener(open: Opener): () => void {
  const state = nav();
  state.opener = open;
  return () => {
    if (state.opener === open) state.opener = null;
  };
}

/** Paseo's own chat opener while the sidebar view is shown, else null (use the go screen). */
export const chatOpener = (): Opener | null => nav().opener;

// ---- the plugin's own text fields ----
// The phone apps cannot tell which field the keyboard is for. A keyboard that opens while a chat is on screen
// counts as typing in that chat, unless one of the plugin's own fields has focus or one of its screens is
// open over the chat. Shared like the rest: any copy's fields and screens count for the one listener.

/**
 * Focus handlers for one of the plugin's own text inputs. A field unmounted while focused may never
 * blur, so unmounting releases it too.
 */
export function useOwnField(): { onFocus(): void; onBlur(): void } {
  const focused = useRef(false);
  const release = () => {
    if (!focused.current) return;
    focused.current = false;
    nav().ownFields = Math.max(0, nav().ownFields - 1);
  };
  useEffect(() => release, []);
  return useMemo(
    () => ({
      onFocus() {
        if (focused.current) return;
        focused.current = true;
        nav().ownFields++;
      },
      onBlur: release,
    }),
    [],
  );
}

/** For the plugin's full screens: call on mount, call the result on unmount. */
export function ownScreenOpen(): () => void {
  nav().ownScreens++;
  return () => void (nav().ownScreens = Math.max(0, nav().ownScreens - 1));
}

export const ownInputActive = (): boolean => nav().ownFields > 0 || nav().ownScreens > 0;
