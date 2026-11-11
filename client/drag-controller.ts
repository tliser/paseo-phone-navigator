// Long-press drag for the tree. React Native's own PanResponder, no extra libraries.
// The row that was long-pressed becomes the drag source; its responder keeps every move until
// release, the list does not scroll meanwhile, and the drop is computed from the pure geometry.
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

export interface DragController {
  state: DragState | null;
  /** Scroll offset of the list, kept current from onScroll. */
  setScrollY(y: number): void;
  /** Scroll offset when the row was picked up (scrolling is off while dragging). */
  scrollAtPickUp(): number;
  /** Called from the row's long-press. */
  pickUp(index: number): void;
  /** Spread onto the list wrapper so moves keep arriving after the long-press. */
  handlers: GestureResponderHandlers;
  /** Handlers for a drag handle (desktop): pressing it picks the row up at once, no long-press. */
  handleFor(index: number): GestureResponderHandlers;
}

/** On web a mouse drag also selects the text it passes; drop any selection when a row is picked up. */
function clearTextSelection() {
  const scope = globalThis as { getSelection?: () => { removeAllRanges(): void } | null };
  if (typeof scope.getSelection === "function") scope.getSelection()?.removeAllRanges();
}

export function useDragController(options: {
  rows: readonly TreeRow[];
  heights: RowHeights;
  onDrop(row: TreeRow, drop: DropTarget): void;
}): DragController {
  const [state, setState] = useState<DragState | null>(null);
  const ref = useRef({ state: null as DragState | null, scrollY: 0, startScroll: 0, options });
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
    if (!current?.drop) return;
    const row = ref.current.options.rows[current.index];
    if (row) ref.current.options.onDrop(row, current.drop);
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
        onStartShouldSetPanResponder: () => ref.current.state !== null,
        onStartShouldSetPanResponderCapture: () => ref.current.state !== null,
        onMoveShouldSetPanResponder: () => ref.current.state !== null,
        onMoveShouldSetPanResponderCapture: () => ref.current.state !== null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => move(gesture.dy),
        onPanResponderRelease: release,
        onPanResponderTerminate: () => update(null),
      }).panHandlers,
    [],
  );

  // One responder per handle, keyed by row index; the handle keeps the gesture (refuses termination),
  // so the travel is measured from the press itself.
  const handleCache = useRef(new Map<number, GestureResponderHandlers>());
  const handleFor = (index: number) => {
    let cached = handleCache.current.get(index);
    if (!cached) {
      cached = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => pickUp(index),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => move(gesture.dy),
        onPanResponderRelease: release,
        onPanResponderTerminate: () => update(null),
      }).panHandlers;
      handleCache.current.set(index, cached);
    }
    return cached;
  };

  return {
    state,
    setScrollY: (y) => {
      ref.current.scrollY = y;
    },
    scrollAtPickUp: () => ref.current.startScroll,
    pickUp,
    handlers,
    handleFor,
  };
}
