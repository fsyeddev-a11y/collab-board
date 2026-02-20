/**
 * AI Tool-Call Resolver
 *
 * Takes the array of intent-based tool calls from the AI agent and converts
 * them into real tldraw Editor API calls.  Handles:
 *
 *  - createFrame  → editor.createShape({ type: 'frame', ... })
 *  - createLayout → editor.createShape({ type: 'note', ... }) for each item
 *  - createConnector → editor.createShape({ type: 'arrow', ... }) + bindings
 *  - moveObject   → editor.nudgeShapes(...)
 *
 * The agent returns ref IDs ("ref:frame_1") that this resolver maps to real
 * tldraw shape IDs as they are created.
 */

import type { Editor } from '@tldraw/editor';
import { createShapeId } from 'tldraw';

// ── Types matching the shared ToolCall schemas ────────────────────────────────

interface LayoutItem {
  text: string;
  color?: string;
}

interface CreateFrameCall {
  tool: 'createFrame';
  ref: string;
  label: string;
  position?: string;
  size?: string;
}

interface CreateLayoutCall {
  tool: 'createLayout';
  ref: string;
  layoutType: string;
  items: LayoutItem[];
  frameLabel?: string;
  frameRef?: string;
  targetFrameRef?: string;
}

interface CreateConnectorCall {
  tool: 'createConnector';
  ref: string;
  fromRef: string;
  toRef: string;
  label?: string;
}

interface MoveObjectCall {
  tool: 'moveObject';
  shapeId: string;
  direction: string;
  distance?: string;
}

type ToolCall =
  | CreateFrameCall
  | CreateLayoutCall
  | CreateConnectorCall
  | MoveObjectCall;

// ── Layout geometry constants ─────────────────────────────────────────────────

const FRAME_SIZES = {
  small:  { w: 280, h: 350 },
  medium: { w: 380, h: 450 },
  large:  { w: 500, h: 600 },
} as const;

const FRAME_GAP = 40;

// Position hints → starting X offset (frames laid out left-to-right)
const POSITION_ORDER = ['left', 'center', 'right', 'far-right'] as const;

const NOTE_W = 200;
const NOTE_H = 200;
const NOTE_GAP = 20;
const NOTE_PADDING = 30; // padding inside frame

const MOVE_DISTANCES = { small: 50, medium: 150, large: 300 } as const;

// ── Ref → ShapeId map ─────────────────────────────────────────────────────────

type RefMap = Map<string, string>; // "ref:frame_1" → "shape:abc123"

// ── Main resolver ─────────────────────────────────────────────────────────────

export function resolveToolCalls(editor: Editor, toolCalls: ToolCall[]): void {
  const refMap: RefMap = new Map();

  // Pre-scan: assign frame positions based on order of appearance and position hints.
  const frameCalls = toolCalls.filter(
    (c): c is CreateFrameCall => c.tool === 'createFrame',
  );
  const framePositions = computeFramePositions(editor, frameCalls);

  editor.batch(() => {
    for (const call of toolCalls) {
      switch (call.tool) {
        case 'createFrame':
          resolveCreateFrame(editor, call, refMap, framePositions);
          break;
        case 'createLayout':
          resolveCreateLayout(editor, call, refMap);
          break;
        case 'createConnector':
          resolveCreateConnector(editor, call, refMap);
          break;
        case 'moveObject':
          resolveMoveObject(editor, call);
          break;
      }
    }
  });
}

// ── Frame positioning ─────────────────────────────────────────────────────────

