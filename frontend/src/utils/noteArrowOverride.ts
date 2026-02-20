import type { Editor, TLNoteShape, TLShapeId } from '@tldraw/editor';
import { createShapeId } from 'tldraw';

/**
 * Maps each clone-handle ID to the normalizedAnchor on the note where the
 * arrow start should bind (0‒1 in note-local space).
 */
const HANDLE_ANCHORS: Record<string, { x: number; y: number }> = {
  top:    { x: 0.5, y: 0   },
  right:  { x: 1,   y: 0.5 },
  bottom: { x: 0.5, y: 1   },
  left:   { x: 0,   y: 0.5 },
};

/**
 * Creates an arrow whose START is bound to `noteShape` at the edge that
 * corresponds to `handleId`, then returns the new arrow's id.
 *
 * For the DRAG case the caller is expected to immediately transition into
 * `dragging_handle` on the arrow's `end` handle so the user can drag it live.
 * For the CLICK case we simply select the arrow and return to idle — the user
 * can then grab the end handle themselves.
 */
function createArrowFromNoteHandle(
  editor: Editor,
  noteShape: TLNoteShape,
  handleId: string,
): TLShapeId | null {
  const anchor = HANDLE_ANCHORS[handleId] ?? { x: 0.5, y: 0.5 };
  const origin = editor.inputs.originPagePoint;

  const arrowId: TLShapeId = createShapeId();

  editor.mark('create-arrow-from-note');

  editor.createShape({
    id: arrowId,
    type: 'arrow',
    // Place the shape origin at the click point; both terminals start coincident.
    x: origin.x,
    y: origin.y,
    props: {
      start: { x: 0, y: 0 },
      end:   { x: 0, y: 0 },
    },
  });

  // Bind the arrow's START terminal to the note at the chosen edge anchor.
  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: noteShape.id,
    props: {
      terminal:          'start',
      normalizedAnchor:  anchor,
      isExact:           false,
      isPrecise:         true,
    },
  });

  return arrowId;
}

/**
 * Patches tldraw's internal `pointing_handle` state so that clicking or
 * dragging a note's clone handle starts an arrow instead of creating a new
 * linked note.
 *
 * Call once inside `onMount` / `handleEditorMount`.
 */
export function patchNoteCloneHandle(editor: Editor): void {
  // Navigate the state-machine tree: root → select → pointing_handle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectState = (editor.root as any).children?.['select'];
  if (!selectState) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pointingHandle = selectState.children?.['pointing_handle'] as any;
  if (!pointingHandle) return;

  // ── CLICK (no drag) ──────────────────────────────────────────────────────
  // Original: creates an adjacent note and immediately starts editing it.
  // Patched:  creates an arrow bound to the note, selects it, returns to idle.
  pointingHandle.onPointerUp = function (this: typeof pointingHandle) {
    const { shape, handle } = this.info as { shape: TLNoteShape; handle: { id: string } };

    if (editor.isShapeOfType(shape, 'note')) {
      const arrowId = createArrowFromNoteHandle(editor, shape, handle.id);
      if (arrowId) {
        editor.select(arrowId);
      }
      this.parent.transition('idle');
      return;
    }

    // Non-note shapes: preserve default behaviour.
    this.parent.transition('idle', this.info);
  };

  // ── DRAG ─────────────────────────────────────────────────────────────────
  // Original: creates an adjacent note and enters a translating state so the
  //           user can position the new note by dragging.
  // Patched:  creates an arrow bound to the note and immediately enters
  //           `dragging_handle` on the arrow's `end` handle, so the user can
  //           drag the arrow tip live to any target shape.
  pointingHandle.startDraggingHandle = function (this: typeof pointingHandle) {
    if (editor.getInstanceState().isReadonly) return;

    const { shape, handle } = this.info as { shape: TLNoteShape; handle: { id: string } };

    if (editor.isShapeOfType(shape, 'note')) {
      const arrowId = createArrowFromNoteHandle(editor, shape, handle.id);
      if (!arrowId) return;

      const arrowShape = editor.getShape(arrowId);
      if (!arrowShape) return;

      const endHandle = editor.getShapeHandles(arrowShape)?.find((h) => h.id === 'end');
      if (!endHandle) return;

      // Hand off to DraggingHandle so the end terminal tracks the pointer.
      this.parent.transition('dragging_handle', {
        shape:             arrowShape,
        handle:            endHandle,
        isCreating:        true,
        onInteractionEnd:  'select',
      });
      return;
    }

    // Non-note shapes: preserve default dragging-handle behaviour.
    this.parent.transition('dragging_handle', this.info);
  };
}
