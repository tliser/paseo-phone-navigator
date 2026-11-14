// Drag-and-drop for the tree, by a grip at the row's end. React Native's own PanResponder, no extra
// libraries. The grip's responder keeps every move until release, the list does not scroll meanwhile,
// and the drop is computed from the pure geometry (shared/drag.ts).
import { useMemo, useRef, useState } from "react";
import { PanResponder, type GestureResponderHandlers } from "react-native";
import { findDropTarget, rowOffsets, type DropTarget, type RowHeights } from "../shared/drag";
import type { TreeRow } from "../shared/tree";

export interface DragState {
  index: number;
  /** Pointer travel since the pick-up, in px. */
  dy: number;
  drop: DropTarget | null;
}

/** The row just dropped: where it was let go, in content coordinates, so it can glide into its new place. */
export interface Landing {
  key: string;
  top: number;
}

export interface DragController {
  state: DragState | null;
  landing: Landing | null;
  /** Scroll offset of the list, kept current from onScroll. */
  setScrollY(y: number): void;
  /** Scroll offset when the row was picked up (scrolling is off while dragging). */
  scrollAtPickUp(): number;
  /** Current scroll offset of the list. */
  scrollY(): number;
  /** Spread onto the list wrapper; only takes part while a row is picked up. */
  handlers: GestureResponderHandlers;
  /**
   * Handlers for a row's grip. With a mouse the row lifts at once. On touch screens it lifts after a short
   * hold, so a swipe that starts on the grip still scrolls the list.
   */
  handleFor(index: number): GestureResponderHandlers;
}

/** On touch screens a drag starts after holding the grip this long. */
const TOUCH_HOLD_MS = 350;
/** Moving further than this before the hold is over cancels it (the list scrolls instead). */
const TOUCH_SLOP = 10;
/** How long the dropped row takes to glide into place. */
export const GLIDE_MS = 140;

/** On web a mouse drag also selects the text it passes; drop any selection when a row is picked up. */
function clearTextSelection() {
  const scope = globalThis as { getSelection?: () => { removeAllRanges(): void } | null };
  if (typeof scope.getSelection === "function") scope.getSelection()?.removeAllRanges();
}

export function useDragController(options: {
  rows: readonly TreeRow[];
  heights: RowHeights;
  /** Hold before lifting (touch screens); false lifts at once (mouse). */
  hold: boolean;
  onDrop(row: TreeRow, drop: DropTarget): void;
}): DragController {
  const [state, setState] = useState<DragState | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const ref = useRef({ state: null as DragState | null, scrollY: 0, startScroll: 0, options, landingTimer: null as ReturnType<typeof setTimeout> | null });
  ref.current.options = options;
  ref.current.state = state;

  const offsets = useMemo(() => rowOffsets(options.rows, options.heights), [options.rows, options.heights]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const update = (next: DragState | null) => {
    ref.current.state = next;
    setState(next);
  };

  const move = (dy: number) => {
    const current = ref.current.state;
    if (!current) return;
    const { rows } = ref.current.options;
    const offs = offsetsRef.current;
    const top = offs[current.index] ?? 0;
    const height = (offs[current.index + 1] ?? top) - top;
    const center = top + height / 2 + dy;
    update({ index: current.index, dy, drop: findDropTarget(rows, offs, current.index, center) });
  };
  const release = () => {
    const current = ref.current.state;
    update(null);
    const row = current ? ref.current.options.rows[current.index] : undefined;
    if (!current || !row) return;
    // The new order is drawn in the same render; the dropped row then glides from where it was let go
    // (back to its old place when it was not moved).
    if (ref.current.landingTimer) clearTimeout(ref.current.landingTimer);
    setLanding({ key: row.key, top: (offsetsRef.current[current.index] ?? 0) + current.dy });
    ref.current.landingTimer = setTimeout(() => setLanding(null), GLIDE_MS + 60);
    if (current.drop) ref.current.options.onDrop(row, current.drop);
  };
  const pickUp = (index: number) => {
    clearTextSelection();
    ref.current.startScroll = ref.current.scrollY;
    update({ index, dy: 0, drop: null });
  };

  const handlers = useMemo(
    () =>
      PanResponder.create({
        // Only take the gesture while a row is picked up; taps and scrolling are untouched otherwise.
        onStartShouldSetPanResponderCapture: () => ref.current.state !== null,
        onMoveShouldSetPanResponderCapture: () => ref.current.state !== null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => move(gesture.dy),
        onPanResponderRelease: release,
        onPanResponderTerminate: () => update(null),
      }).panHandlers,
    [],
  );

  const handleCache = useRef(new Map<number, GestureResponderHandlers>());
  const holdRef = useRef(options.hold);
  if (holdRef.current !== options.hold) {
    holdRef.current = options.hold;
    handleCache.current.clear();
  }
  const handleFor = (index: number) => {
    let cached = handleCache.current.get(index);
    if (!cached) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let active = false;
      const cancel = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      const end = (drop: boolean) => {
        cancel();
        if (active) (drop ? release() : update(null));
        active = false;
      };
      cached = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Until the row is lifted the list may take the touch to scroll; once lifted, the grip keeps it.
        onPanResponderTerminationRequest: () => !active,
        onPanResponderGrant: () => {
          const lift = () => {
            timer = null;
            active = true;
            pickUp(index);
          };
          if (holdRef.current) timer = setTimeout(lift, TOUCH_HOLD_MS);
          else lift();
        },
        onPanResponderMove: (_event, gesture) => {
          if (active) move(gesture.dy);
          else if (Math.abs(gesture.dy) > TOUCH_SLOP || Math.abs(gesture.dx) > TOUCH_SLOP) cancel();
        },
        onPanResponderRelease: () => end(true),
        onPanResponderTerminate: () => end(false),
      }).panHandlers;
      handleCache.current.set(index, cached);
    }
    return cached;
  };

  return {
    state,
    landing,
    setScrollY: (y) => {
      ref.current.scrollY = y;
    },
    scrollAtPickUp: () => ref.current.startScroll,
    scrollY: () => ref.current.scrollY,
    handlers,
    handleFor,
  };
}