function computeFramePositions(
  editor: Editor,
  frameCalls: CreateFrameCall[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Find a clear starting area (below/right of existing content).
  const shapes = editor.getCurrentPageShapes();
  let startX = 100;
  let startY = 100;

  if (shapes.length > 0) {
    const allBounds = shapes
      .map((s) => editor.getShapePageBounds(s.id))
      .filter(Boolean);
    if (allBounds.length > 0) {
      const maxY = Math.max(...allBounds.map((b) => b!.maxY));
      startY = maxY + 80;
    }
  }

  // Sort frames by position hint, then by order of appearance.
  const sorted = [...frameCalls].sort((a, b) => {
    const ai = POSITION_ORDER.indexOf(
      (a.position ?? 'auto') as (typeof POSITION_ORDER)[number],
    );
    const bi = POSITION_ORDER.indexOf(
      (b.position ?? 'auto') as (typeof POSITION_ORDER)[number],
    );
    // 'auto' → -1 (indexOf miss), treat as insertion order
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  let curX = startX;
  for (const call of sorted) {
    const dims = FRAME_SIZES[(call.size ?? 'medium') as keyof typeof FRAME_SIZES] ?? FRAME_SIZES.medium;
    positions.set(call.ref, { x: curX, y: startY });
    curX += dims.w + FRAME_GAP;
  }

  return positions;
}

// ── Individual resolvers ──────────────────────────────────────────────────────

function resolveCreateFrame(
  editor: Editor,
  call: CreateFrameCall,
  refMap: RefMap,
  framePositions: Map<string, { x: number; y: number }>,
): void {
  const id = createShapeId();
  const pos = framePositions.get(call.ref) ?? { x: 100, y: 100 };
  const dims = FRAME_SIZES[(call.size ?? 'medium') as keyof typeof FRAME_SIZES] ?? FRAME_SIZES.medium;

  editor.createShape({
    id,
    type: 'frame',
    x: pos.x,
    y: pos.y,
    props: { w: dims.w, h: dims.h, name: call.label },
  });

  refMap.set(call.ref, id);
}

function resolveCreateLayout(
  editor: Editor,
  call: CreateLayoutCall,
  refMap: RefMap,
): void {
  // If targeting a frame ref, look up the real shape ID.
  const parentRef = call.targetFrameRef ?? call.frameRef;
  const parentId = parentRef ? refMap.get(parentRef) : undefined;

  // If frameLabel is set and no parent exists, create a wrapper frame.
  let frameId = parentId;
  if (!frameId && call.frameLabel) {
    const fid = createShapeId();
    const shapes = editor.getCurrentPageShapes();
    let startX = 100;
    let startY = 100;
    if (shapes.length > 0) {
      const allBounds = shapes.map((s) => editor.getShapePageBounds(s.id)).filter(Boolean);
      if (allBounds.length > 0) {
        startY = Math.max(...allBounds.map((b) => b!.maxY)) + 80;
      }
    }
    const cols = Math.ceil(Math.sqrt(call.items.length));
    const rows = Math.ceil(call.items.length / cols);
    const fw = cols * (NOTE_W + NOTE_GAP) + NOTE_PADDING * 2 - NOTE_GAP;
    const fh = rows * (NOTE_H + NOTE_GAP) + NOTE_PADDING * 2 - NOTE_GAP + 30; // +30 for frame header

    editor.createShape({
      id: fid,
      type: 'frame',
      x: startX,
      y: startY,
      props: { w: fw, h: fh, name: call.frameLabel },
    });
    frameId = fid;
    if (call.frameRef) refMap.set(call.frameRef, fid);
  }

  // Compute note positions based on layout type.
  const notePositions = computeNotePositions(call.layoutType, call.items.length, frameId, editor, refMap);

  for (let i = 0; i < call.items.length; i++) {
    const item = call.items[i];
    const pos = notePositions[i];
    const noteId = createShapeId();

    const shapeData: Record<string, unknown> = {
      id: noteId,
      type: 'note',
      x: pos.x,
      y: pos.y,
      props: {
        text: item.text,
        color: item.color ?? 'yellow',
      },
    };

    // If inside a frame, set parentId so tldraw nests the note.
    if (frameId) {
      shapeData.parentId = frameId;
    }

    editor.createShape(shapeData as Parameters<typeof editor.createShape>[0]);
  }

  refMap.set(call.ref, call.items.length > 0 ? 'layout-group' : '');
}

function computeNotePositions(
  layoutType: string,
  count: number,
  frameId: string | undefined,
  editor: Editor,
  _refMap: RefMap,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];

  // If inside a frame, positions are LOCAL (relative to frame origin).
  // Start with padding offset. +30 y for frame header.
  const offsetX = frameId ? NOTE_PADDING : 0;
  const offsetY = frameId ? NOTE_PADDING + 30 : 0;

  // If not inside a frame, find a clear area on the canvas.
  let baseX = offsetX;
  let baseY = offsetY;

  if (!frameId) {
    const shapes = editor.getCurrentPageShapes();
    baseX = 100;
    baseY = 100;
    if (shapes.length > 0) {
      const allBounds = shapes.map((s) => editor.getShapePageBounds(s.id)).filter(Boolean);
      if (allBounds.length > 0) {
        baseY = Math.max(...allBounds.map((b) => b!.maxY)) + 80;
      }
    }
  }

  switch (layoutType) {
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push({
          x: baseX + col * (NOTE_W + NOTE_GAP),
          y: baseY + row * (NOTE_H + NOTE_GAP),
        });
      }
      break;
    }
    case 'list':
    case 'columns': {
      // Simple vertical list
      for (let i = 0; i < count; i++) {
        positions.push({
          x: baseX,
          y: baseY + i * (NOTE_H + NOTE_GAP),
        });
      }
      break;
    }
    case 'timeline': {
      // Horizontal row
      for (let i = 0; i < count; i++) {
        positions.push({
          x: baseX + i * (NOTE_W + NOTE_GAP),
          y: baseY,
        });
      }
      break;
    }
    case 'mindmap': {
      // First item is center, rest fan out around it
      if (count === 0) break;
      const centerX = baseX + 200;
      const centerY = baseY + 200;
      positions.push({ x: centerX, y: centerY });

      const radius = 280;
      for (let i = 1; i < count; i++) {
        const angle = ((i - 1) / (count - 1)) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }
      break;
    }
    default: {
      // Fallback: grid
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        positions.push({
          x: baseX + (i % cols) * (NOTE_W + NOTE_GAP),
          y: baseY + Math.floor(i / cols) * (NOTE_H + NOTE_GAP),
        });
      }
    }
  }

  return positions;
}

