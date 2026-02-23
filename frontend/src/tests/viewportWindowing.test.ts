/**
 * Tests for the tiered board state builder (viewport windowing).
 *
 * Validates that buildTieredBoardState() correctly classifies shapes as
 * viewport (full detail) or off-screen (compact summary) based on viewport
 * intersection, frame grouping rules, and text extraction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Editor,
  createTLStore,
  defaultShapeUtils,
  defaultBindingUtils,
  createShapeId,
} from 'tldraw';
import { buildTieredBoardState, type ViewportShape, type OffScreenShape } from '../utils/boardStateBuilder';

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

/** Mock the editor's viewport to a specific bounding box. */
function mockViewport(ed: Editor, x: number, y: number, w: number, h: number) {
  vi.spyOn(ed, 'getViewportPageBounds').mockReturnValue({
    x, y, w, h,
    minX: x, minY: y,
    maxX: x + w, maxY: y + h,
    midX: x + w / 2, midY: y + h / 2,
  } as any);
}

function isViewportShape(s: unknown): s is ViewportShape {
  return typeof s === 'object' && s !== null && 'props' in s;
}

function isOffScreenShape(s: unknown): s is OffScreenShape {
  return typeof s === 'object' && s !== null && 'text' in s && !('props' in s);
}

// ── Test state ────────────────────────────────────────────────────────────────

let editor: Editor;

