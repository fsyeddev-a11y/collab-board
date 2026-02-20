/**
 * Store-level integration tests for tldraw canvas objects.
 *
 * These tests create a headless tldraw Editor (no React rendering) and drive
 * it entirely through the Editor API.  They verify shape CRUD, frame nesting
 * semantics, and arrow binding persistence.
 *
 * Prerequisites:
 *   npm install -D jsdom          (jsdom DOM environment for vitest)
 *
 * Run with:
 *   npm test --workspace=frontend
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Editor,
  createTLStore,
  defaultShapeUtils,
  defaultBindingUtils,
  createShapeId,
} from 'tldraw';
import type { TLShapeId } from '@tldraw/editor';
import { removeFrameKeepContents, deleteFrameWithContents } from '../utils/frameActions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createHeadlessEditor(): Editor {
  const container = document.createElement('div');
  container.style.width = '1000px';
  container.style.height = '800px';
  document.body.appendChild(container);

  const store = createTLStore({ shapeUtils: defaultShapeUtils });
  return new Editor({
    store,
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => container,
  });
}

// ── Test state ────────────────────────────────────────────────────────────────

let editor: Editor;

beforeEach(() => { editor = createHeadlessEditor(); });
afterEach(() => { editor.dispose(); });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Standard object CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('Standard object CRUD', () => {

  const SHAPE_CASES = [
    {
      label: 'note',
      partial: () => ({
        type: 'note' as const,
        x: 100, y: 100,
        props: { text: 'Hello' },
      }),
    },
    {
      label: 'geo (rectangle)',
      partial: () => ({
        type: 'geo' as const,
        x: 200, y: 200,
        props: { geo: 'rectangle' as const, w: 120, h: 80 },
      }),
    },
    {
      label: 'text',
      partial: () => ({
        type: 'text' as const,
        x: 300, y: 300,
        props: { text: 'Label' },
      }),
    },
    {
      label: 'frame',
      partial: () => ({
        type: 'frame' as const,
        x: 50, y: 50,
        props: { w: 400, h: 300, name: 'My Frame' },
      }),
    },
  ] as const;

  for (const { label, partial } of SHAPE_CASES) {

    describe(label, () => {

      it('creates a shape', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        expect(editor.getShape(id)).toBeDefined();
        expect(editor.getShape(id)?.type).toBe(partial().type);
      });

      it('edits shape props', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        // Every shape type we test has at least an x/y we can mutate.
        editor.updateShape({ id, type: partial().type, x: 999 });
        expect(editor.getShape(id)?.x).toBe(999);
      });

      it('moves a shape', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        editor.select(id);
        editor.nudgeShapes([id], { x: 50, y: 30 });
        const shape = editor.getShape(id)!;
        expect(shape.x).toBe(partial().x + 50);
        expect(shape.y).toBe(partial().y + 30);
      });

      it('rotates a shape', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        editor.select(id);
        editor.rotateShapesBy([id], Math.PI / 4);
        const shape = editor.getShape(id)!;
        expect(shape.rotation).toBeCloseTo(Math.PI / 4);
      });

      it('duplicates a shape', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        editor.select(id);
        editor.duplicateShapes([id]);
        // Original still exists, plus one new sibling of the same type.
        const all = editor.getCurrentPageShapes().filter((s) => s.type === partial().type);
        expect(all.length).toBeGreaterThanOrEqual(2);
      });

      it('deletes a shape', () => {
        const id = createShapeId();
        editor.createShape({ id, ...partial() });
        editor.deleteShapes([id]);
        expect(editor.getShape(id)).toBeUndefined();
      });

    });
  }

  it('resizes a geo shape', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } });
    editor.select(id);
    editor.resizeShape(id, { x: 2, y: 2 });
    const shape = editor.getShape(id) as { props: { w: number; h: number } };
    expect(shape.props.w).toBeCloseTo(200);
    expect(shape.props.h).toBeCloseTo(200);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Frame logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Frame logic', () => {

  it('adds a shape to a frame (parentId changes)', () => {
    const frameId = createShapeId();
    editor.createShape({ id: frameId, type: 'frame', x: 0, y: 0, props: { w: 400, h: 400, name: 'F' } });

    // Create the note FAR outside the frame so tldraw does not auto-parent it.
    // tldraw reparents shapes to a frame if they are created inside its bounds.
    const noteId = createShapeId();
    editor.createShape({ id: noteId, type: 'note', x: 800, y: 800, props: { text: 'A' } });

    // Initially the note is a child of the page.
    expect(editor.getShape(noteId)!.parentId).toBe(editor.getCurrentPageId());

    // Explicitly reparent into the frame.
    editor.reparentShapes([noteId], frameId);
    expect(editor.getShape(noteId)!.parentId).toBe(frameId);
  });

  it('moving the frame updates children page coordinates', () => {
    const frameId = createShapeId();
    editor.createShape({ id: frameId, type: 'frame', x: 100, y: 100, props: { w: 300, h: 300, name: 'F' } });

    const noteId = createShapeId();
    // Create child directly inside frame at local (50, 50) → page (150, 150).
    editor.createShape({ id: noteId, type: 'note', parentId: frameId, x: 50, y: 50, props: { text: 'B' } });

    const pageBoundsBefore = editor.getShapePageBounds(noteId)!;
    expect(pageBoundsBefore.x).toBeCloseTo(150);
    expect(pageBoundsBefore.y).toBeCloseTo(150);

    // Move frame by (+100, +50).
    editor.select(frameId);
    editor.nudgeShapes([frameId], { x: 100, y: 50 });

    // Child's page position should shift by the same delta.
    const pageBoundsAfter = editor.getShapePageBounds(noteId)!;
    expect(pageBoundsAfter.x).toBeCloseTo(250);
    expect(pageBoundsAfter.y).toBeCloseTo(200);

    // Child's LOCAL coords inside the frame must remain unchanged.
    expect(editor.getShape(noteId)!.x).toBeCloseTo(50);
    expect(editor.getShape(noteId)!.y).toBeCloseTo(50);
  });

  it('deleteFrameWithContents removes both frame and children', () => {
    const frameId = createShapeId();
    editor.createShape({ id: frameId, type: 'frame', x: 0, y: 0, props: { w: 200, h: 200, name: 'F' } });

    const childIds = [createShapeId(), createShapeId()] as TLShapeId[];
    for (const id of childIds) {
      editor.createShape({ id, type: 'note', parentId: frameId, x: 10, y: 10, props: { text: 'x' } });
    }

    deleteFrameWithContents(editor, frameId);

    expect(editor.getShape(frameId)).toBeUndefined();
    for (const id of childIds) {
      expect(editor.getShape(id)).toBeUndefined();
    }
  });

  it('removeFrameKeepContents reparents children to page, preserving page coords', () => {
    const frameId = createShapeId();
    editor.createShape({ id: frameId, type: 'frame', x: 100, y: 100, props: { w: 300, h: 300, name: 'F' } });

    const noteId = createShapeId();
    // Local (60, 80) inside frame at (100, 100) → page (160, 180).
    editor.createShape({ id: noteId, type: 'note', parentId: frameId, x: 60, y: 80, props: { text: 'C' } });

    const pagePosBefore = editor.getShapePageBounds(noteId)!;

    removeFrameKeepContents(editor, frameId);

    // Frame must be gone.
    expect(editor.getShape(frameId)).toBeUndefined();

    // Child must still exist.
    const noteAfter = editor.getShape(noteId);
    expect(noteAfter).toBeDefined();

    // parentId must now be the page.
    expect(noteAfter!.parentId).toBe(editor.getCurrentPageId());

    // Page-space position must be preserved (within floating-point tolerance).
    const pagePosAfter = editor.getShapePageBounds(noteId)!;
    expect(pagePosAfter.x).toBeCloseTo(pagePosBefore.x, 1);
    expect(pagePosAfter.y).toBeCloseTo(pagePosBefore.y, 1);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Arrow connectors
// ─────────────────────────────────────────────────────────────────────────────

describe('Arrow connectors', () => {

  function createBoundArrow(fromShapeId: TLShapeId, toShapeId: TLShapeId): TLShapeId {
    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: 0, y: 0,
      props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    });
    editor.createBinding({ type: 'arrow', fromId: arrowId, toId: fromShapeId, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    editor.createBinding({ type: 'arrow', fromId: arrowId, toId: toShapeId,   props: { terminal: 'end',   normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    return arrowId;
  }

  it('creates an arrow', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 150, y: 0 } } });
    expect(editor.getShape(id)).toBeDefined();
    expect(editor.getShape(id)?.type).toBe('arrow');
  });

  it('binds arrow start to shape X and end to shape Y', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0,   props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0,   props: { w: 80, h: 80 } });

    const arrowId = createBoundArrow(xId, yId);

    const bindings = editor.getBindingsFromShape(arrowId, 'arrow');
    expect(bindings).toHaveLength(2);
    expect(bindings.some((b) => b.toId === xId)).toBe(true);
    expect(bindings.some((b) => b.toId === yId)).toBe(true);
  });

  it('bindings persist after moving X', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0, props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0, props: { w: 80, h: 80 } });
    const arrowId = createBoundArrow(xId, yId);

    editor.select(xId);
    editor.nudgeShapes([xId], { x: 100, y: 50 });

    const bindings = editor.getBindingsFromShape(arrowId, 'arrow');
    expect(bindings).toHaveLength(2);
  });

  it('bindings persist after resizing Y', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0, props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0, props: { w: 80, h: 80 } });
    const arrowId = createBoundArrow(xId, yId);

    editor.select(yId);
    editor.resizeShape(yId, { x: 1.5, y: 1.5 });

    const bindings = editor.getBindingsFromShape(arrowId, 'arrow');
    expect(bindings).toHaveLength(2);
  });

  it('bindings persist after rotating X', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0, props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0, props: { w: 80, h: 80 } });
    const arrowId = createBoundArrow(xId, yId);

    editor.select(xId);
    editor.rotateShapesBy([xId], Math.PI / 6);

    const bindings = editor.getBindingsFromShape(arrowId, 'arrow');
    expect(bindings).toHaveLength(2);
  });

  it('duplicating an arrow WITH its bound shapes copies bindings to the new shapes', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0, props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0, props: { w: 80, h: 80 } });
    const arrowId = createBoundArrow(xId, yId);

    // Duplicate the entire connected group — arrow + both bound shapes.
    // tldraw re-wires bindings so the duplicate arrow points to the duplicate
    // shapes, not the originals.
    editor.duplicateShapes([arrowId, xId, yId], { x: 0, y: 150 });

    // 2 arrows total on the page.
    const arrows = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow');
    expect(arrows).toHaveLength(2);

    // Each arrow must have exactly 2 bindings.
    for (const arrow of arrows) {
      const bindings = editor.getBindingsFromShape(arrow.id as TLShapeId, 'arrow');
      expect(bindings).toHaveLength(2);
    }
  });

  it('deletes an arrow without affecting bound shapes', () => {
    const xId = createShapeId();
    const yId = createShapeId();
    editor.createShape({ id: xId, type: 'geo', x: 0,   y: 0, props: { w: 80, h: 80 } });
    editor.createShape({ id: yId, type: 'geo', x: 300, y: 0, props: { w: 80, h: 80 } });
    const arrowId = createBoundArrow(xId, yId);

    editor.deleteShapes([arrowId]);

    expect(editor.getShape(arrowId)).toBeUndefined();
    // Bound shapes must still exist.
    expect(editor.getShape(xId)).toBeDefined();
    expect(editor.getShape(yId)).toBeDefined();
    // Bindings for the deleted arrow should be cleaned up.
    const remainingBindings = editor.getBindingsFromShape(arrowId, 'arrow');
    expect(remainingBindings).toHaveLength(0);
  });

});