function resolveCreateConnector(
  editor: Editor,
  call: CreateConnectorCall,
  refMap: RefMap,
): void {
  // Resolve refs to real shape IDs.
  const fromId = refMap.get(call.fromRef) ?? call.fromRef;
  const toId = refMap.get(call.toRef) ?? call.toRef;

  // Only create if both targets exist on the canvas.
  if (!editor.getShape(fromId as Parameters<typeof editor.getShape>[0]) ||
      !editor.getShape(toId as Parameters<typeof editor.getShape>[0])) {
    console.warn('[aiResolver] Skipping connector — target not found:', call);
    return;
  }

  const arrowId = createShapeId();

  editor.createShape({
    id: arrowId,
    type: 'arrow',
    x: 0,
    y: 0,
    props: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      text: call.label ?? '',
    },
  });

  // Bind arrow terminals to the target shapes.
  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: fromId as Parameters<typeof editor.createBinding>[0]['toId'],
    props: {
      terminal: 'start',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
    },
  });

  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: toId as Parameters<typeof editor.createBinding>[0]['toId'],
    props: {
      terminal: 'end',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
    },
  });

  refMap.set(call.ref, arrowId);
}

function resolveMoveObject(editor: Editor, call: MoveObjectCall): void {
  const dist = MOVE_DISTANCES[(call.distance ?? 'medium') as keyof typeof MOVE_DISTANCES] ?? 150;

  const delta = { x: 0, y: 0 };
  switch (call.direction) {
    case 'left':  delta.x = -dist; break;
    case 'right': delta.x = dist;  break;
    case 'up':    delta.y = -dist; break;
    case 'down':  delta.y = dist;  break;
  }

  const shapeId = call.shapeId as ReturnType<typeof createShapeId>;
  if (!editor.getShape(shapeId)) {
    console.warn('[aiResolver] Skipping move — shape not found:', call.shapeId);
    return;
  }

  editor.nudgeShapes([shapeId], delta);
}
