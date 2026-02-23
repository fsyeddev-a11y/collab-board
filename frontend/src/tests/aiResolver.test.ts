/**
 * Integration tests for the AI tool-call resolver.
 *
 * Uses a headless tldraw Editor (no React rendering) to verify that each
 * resolver function converts high-level intent into correct tldraw shapes.
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
import { resolveToolCalls } from '../utils/aiResolver';

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

function shapesOfType(editor: Editor, type: string) {
  return editor.getCurrentPageShapes().filter((s) => s.type === type);
}

// ── Test state ────────────────────────────────────────────────────────────────

let editor: Editor;

beforeEach(() => { editor = createHeadlessEditor(); });
afterEach(() => { editor.dispose(); });

// ─────────────────────────────────────────────────────────────────────────────
// 1. createElements resolver
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — createElements', () => {

  it('creates a sticky note with text and color', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'sticky', text: 'Hello', color: 'yellow' }],
    }]);

    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(1);
    expect((notes[0] as any).props.text).toBe('Hello');
    expect((notes[0] as any).props.color).toBe('yellow');
  });

  it('creates a geo shape (rectangle)', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'shape', text: 'Box' }],
    }]);

    const geos = shapesOfType(editor, 'geo');
    expect(geos).toHaveLength(1);
    expect((geos[0] as any).props.geo).toBe('rectangle');
    expect((geos[0] as any).props.text).toBe('Box');
  });

  it('creates a text label', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'text', text: 'Label' }],
    }]);

    const texts = shapesOfType(editor, 'text');
    expect(texts).toHaveLength(1);
    expect((texts[0] as any).props.text).toBe('Label');
  });

  it('creates a connector (arrow)', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'connector' }],
    }]);

    const arrows = shapesOfType(editor, 'arrow');
    expect(arrows).toHaveLength(1);
  });

  it('creates multiple elements in a horizontal row', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [
        { type: 'sticky', text: 'A' },
        { type: 'sticky', text: 'B' },
        { type: 'sticky', text: 'C' },
      ],
    }]);

    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(3);

    // Verify they are horizontally offset (x increases, y stays the same)
    const xs = notes.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);

    // All at the same y
    const ys = new Set(notes.map((n) => n.y));
    expect(ys.size).toBe(1);
  });

  it('defaults color to yellow for sticky, blue for shape', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [
        { type: 'sticky' },
        { type: 'shape' },
      ],
    }]);

    const note = shapesOfType(editor, 'note')[0];
    const geo = shapesOfType(editor, 'geo')[0];
    expect((note as any).props.color).toBe('yellow');
    expect((geo as any).props.color).toBe('blue');
  });

  it('creates a frame with name', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'frame', text: 'My Container' }],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(1);
    expect((frames[0] as any).props.name).toBe('My Container');
    expect((frames[0] as any).props.w).toBe(300);
    expect((frames[0] as any).props.h).toBe(300);
  });

  it('creates a frame with default name when text is omitted', () => {
    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'frame' }],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(1);
    expect((frames[0] as any).props.name).toBe('Frame');
  });

  it('places new elements below existing shapes', () => {
    // Create an existing shape at y=100
    editor.createShape({
      id: createShapeId(),
      type: 'geo',
      x: 100, y: 100,
      props: { w: 200, h: 200 },
    });

    resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [{ type: 'sticky', text: 'New' }],
    }]);

    const note = shapesOfType(editor, 'note')[0];
    // New element should be placed below the existing geo (y=100 + h=200 + gap)
    expect(note.y).toBeGreaterThan(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. updateElements resolver
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — updateElements', () => {

  it('updates text on an existing shape', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'note', x: 800, y: 800, props: { text: 'Old' } });

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, newText: 'New' }],
    }]);

    expect((editor.getShape(id) as any).props.text).toBe('New');
  });

  it('updates color on an existing shape', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'note', x: 800, y: 800, props: { text: 'X', color: 'yellow' } });

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, newColor: 'red' }],
    }]);

    expect((editor.getShape(id) as any).props.color).toBe('red');
  });

  it('resizes a shape with "double" instruction', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 100, h: 100 } });

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, resizeInstruction: 'double' }],
    }]);

    const shape = editor.getShape(id) as any;
    expect(shape.props.w).toBeCloseTo(200);
    expect(shape.props.h).toBeCloseTo(200);
  });

  it('resizes a shape with "half" instruction', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 200, h: 200 } });

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, resizeInstruction: 'half' }],
    }]);

    const shape = editor.getShape(id) as any;
    expect(shape.props.w).toBeCloseTo(100);
    expect(shape.props.h).toBeCloseTo(100);
  });

  it('moves a shape left', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 100, h: 100 } });
    const originalX = editor.getShape(id)!.x;

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, moveInstruction: 'left' }],
    }]);

    expect(editor.getShape(id)!.x).toBeLessThan(originalX);
  });

  it('moves a shape right', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 100, h: 100 } });
    const originalX = editor.getShape(id)!.x;

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, moveInstruction: 'right' }],
    }]);

    expect(editor.getShape(id)!.x).toBeGreaterThan(originalX);
  });

  it('moves a shape up', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 100, h: 100 } });
    const originalY = editor.getShape(id)!.y;

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, moveInstruction: 'up' }],
    }]);

    expect(editor.getShape(id)!.y).toBeLessThan(originalY);
  });

  it('moves a shape down', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'geo', x: 800, y: 800, props: { w: 100, h: 100 } });
    const originalY = editor.getShape(id)!.y;

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: id, moveInstruction: 'down' }],
    }]);

    expect(editor.getShape(id)!.y).toBeGreaterThan(originalY);
  });

  it('applies multiple updates in one call', () => {
    const id1 = createShapeId();
    const id2 = createShapeId();
    editor.createShape({ id: id1, type: 'note', x: 800, y: 800, props: { text: 'A', color: 'yellow' } });
    editor.createShape({ id: id2, type: 'note', x: 900, y: 800, props: { text: 'B', color: 'green' } });

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [
        { shapeId: id1, newText: 'A Updated', newColor: 'red' },
        { shapeId: id2, newText: 'B Updated', newColor: 'blue' },
      ],
    }]);

    expect((editor.getShape(id1) as any).props.text).toBe('A Updated');
    expect((editor.getShape(id1) as any).props.color).toBe('red');
    expect((editor.getShape(id2) as any).props.text).toBe('B Updated');
    expect((editor.getShape(id2) as any).props.color).toBe('blue');
  });

  it('skips updates for non-existent shapes without crashing', () => {
    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:nonexistent', newText: 'Nope' }],
    }]);

    // Should not throw — just silently skip
    expect(editor.getCurrentPageShapes()).toHaveLength(0);
  });

  it('fit-to-content resizes a frame to fit its children', () => {
    // Create a frame with children
    const frameId = createShapeId();
    editor.createShape({
      id: frameId,
      type: 'frame',
      x: 800, y: 800,
      props: { w: 600, h: 600, name: 'Test' },
    });

    const noteId = createShapeId();
    editor.createShape({
      id: noteId,
      type: 'note',
      x: 30, y: 60,
      parentId: frameId,
      props: { text: 'Child note' },
    } as Parameters<typeof editor.createShape>[0]);

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: frameId as string, resizeInstruction: 'fit-to-content' }],
    }]);

    const frame = editor.getShape(frameId) as any;
    // Frame should have been resized (not still 600x600)
    expect(frame.props.w).toBeLessThan(600);
    expect(frame.props.h).toBeLessThan(600);
  });

  it('closer-together moves shapes toward centroid', () => {
    const id1 = createShapeId();
    const id2 = createShapeId();
    editor.createShape({ id: id1, type: 'geo', x: 100, y: 800, props: { w: 50, h: 50 } });
    editor.createShape({ id: id2, type: 'geo', x: 500, y: 800, props: { w: 50, h: 50 } });

    const x1Before = editor.getShape(id1)!.x;
    const x2Before = editor.getShape(id2)!.x;

    resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [
        { shapeId: id1, moveInstruction: 'closer-together' },
        { shapeId: id2, moveInstruction: 'closer-together' },
      ],
    }]);

    const x1After = editor.getShape(id1)!.x;
    const x2After = editor.getShape(id2)!.x;

    // They should move closer — gap should decrease
    expect(x2After - x1After).toBeLessThan(x2Before - x1Before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. layoutElements resolver
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — layoutElements', () => {

  function createThreeNotes(): TLShapeId[] {
    const ids = [createShapeId(), createShapeId(), createShapeId()];
    // Place notes far apart and outside frame bounds to avoid auto-parenting
    editor.createShape({ id: ids[0], type: 'note', x: 800, y: 800, props: { text: '1' } });
    editor.createShape({ id: ids[1], type: 'note', x: 900, y: 900, props: { text: '2' } });
    editor.createShape({ id: ids[2], type: 'note', x: 1000, y: 1000, props: { text: '3' } });
    return ids;
  }

  it('arranges shapes in a horizontal-row', () => {
    const ids = createThreeNotes();

    resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: ids as string[],
      layoutType: 'horizontal-row',
    }]);

    const shapes = ids.map((id) => editor.getShape(id)!);
    // All same y
    expect(shapes[0].y).toBeCloseTo(shapes[1].y);
    expect(shapes[1].y).toBeCloseTo(shapes[2].y);
    // x increases
    expect(shapes[1].x).toBeGreaterThan(shapes[0].x);
    expect(shapes[2].x).toBeGreaterThan(shapes[1].x);
  });

  it('arranges shapes in a vertical-column', () => {
    const ids = createThreeNotes();

    resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: ids as string[],
      layoutType: 'vertical-column',
    }]);

    const shapes = ids.map((id) => editor.getShape(id)!);
    // All same x
    expect(shapes[0].x).toBeCloseTo(shapes[1].x);
    expect(shapes[1].x).toBeCloseTo(shapes[2].x);
    // y increases
    expect(shapes[1].y).toBeGreaterThan(shapes[0].y);
    expect(shapes[2].y).toBeGreaterThan(shapes[1].y);
  });

  it('arranges shapes in a grid', () => {
    const ids = [createShapeId(), createShapeId(), createShapeId(), createShapeId()];
    for (let i = 0; i < ids.length; i++) {
      editor.createShape({ id: ids[i], type: 'note', x: 800 + i * 10, y: 800 + i * 10, props: { text: `${i}` } });
    }

    resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: ids as string[],
      layoutType: 'grid',
    }]);

    const shapes = ids.map((id) => editor.getShape(id)!);
    // With 4 items, grid should be 2x2 (ceil(sqrt(4)) = 2)
    // Row 1: shapes[0] and shapes[1] — same y
    expect(shapes[0].y).toBeCloseTo(shapes[1].y);
    // Row 2: shapes[2] and shapes[3] — same y, different from row 1
    expect(shapes[2].y).toBeCloseTo(shapes[3].y);
    expect(shapes[2].y).toBeGreaterThan(shapes[0].y);
  });

  it('skips layout with fewer than 2 valid shapes', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'note', x: 800, y: 800, props: { text: '1' } });
    const originalX = editor.getShape(id)!.x;

    resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: [id as string],
      layoutType: 'horizontal-row',
    }]);

    // Shape should not have moved
    expect(editor.getShape(id)!.x).toBe(originalX);
  });

  it('ignores non-existent shape IDs without crashing', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'note', x: 800, y: 800, props: { text: '1' } });

    resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: [id as string, 'shape:nonexistent'],
      layoutType: 'horizontal-row',
    }]);

    // Only 1 valid shape, so layout is skipped
    expect(editor.getShape(id)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. createDiagram resolver
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — createDiagram', () => {

  it('creates a SWOT diagram with 4 frames', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'swot',
      title: 'Product SWOT',
      sections: [
        { sectionTitle: 'Strengths', items: ['Fast', 'Cheap'] },
        { sectionTitle: 'Weaknesses', items: ['Small team'] },
        { sectionTitle: 'Opportunities', items: ['New market'] },
        { sectionTitle: 'Threats', items: ['Competitors'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(4);

    const notes = shapesOfType(editor, 'note');
    // 2 + 1 + 1 + 1 = 5 sticky notes
    expect(notes).toHaveLength(5);
  });

  it('SWOT frames are arranged in a 2x2 grid', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'swot',
      title: 'Test',
      sections: [
        { sectionTitle: 'S', items: ['a'] },
        { sectionTitle: 'W', items: ['b'] },
        { sectionTitle: 'O', items: ['c'] },
        { sectionTitle: 'T', items: ['d'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame').sort((a, b) => a.x - b.x || a.y - b.y);
    // Top row: frames[0] and frames[1] at same y
    // (Sort by x then y gives top-left, top-right, bottom-left, bottom-right)
    const ys = frames.map((f) => f.y);
    const xs = frames.map((f) => f.x);

    // Two distinct y values (2 rows)
    const uniqueYs = [...new Set(ys.map((y) => Math.round(y)))];
    expect(uniqueYs).toHaveLength(2);

    // Two distinct x values (2 columns)
    const uniqueXs = [...new Set(xs.map((x) => Math.round(x)))];
    expect(uniqueXs).toHaveLength(2);
  });

  it('notes are parented to their frames', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'swot',
      title: 'Nested',
      sections: [
        { sectionTitle: 'S', items: ['item1', 'item2'] },
        { sectionTitle: 'W', items: ['item3'] },
        { sectionTitle: 'O', items: [] },
        { sectionTitle: 'T', items: ['item4'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    const notes = shapesOfType(editor, 'note');

    // Every note should have a frame as its parent
    for (const note of notes) {
      const parent = frames.find((f) => f.id === note.parentId);
      expect(parent).toBeDefined();
    }
  });

  it('creates a kanban board with horizontal columns', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Sprint Board',
      sections: [
        { sectionTitle: 'To Do', items: ['Task 1', 'Task 2'] },
        { sectionTitle: 'In Progress', items: ['Task 3'] },
        { sectionTitle: 'Done', items: ['Task 4'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(3);

    // All frames at same y (horizontal layout)
    const ys = frames.map((f) => Math.round(f.y));
    expect(new Set(ys).size).toBe(1);

    // x increases left to right
    const sorted = [...frames].sort((a, b) => a.x - b.x);
    expect(sorted[1].x).toBeGreaterThan(sorted[0].x);
    expect(sorted[2].x).toBeGreaterThan(sorted[1].x);

    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(4);
  });

  it('creates a user journey with arrows between stages', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'user_journey',
      title: 'Onboarding',
      sections: [
        { sectionTitle: 'Signup', items: ['Enter email'] },
        { sectionTitle: 'Verify', items: ['Check inbox'] },
        { sectionTitle: 'Setup', items: ['Choose plan'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(3);

    // Arrows connect sequential frames
    const arrows = shapesOfType(editor, 'arrow');
    expect(arrows).toHaveLength(2); // 3 stages → 2 arrows

    // Each arrow should have 2 bindings
    for (const arrow of arrows) {
      const bindings = editor.getBindingsFromShape(arrow.id as TLShapeId, 'arrow');
      expect(bindings).toHaveLength(2);
    }
  });

  it('creates a retrospective with columns', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'retrospective',
      title: 'Sprint Retro',
      sections: [
        { sectionTitle: 'What Went Well', items: ['Shipped on time'] },
        { sectionTitle: 'What Didn\'t', items: ['Too many bugs'] },
        { sectionTitle: 'Action Items', items: ['Add tests'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(3);
    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(3);
  });

  it('frame heights accommodate all notes without cropping', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Tall Column',
      sections: [
        { sectionTitle: 'Many Items', items: ['1', '2', '3', '4', '5', '6'] },
      ],
    }]);

    const frame = shapesOfType(editor, 'frame')[0] as any;
    const notes = shapesOfType(editor, 'note');

    // Frame should be tall enough for all 6 notes
    for (const note of notes) {
      const noteBounds = editor.getShapePageBounds(note.id as TLShapeId);
      const frameBounds = editor.getShapePageBounds(frame.id as TLShapeId);
      // Note bottom should be within frame bounds
      expect(noteBounds!.maxY).toBeLessThanOrEqual(frameBounds!.maxY);
    }
  });

  it('SWOT frames do not overlap (label spacing)', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'swot',
      title: 'Overlap Test',
      sections: [
        { sectionTitle: 'Strengths', items: ['a', 'b'] },
        { sectionTitle: 'Weaknesses', items: ['c'] },
        { sectionTitle: 'Opportunities', items: ['d'] },
        { sectionTitle: 'Threats', items: ['e'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(4);

    // Check that no two frame bounding boxes overlap
    const bounds = frames.map((f) => editor.getShapePageBounds(f.id as TLShapeId)!);
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i];
        const b = bounds[j];
        const overlapsX = a.x < b.maxX && a.maxX > b.x;
        const overlapsY = a.y < b.maxY && a.maxY > b.y;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it('column frames have space above for labels', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Label Test',
      sections: [
        { sectionTitle: 'Todo', items: ['Task 1'] },
        { sectionTitle: 'Done', items: ['Task 2'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(2);

    // All frames should start at the same y (with label offset)
    // and that y should be > the findStartPosition base (at least 28px offset)
    const ys = frames.map((f) => f.y);
    expect(ys[0]).toBeCloseTo(ys[1]);
    // The label height offset means frames start further down than the raw start
    expect(ys[0]).toBeGreaterThanOrEqual(128); // base 100 + 28 label height
  });

  it('sections with empty items still create frames', () => {
    resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Sparse',
      sections: [
        { sectionTitle: 'Empty Column', items: [] },
        { sectionTitle: 'Has Items', items: ['One'] },
      ],
    }]);

    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(2);
    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Multi-call dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — multi-call dispatch', () => {

  it('processes multiple tool calls in sequence', () => {
    // First: create elements, then create a diagram
    resolveToolCalls(editor, [
      {
        tool: 'createElements',
        elements: [{ type: 'sticky', text: 'Standalone' }],
      },
      {
        tool: 'createDiagram',
        diagramType: 'kanban',
        title: 'Board',
        sections: [
          { sectionTitle: 'Todo', items: ['Task'] },
        ],
      },
    ]);

    const notes = shapesOfType(editor, 'note');
    expect(notes).toHaveLength(2); // 1 standalone + 1 in diagram
    const frames = shapesOfType(editor, 'frame');
    expect(frames).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Affected shape IDs returned for camera animation (F2)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveToolCalls — returns affected shape IDs', () => {

  it('returns created IDs from createElements', () => {
    const ids = resolveToolCalls(editor, [{
      tool: 'createElements',
      elements: [
        { type: 'sticky', text: 'A' },
        { type: 'shape', text: 'B' },
      ],
    }]);

    expect(ids).toHaveLength(2);
    // Each returned ID should correspond to a shape on the page
    for (const id of ids) {
      expect(editor.getShape(id as TLShapeId)).toBeDefined();
    }
  });

  it('returns updated IDs from updateElements', () => {
    const id1 = createShapeId();
    const id2 = createShapeId();
    editor.createShape({ id: id1, type: 'note', x: 800, y: 800, props: { text: 'A' } });
    editor.createShape({ id: id2, type: 'note', x: 900, y: 800, props: { text: 'B' } });

    const ids = resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [
        { shapeId: id1 as string, newText: 'A2' },
        { shapeId: id2 as string, newText: 'B2' },
      ],
    }]);

    expect(ids).toHaveLength(2);
    expect(ids).toContain(id1 as string);
    expect(ids).toContain(id2 as string);
  });

  it('returns empty array when updating non-existent shapes', () => {
    const ids = resolveToolCalls(editor, [{
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:nonexistent', newText: 'Nope' }],
    }]);

    expect(ids).toHaveLength(0);
  });

  it('returns rearranged IDs from layoutElements', () => {
    const noteIds = [createShapeId(), createShapeId(), createShapeId()];
    editor.createShape({ id: noteIds[0], type: 'note', x: 800, y: 800, props: { text: '1' } });
    editor.createShape({ id: noteIds[1], type: 'note', x: 900, y: 900, props: { text: '2' } });
    editor.createShape({ id: noteIds[2], type: 'note', x: 1000, y: 1000, props: { text: '3' } });

    const ids = resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: noteIds as string[],
      layoutType: 'horizontal-row',
    }]);

    expect(ids).toHaveLength(3);
  });

  it('returns empty array from layoutElements with fewer than 2 shapes', () => {
    const id = createShapeId();
    editor.createShape({ id, type: 'note', x: 800, y: 800, props: { text: '1' } });

    const ids = resolveToolCalls(editor, [{
      tool: 'layoutElements',
      shapeIds: [id as string],
      layoutType: 'grid',
    }]);

    expect(ids).toHaveLength(0);
  });

  it('returns all IDs (frames + notes) from createDiagram', () => {
    const ids = resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Board',
      sections: [
        { sectionTitle: 'Todo', items: ['Task 1', 'Task 2'] },
        { sectionTitle: 'Done', items: ['Task 3'] },
      ],
    }]);

    // 2 frames + 3 notes = 5 IDs total
    expect(ids).toHaveLength(5);
    const frames = shapesOfType(editor, 'frame');
    const notes = shapesOfType(editor, 'note');
    for (const f of frames) {
      expect(ids).toContain(f.id as string);
    }
    for (const n of notes) {
      expect(ids).toContain(n.id as string);
    }
  });

  it('returns all IDs (frames + notes + arrows) from user journey', () => {
    const ids = resolveToolCalls(editor, [{
      tool: 'createDiagram',
      diagramType: 'user_journey',
      title: 'Flow',
      sections: [
        { sectionTitle: 'Step 1', items: ['Do A'] },
        { sectionTitle: 'Step 2', items: ['Do B'] },
        { sectionTitle: 'Step 3', items: ['Do C'] },
      ],
    }]);

    // 3 frames + 3 notes + 2 arrows = 8 IDs
    expect(ids).toHaveLength(8);
    const arrows = shapesOfType(editor, 'arrow');
    for (const a of arrows) {
      expect(ids).toContain(a.id as string);
    }
  });

  it('aggregates IDs across multiple tool calls', () => {
    const ids = resolveToolCalls(editor, [
      {
        tool: 'createElements',
        elements: [{ type: 'sticky', text: 'Standalone' }],
      },
      {
        tool: 'createDiagram',
        diagramType: 'kanban',
        title: 'Board',
        sections: [
          { sectionTitle: 'Todo', items: ['Task'] },
        ],
      },
    ]);

    // 1 standalone note + 1 frame + 1 note = 3 IDs
    expect(ids).toHaveLength(3);
  });
});
