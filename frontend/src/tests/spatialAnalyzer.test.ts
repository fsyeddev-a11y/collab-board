/**
 * Tests for the spatial analyzer — builds containment trees from tldraw shapes.
 *
 * Uses a headless tldraw Editor (no React rendering).
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
import { buildSpatialTree, buildConnections } from '../utils/spatialAnalyzer';

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

let editor: Editor;

beforeEach(() => { editor = createHeadlessEditor(); });
afterEach(() => { editor.dispose(); });

// ─────────────────────────────────────────────────────────────────────────────
// Basic containment
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — containment', () => {

  it('shape inside frame becomes a child', () => {
    const frameId = createShapeId();
    const rectId = createShapeId();

    editor.createShape({
      id: frameId,
      type: 'frame',
      x: 100, y: 100,
      props: { w: 400, h: 400, name: 'Container' },
    });
    editor.createShape({
      id: rectId,
      type: 'geo',
      x: 150, y: 150,
      props: { w: 100, h: 60, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [frameId, rectId]);

    expect(tree).toHaveLength(1);
    expect(tree[0].shapeId).toBe(frameId);
    expect(tree[0].type).toBe('frame');
    expect(tree[0].label).toBe('Container');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].shapeId).toBe(rectId);
  });

  it('non-overlapping shapes are siblings at root', () => {
    const id1 = createShapeId();
    const id2 = createShapeId();

    editor.createShape({
      id: id1,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 100, h: 100, geo: 'rectangle' },
    });
    editor.createShape({
      id: id2,
      type: 'geo',
      x: 300, y: 100,
      props: { w: 100, h: 100, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [id1, id2]);

    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });

  it('nested containment: frame > frame > shape', () => {
    const outerFrame = createShapeId();
    const innerFrame = createShapeId();
    const rectId = createShapeId();

    editor.createShape({
      id: outerFrame,
      type: 'frame',
      x: 100, y: 100,
      props: { w: 600, h: 600, name: 'Outer' },
    });
    editor.createShape({
      id: innerFrame,
      type: 'frame',
      x: 150, y: 150,
      props: { w: 300, h: 300, name: 'Inner' },
    });
    editor.createShape({
      id: rectId,
      type: 'geo',
      x: 200, y: 200,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [outerFrame, innerFrame, rectId]);

    expect(tree).toHaveLength(1);
    expect(tree[0].shapeId).toBe(outerFrame);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].shapeId).toBe(innerFrame);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].shapeId).toBe(rectId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arrow filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — arrow filtering', () => {

  it('filters out arrow shapes', () => {
    const rectId = createShapeId();
    const arrowId = createShapeId();

    editor.createShape({
      id: rectId,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 100, h: 100, geo: 'rectangle' },
    });
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: 200, y: 200,
    });

    const tree = buildSpatialTree(editor, [rectId, arrowId]);

    expect(tree).toHaveLength(1);
    expect(tree[0].shapeId).toBe(rectId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sorting (Y then X with tolerance)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — sorting', () => {

  it('sorts siblings by Y then X', () => {
    const topLeft = createShapeId();
    const topRight = createShapeId();
    const bottomLeft = createShapeId();

    // Create in reverse order
    editor.createShape({
      id: bottomLeft,
      type: 'geo',
      x: 100, y: 300,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });
    editor.createShape({
      id: topRight,
      type: 'geo',
      x: 300, y: 100,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });
    editor.createShape({
      id: topLeft,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [bottomLeft, topRight, topLeft]);

    // topLeft and topRight are in same Y band, sorted by X
    expect(tree[0].shapeId).toBe(topLeft);
    expect(tree[1].shapeId).toBe(topRight);
    expect(tree[2].shapeId).toBe(bottomLeft);
  });

  it('shapes within Y tolerance band are sorted by X', () => {
    const a = createShapeId();
    const b = createShapeId();

    // Y diff is only 10px (within 20px tolerance)
    editor.createShape({
      id: b,
      type: 'geo',
      x: 300, y: 105,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });
    editor.createShape({
      id: a,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 80, h: 40, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [b, a]);

    expect(tree[0].shapeId).toBe(a); // smaller X first
    expect(tree[1].shapeId).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sizeHint values
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — sizeHint', () => {

  it('sizeHint maps pixels to categorical values', () => {
    const narrow = createShapeId();
    const wide = createShapeId();
    editor.createShape({
      id: narrow,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 150, h: 80, geo: 'rectangle' },
    });
    editor.createShape({
      id: wide,
      type: 'geo',
      x: 800, y: 800,
      props: { w: 600, h: 400, geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [narrow, wide]);
    const narrowNode = tree.find((n) => n.shapeId === narrow)!;
    const wideNode = tree.find((n) => n.shapeId === wide)!;

    // 150px wide, 80px tall → narrow, short
    expect(narrowNode.sizeHint.width).toBe('narrow');
    expect(narrowNode.sizeHint.height).toBe('short');

    // 600px wide, 400px tall → wide, tall
    expect(wideNode.sizeHint.width).toBe('wide');
    expect(wideNode.sizeHint.height).toBe('tall');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Label extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — labels', () => {

  it('extracts text from geo shape props.text', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 100, h: 60, text: 'Submit', geo: 'rectangle' },
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree[0].label).toBe('Submit');
  });

  it('extracts name from frame props.name', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'frame',
      x: 100, y: 100,
      props: { w: 300, h: 200, name: 'Header Section' },
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree[0].label).toBe('Header Section');
  });

  it('extracts text from note shape', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'note',
      x: 800, y: 800,
      props: { text: 'Card content' },
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree[0].label).toBe('Card content');
  });

  it('extracts text from text shape', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'text',
      x: 100, y: 100,
      props: { text: 'Heading' },
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree[0].label).toBe('Heading');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — edge cases', () => {

  it('returns empty array for empty selection', () => {
    const tree = buildSpatialTree(editor, []);
    expect(tree).toEqual([]);
  });

  it('returns empty array when all shapes are arrows', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'arrow',
      x: 100, y: 100,
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree).toEqual([]);
  });

  it('handles non-existent shape IDs gracefully', () => {
    const tree = buildSpatialTree(editor, ['shape:nonexistent' as TLShapeId]);
    expect(tree).toEqual([]);
  });

  it('expands selection to include tldraw-parented children of frames', () => {
    // Simulates: user selects a frame that has children parented to it in tldraw.
    // Only the frame ID is in the selection — children should be auto-included.
    const frameId = createShapeId();
    const childGeo = createShapeId();
    const childText = createShapeId();

    editor.createShape({
      id: frameId,
      type: 'frame',
      x: 100, y: 100,
      props: { w: 500, h: 400, name: 'Login Page' },
    });
    // Children are parented to the frame (local coords)
    editor.createShape({
      id: childGeo,
      type: 'geo',
      x: 50, y: 80,
      parentId: frameId,
      props: { w: 200, h: 50, text: 'Username', geo: 'rectangle' },
    } as Parameters<typeof editor.createShape>[0]);
    editor.createShape({
      id: childText,
      type: 'geo',
      x: 50, y: 160,
      parentId: frameId,
      props: { w: 200, h: 50, text: 'Password', geo: 'rectangle' },
    } as Parameters<typeof editor.createShape>[0]);

    // Only pass the frame ID — children should be expanded automatically
    const tree = buildSpatialTree(editor, [frameId]);

    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('Login Page');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].label).toBe('Username');
    expect(tree[0].children[1].label).toBe('Password');
  });

  it('includes geo property for geo shapes', () => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'geo',
      x: 100, y: 100,
      props: { w: 100, h: 100, geo: 'ellipse' },
    });

    const tree = buildSpatialTree(editor, [id]);
    expect(tree[0].geo).toBe('ellipse');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout type computation
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSpatialTree — layoutType', () => {

  it('detects row layout when children share similar Y coordinates', () => {
    const frame = createShapeId();
    const child1 = createShapeId();
    const child2 = createShapeId();
    const child3 = createShapeId();

    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 600, h: 100, name: 'toolbar' } });
    editor.createShape({ id: child1, type: 'geo', x: 10, y: 10, props: { w: 80, h: 40, geo: 'rectangle' } });
    editor.createShape({ id: child2, type: 'geo', x: 200, y: 10, props: { w: 80, h: 40, geo: 'rectangle' } });
    editor.createShape({ id: child3, type: 'geo', x: 400, y: 10, props: { w: 80, h: 40, geo: 'rectangle' } });

    const tree = buildSpatialTree(editor, [frame]);
    const frameNode = tree[0];
    expect(frameNode.layoutType).toBe('row');
    expect(frameNode.gridCols).toBeUndefined();
  });

  it('detects column layout when children are stacked vertically', () => {
    const frame = createShapeId();
    const child1 = createShapeId();
    const child2 = createShapeId();
    const child3 = createShapeId();

    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 200, h: 400, name: 'sidebar' } });
    editor.createShape({ id: child1, type: 'geo', x: 10, y: 10, props: { w: 100, h: 40, geo: 'rectangle' } });
    editor.createShape({ id: child2, type: 'geo', x: 10, y: 100, props: { w: 100, h: 40, geo: 'rectangle' } });
    editor.createShape({ id: child3, type: 'geo', x: 10, y: 200, props: { w: 100, h: 40, geo: 'rectangle' } });

    const tree = buildSpatialTree(editor, [frame]);
    expect(tree[0].layoutType).toBe('col');
  });

  it('detects grid layout with correct column count', () => {
    // 2x2 grid: 4 items arranged in 2 rows of 2
    const frame = createShapeId();
    const c1 = createShapeId();
    const c2 = createShapeId();
    const c3 = createShapeId();
    const c4 = createShapeId();

    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 400, h: 300, name: 'gallery' } });
    editor.createShape({ id: c1, type: 'geo', x: 10, y: 10, props: { w: 80, h: 80, geo: 'rectangle' } });
    editor.createShape({ id: c2, type: 'geo', x: 200, y: 10, props: { w: 80, h: 80, geo: 'rectangle' } });
    editor.createShape({ id: c3, type: 'geo', x: 10, y: 150, props: { w: 80, h: 80, geo: 'rectangle' } });
    editor.createShape({ id: c4, type: 'geo', x: 200, y: 150, props: { w: 80, h: 80, geo: 'rectangle' } });

    const tree = buildSpatialTree(editor, [frame]);
    expect(tree[0].layoutType).toBe('grid');
    expect(tree[0].gridCols).toBe(2);
  });

  it('frames with 0 children have no layoutType', () => {
    const emptyFrame = createShapeId();
    editor.createShape({ id: emptyFrame, type: 'frame', x: 0, y: 0, props: { w: 200, h: 200, name: 'empty' } });

    const tree = buildSpatialTree(editor, [emptyFrame]);
    expect(tree[0].layoutType).toBeUndefined();
  });

  it('frames with 1 child get col layoutType', () => {
    const frame = createShapeId();
    const child = createShapeId();

    editor.createShape({ id: frame, type: 'frame', x: 800, y: 800, props: { w: 200, h: 200, name: 'single' } });
    editor.createShape({ id: child, type: 'geo', x: 810, y: 810, props: { w: 50, h: 50, geo: 'rectangle' } });

    const tree = buildSpatialTree(editor, [frame]);
    expect(tree[0].layoutType).toBe('col');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arrow connection extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConnections', () => {

  it('extracts connections from bound arrows', () => {
    const btn = createShapeId();
    const target = createShapeId();
    const arrow = createShapeId();

    editor.createShape({ id: btn, type: 'geo', x: 0, y: 0, props: { w: 100, h: 40, geo: 'rectangle', text: 'Submit' } });
    editor.createShape({ id: target, type: 'frame', x: 300, y: 0, props: { w: 200, h: 200, name: 'Success Page' } });
    editor.createShape({ id: arrow, type: 'arrow', x: 100, y: 20, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, text: 'navigate' } });

    editor.createBinding({ type: 'arrow', fromId: arrow, toId: btn, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    editor.createBinding({ type: 'arrow', fromId: arrow, toId: target, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });

    const connections = buildConnections(editor, [btn, target, arrow]);
    expect(connections).toHaveLength(1);
    expect(connections[0].fromShapeId).toBe(btn as string);
    expect(connections[0].toShapeId).toBe(target as string);
    expect(connections[0].label).toBe('navigate');
  });

  it('excludes arrows where one endpoint is outside the selection', () => {
    const btn = createShapeId();
    const outsideTarget = createShapeId();
    const arrow = createShapeId();

    editor.createShape({ id: btn, type: 'geo', x: 0, y: 0, props: { w: 100, h: 40, geo: 'rectangle', text: 'Click' } });
    editor.createShape({ id: outsideTarget, type: 'frame', x: 500, y: 500, props: { w: 200, h: 200, name: 'Other' } });
    editor.createShape({ id: arrow, type: 'arrow', x: 100, y: 20, props: { start: { x: 0, y: 0 }, end: { x: 400, y: 400 }, text: '' } });

    editor.createBinding({ type: 'arrow', fromId: arrow, toId: btn, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    editor.createBinding({ type: 'arrow', fromId: arrow, toId: outsideTarget, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });

    // Only select btn and arrow — outsideTarget is NOT selected
    const connections = buildConnections(editor, [btn, arrow]);
    expect(connections).toHaveLength(0);
  });

  it('excludes unbound arrows (no bindings)', () => {
    const freeArrow = createShapeId();
    editor.createShape({ id: freeArrow, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, text: '' } });

    const connections = buildConnections(editor, [freeArrow]);
    expect(connections).toHaveLength(0);
  });

  it('handles arrows with empty labels', () => {
    const a = createShapeId();
    const b = createShapeId();
    const arrow = createShapeId();

    editor.createShape({ id: a, type: 'geo', x: 0, y: 0, props: { w: 50, h: 50, geo: 'rectangle' } });
    editor.createShape({ id: b, type: 'geo', x: 200, y: 0, props: { w: 50, h: 50, geo: 'rectangle' } });
    editor.createShape({ id: arrow, type: 'arrow', x: 50, y: 25, props: { start: { x: 0, y: 0 }, end: { x: 150, y: 0 } } });

    editor.createBinding({ type: 'arrow', fromId: arrow, toId: a, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    editor.createBinding({ type: 'arrow', fromId: arrow, toId: b, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });

    const connections = buildConnections(editor, [a, b, arrow]);
    expect(connections).toHaveLength(1);
    expect(connections[0].label).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Element hint classification
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyGeoElement (via buildSpatialTree)', () => {

  it('classifies "Username" as input with type text', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Username' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('text');
  });

  it('classifies "Email" as input with type email', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Email' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('email');
  });

  it('classifies "Password" as input with type password', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Password' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('password');
  });

  it('classifies "Search" as input with type search', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Search' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('search');
  });

  it('classifies "Phone" as input with type tel', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Phone' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('tel');
  });

  it('classifies "Submit" as button', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'Submit' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('button');
    expect(tree[0].inputType).toBeUndefined();
  });

  it('classifies "Home" as button (nav item)', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 100, h: 40, geo: 'rectangle', text: 'Home' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('button');
  });

  it('classifies empty label as button', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 100, h: 40, geo: 'rectangle', text: '' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('button');
  });

  it('is case-insensitive', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 200, h: 40, geo: 'rectangle', text: 'EMAIL ADDRESS' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].elementHint).toBe('input');
    expect(tree[0].inputType).toBe('email');
  });

  it('does not set elementHint on non-geo shapes', () => {
    const textShape = createShapeId();
    editor.createShape({ id: textShape, type: 'text', x: 800, y: 800, props: { text: 'Username' } });

    const tree = buildSpatialTree(editor, [textShape]);
    expect(tree[0].elementHint).toBeUndefined();
    expect(tree[0].inputType).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// alignSelf computation
// ─────────────────────────────────────────────────────────────────────────────

describe('alignSelf (via buildSpatialTree)', () => {

  it('computes alignSelf: end for a child in the right third of a col-layout frame', () => {
    const frame = createShapeId();
    const leftChild = createShapeId();
    const rightChild = createShapeId();

    // Frame is 600px wide. rightChild center is at x=500 + 80/2 = 540, relative = 540/600 = 0.9 → end
    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 600, h: 300, name: 'loginForm' } });
    editor.createShape({ id: leftChild, type: 'geo', x: 10, y: 10, props: { w: 200, h: 40, geo: 'rectangle', text: 'Username' } });
    editor.createShape({ id: rightChild, type: 'geo', x: 500, y: 100, props: { w: 80, h: 40, geo: 'rectangle', text: 'Submit' } });

    const tree = buildSpatialTree(editor, [frame]);
    const frameNode = tree[0];
    // leftChild center at x=10+100=110, relative=110/600=0.18 → start (omitted)
    const left = frameNode.children.find(c => c.label === 'Username')!;
    const right = frameNode.children.find(c => c.label === 'Submit')!;

    expect(left.alignSelf).toBeUndefined(); // start is omitted (default)
    expect(right.alignSelf).toBe('end');
  });

  it('computes alignSelf: center for a child in the middle third', () => {
    const frame = createShapeId();
    const child = createShapeId();

    // Frame is 600px wide. child center at x=250 + 100/2 = 300, relative = 300/600 = 0.5 → center
    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 600, h: 200, name: 'container' } });
    editor.createShape({ id: child, type: 'geo', x: 250, y: 50, props: { w: 100, h: 40, geo: 'rectangle', text: 'Centered Button' } });

    const tree = buildSpatialTree(editor, [frame]);
    expect(tree[0].children[0].alignSelf).toBe('center');
  });

  it('does not set alignSelf for children of row-layout frames', () => {
    const frame = createShapeId();
    const child1 = createShapeId();
    const child2 = createShapeId();

    // Two children side by side → row layout. alignSelf should not be computed.
    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0, props: { w: 600, h: 100, name: 'toolbar' } });
    editor.createShape({ id: child1, type: 'geo', x: 10, y: 10, props: { w: 80, h: 40, geo: 'rectangle', text: 'Home' } });
    editor.createShape({ id: child2, type: 'geo', x: 500, y: 10, props: { w: 80, h: 40, geo: 'rectangle', text: 'Settings' } });

    const tree = buildSpatialTree(editor, [frame]);
    expect(tree[0].layoutType).toBe('row');
    expect(tree[0].children[0].alignSelf).toBeUndefined();
    expect(tree[0].children[1].alignSelf).toBeUndefined();
  });

  it('does not set alignSelf for root-level shapes (no parent)', () => {
    const shape = createShapeId();
    editor.createShape({ id: shape, type: 'geo', x: 800, y: 800, props: { w: 100, h: 40, geo: 'rectangle', text: 'Orphan' } });

    const tree = buildSpatialTree(editor, [shape]);
    expect(tree[0].alignSelf).toBeUndefined();
  });
});
