import type { Editor, TLShapeId } from '@tldraw/editor';

/**
 * Removes a frame shape while keeping all of its children on the page.
 *
 * How coordinate preservation works
 * ──────────────────────────────────
 * Inside a frame, every child's (x, y) is in the frame's LOCAL coordinate
 * space — i.e. relative to the frame's top-left corner.  When we call
 * editor.reparentShapes(childIds, pageId), tldraw internally:
 *   1. Computes each child's current PAGE-space transform
 *      (frame-origin + child-local-offset).
 *   2. Re-parents the child to the page.
 *   3. Writes new (x, y) values equal to the page-space coordinates,
 *      so the shape does not visually move.
 *
 * This means NO manual coordinate math is needed — reparentShapes handles it.
 */
export function removeFrameKeepContents(editor: Editor, frameId: TLShapeId): void {
  const frame = editor.getShape(frameId);
  if (!frame || frame.type !== 'frame') return;

  editor.batch(() => {
    const childIds = editor.getSortedChildIdsForParent(frameId);
    if (childIds.length > 0) {
      // reparentShapes converts child positions from frame-local → page-space.
      editor.reparentShapes(childIds, editor.getCurrentPageId());
    }
    // Delete only the frame; children are already on the page.
    editor.deleteShapes([frameId]);
  });
}

/**
 * Deletes a frame AND all shapes nested inside it.
 *
 * tldraw does NOT automatically cascade-delete children when a frame is
 * deleted via the normal delete action (it reparents them instead).
 * This function explicitly collects the child IDs first so the entire
 * subtree is removed in a single batched operation.
 */
export function deleteFrameWithContents(editor: Editor, frameId: TLShapeId): void {
  const frame = editor.getShape(frameId);
  if (!frame || frame.type !== 'frame') return;

  editor.batch(() => {
    const childIds = editor.getSortedChildIdsForParent(frameId);
    editor.deleteShapes([frameId, ...childIds]);
  });
}