beforeEach(() => { editor = createHeadlessEditor(); });
afterEach(() => { editor.dispose(); vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('buildTieredBoardState', () => {

  // 1. All shapes in viewport
  it('includes all shapes with full props when all are in viewport', () => {
    mockViewport(editor, 0, 0, 2000, 2000);

    editor.createShape({ id: createShapeId(), type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } });
    editor.createShape({ id: createShapeId(), type: 'geo', x: 400, y: 400, props: { w: 100, h: 100 } });
    editor.createShape({ id: createShapeId(), type: 'note', x: 700, y: 200, props: { text: 'Hi' } });

    const result = buildTieredBoardState(editor);

    expect(result).toHaveLength(3);
    for (const s of result) {
      expect(isViewportShape(s)).toBe(true);
    }
  });

  // 2. Mixed viewport
  it('returns full props for viewport shapes and compact summary for off-screen shapes', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    const inId1 = createShapeId();
    const inId2 = createShapeId();
    const inId3 = createShapeId();
    const outId1 = createShapeId();
    const outId2 = createShapeId();

    editor.createShape({ id: inId1, type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } });
    editor.createShape({ id: inId2, type: 'geo', x: 300, y: 300, props: { w: 100, h: 100 } });
    editor.createShape({ id: inId3, type: 'note', x: 500, y: 500, props: { text: 'Visible' } });
    editor.createShape({ id: outId1, type: 'geo', x: 5000, y: 5000, props: { w: 100, h: 100, text: 'Far' } });
    editor.createShape({ id: outId2, type: 'note', x: 5000, y: 6000, props: { text: 'Also far' } });

    const result = buildTieredBoardState(editor);

    expect(result).toHaveLength(5);

    const viewportShapes = result.filter(isViewportShape);
    const offScreenShapes = result.filter(isOffScreenShape);
    expect(viewportShapes).toHaveLength(3);
    expect(offScreenShapes).toHaveLength(2);

    // Off-screen shapes should have text, not props
    const offOut1 = offScreenShapes.find(s => s.id === outId1)!;
    expect(offOut1.text).toBe('Far');
    expect(offOut1).not.toHaveProperty('props');

    const offOut2 = offScreenShapes.find(s => s.id === outId2)!;
    expect(offOut2.text).toBe('Also far');
  });

  // 3. No coordinates on any shape
  it('never includes x or y fields on any shape', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    editor.createShape({ id: createShapeId(), type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } });
    editor.createShape({ id: createShapeId(), type: 'note', x: 5000, y: 5000, props: { text: 'Off' } });

    const result = buildTieredBoardState(editor);

    for (const s of result) {
      expect(s).not.toHaveProperty('x');
      expect(s).not.toHaveProperty('y');
    }
  });

  // 4. Frame in viewport promotes children
  it('promotes all children to full detail when their parent frame is in viewport', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    const frameId = createShapeId();
    editor.createShape({
      id: frameId, type: 'frame', x: 100, y: 100,
      props: { w: 5000, h: 5000, name: 'Big Frame' },
    });

    // Child at local coords that place it far off-screen in page space
    const childId = createShapeId();
    editor.createShape({
      id: childId, type: 'note',
      x: 4800, y: 4800,
      parentId: frameId,
      props: { text: 'Far child' },
    } as Parameters<typeof editor.createShape>[0]);

    const result = buildTieredBoardState(editor);

    // Both frame and child should have full props (frame is in viewport → child promoted)
    const frameResult = result.find(s => s.id === frameId)!;
    const childResult = result.find(s => s.id === childId)!;
    expect(isViewportShape(frameResult)).toBe(true);
    expect(isViewportShape(childResult)).toBe(true);
  });

  // 5. Child in viewport promotes parent frame
  it('promotes parent frame to full detail when a child is in viewport', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    // Frame entirely off-screen
    const frameId = createShapeId();
    editor.createShape({
      id: frameId, type: 'frame', x: 3000, y: 3000,
      props: { w: 200, h: 200, name: 'Off Frame' },
    });

    // Create note in viewport first, then reparent to off-screen frame.
    // reparentShapes converts page coords to local coords while preserving
    // visual position, so the note stays in the viewport.
    const childId = createShapeId();
    editor.createShape({
      id: childId, type: 'note', x: 100, y: 100,
      props: { text: 'Visible child' },
    });
    editor.reparentShapes([childId], frameId);

    const result = buildTieredBoardState(editor);

    const childResult = result.find(s => s.id === childId)!;
    const frameResult = result.find(s => s.id === frameId)!;
    expect(isViewportShape(childResult)).toBe(true);
    // Parent frame promoted via pass 3
    expect(isViewportShape(frameResult)).toBe(true);
  });

  // 6. Empty text handling
  it('includes empty string text for shapes with no text content', () => {
    mockViewport(editor, 0, 0, 100, 100); // Small viewport, shapes off-screen

    editor.createShape({
      id: createShapeId(), type: 'arrow', x: 5000, y: 5000,
      props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, text: '' },
    });
    editor.createShape({
      id: createShapeId(), type: 'geo', x: 5000, y: 5100,
      props: { w: 100, h: 100, text: '' },
    });

    const result = buildTieredBoardState(editor);
    const offScreen = result.filter(isOffScreenShape);

    expect(offScreen).toHaveLength(2);
    for (const s of offScreen) {
      expect(s.text).toBe('');
      expect(typeof s.text).toBe('string');
    }
  });

  // 7. 10% padding inclusion
  it('includes shapes within the 10% expanded viewport bounds', () => {
    // Viewport: (0, 0, 1000, 800)
    // 10% padding: padX=100, padY=80
    // Expanded: (-100, -80) to (1100, 880)
    mockViewport(editor, 0, 0, 1000, 800);

    // Shape just outside raw viewport but within 10% padding
    // At x=1050, a geo with w=100 has bounds (1050, 100) to (1150, 200)
    // minX=1050 <= expanded.maxX=1100 → yes; maxX=1150 >= expanded.minX=-100 → yes
    const paddedId = createShapeId();
    editor.createShape({
      id: paddedId, type: 'geo', x: 1050, y: 100,
      props: { w: 100, h: 100, text: 'Near edge' },
    });

    const result = buildTieredBoardState(editor);
    const shape = result.find(s => s.id === paddedId)!;

    expect(isViewportShape(shape)).toBe(true);
  });

  // 8. Beyond padding exclusion
  it('uses compact format for shapes well outside the padded viewport', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    // Shape at x=1200 — expanded maxX is 1100 → minX=1200 > 1100 → off-screen
    const farId = createShapeId();
    editor.createShape({
      id: farId, type: 'note', x: 1200, y: 100,
      props: { text: 'Too far' },
    });

    const result = buildTieredBoardState(editor);
    const shape = result.find(s => s.id === farId)!;

    expect(isOffScreenShape(shape)).toBe(true);
    expect((shape as OffScreenShape).text).toBe('Too far');
  });

  // 9. Empty board
  it('returns empty array for an empty board', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    const result = buildTieredBoardState(editor);
    expect(result).toEqual([]);
  });

  // 10. All shapes off-screen
  it('returns all shapes in compact format when viewport is in empty area', () => {
    mockViewport(editor, 50000, 50000, 1000, 800); // viewport far from all shapes

    editor.createShape({ id: createShapeId(), type: 'note', x: 100, y: 100, props: { text: 'A' } });
    editor.createShape({ id: createShapeId(), type: 'geo', x: 300, y: 300, props: { w: 100, h: 100, text: 'B' } });

    const result = buildTieredBoardState(editor);

    expect(result).toHaveLength(2);
    for (const s of result) {
      expect(isOffScreenShape(s)).toBe(true);
    }
  });

  // 11. Nested frames
  it('promotes inner frame and its children when outer frame is in viewport', () => {
    mockViewport(editor, 0, 0, 1000, 800);

    const outerFrameId = createShapeId();
    editor.createShape({
      id: outerFrameId, type: 'frame', x: 50, y: 50,
      props: { w: 800, h: 600, name: 'Outer' },
    });

    const innerFrameId = createShapeId();
    editor.createShape({
      id: innerFrameId, type: 'frame',
      x: 10, y: 40,
      parentId: outerFrameId,
      props: { w: 300, h: 300, name: 'Inner' },
    } as Parameters<typeof editor.createShape>[0]);

    const noteId = createShapeId();
    editor.createShape({
      id: noteId, type: 'note',
      x: 10, y: 40,
      parentId: innerFrameId,
      props: { text: 'Deep child' },
    } as Parameters<typeof editor.createShape>[0]);

    const result = buildTieredBoardState(editor);

    // Outer frame in viewport → inner frame promoted as child.
    // Inner frame is also a frame → its children (noteId) promoted in pass 2.
    // All should have full props.
    for (const id of [outerFrameId, innerFrameId, noteId]) {
      const s = result.find(r => r.id === id)!;
      expect(isViewportShape(s)).toBe(true);
    }
  });

  // 12. Shape exactly on viewport boundary
  it('includes shapes whose edge touches the expanded viewport boundary', () => {
    // Viewport (0, 0, 1000, 800) → expanded maxX = 1100
    mockViewport(editor, 0, 0, 1000, 800);

    // Shape at x=1100, w=100 → minX=1100 <= expanded.maxX=1100 → included
    const edgeId = createShapeId();
    editor.createShape({
      id: edgeId, type: 'geo', x: 1100, y: 100,
      props: { w: 100, h: 100, text: 'Edge touch' },
    });

    const result = buildTieredBoardState(editor);
    const shape = result.find(s => s.id === edgeId)!;

    expect(isViewportShape(shape)).toBe(true);
  });

  // 13. Text extraction per type
  it('extracts correct text field for each shape type when off-screen', () => {
    mockViewport(editor, 0, 0, 100, 100); // Small viewport

    const noteId = createShapeId();
    const frameId = createShapeId();
    const geoId = createShapeId();
    const textId = createShapeId();
    const arrowId = createShapeId();

    editor.createShape({
      id: noteId, type: 'note', x: 5000, y: 5000,
      props: { text: 'Note text' },
    });
    editor.createShape({
      id: frameId, type: 'frame', x: 5000, y: 5300,
      props: { w: 200, h: 200, name: 'Frame name' },
    });
    editor.createShape({
      id: geoId, type: 'geo', x: 5000, y: 5600,
      props: { w: 100, h: 100, text: 'Geo text' },
    });
    editor.createShape({
      id: textId, type: 'text', x: 5000, y: 5900,
      props: { text: 'Text label' },
    } as Parameters<typeof editor.createShape>[0]);
    editor.createShape({
      id: arrowId, type: 'arrow', x: 5000, y: 6200,
      props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, text: 'Arrow label' },
    });

    const result = buildTieredBoardState(editor);
    const offScreen = result.filter(isOffScreenShape) as OffScreenShape[];

    expect(offScreen.find(s => s.id === noteId)!.text).toBe('Note text');
    expect(offScreen.find(s => s.id === frameId)!.text).toBe('Frame name');
    expect(offScreen.find(s => s.id === geoId)!.text).toBe('Geo text');
    expect(offScreen.find(s => s.id === textId)!.text).toBe('Text label');
    expect(offScreen.find(s => s.id === arrowId)!.text).toBe('Arrow label');
  });
});
