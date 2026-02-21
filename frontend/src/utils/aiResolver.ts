/**
 * AI Tool-Call Resolver
 *
 * Takes the array of intent-based tool calls from the AI agent and converts
 * them into real tldraw Editor API calls.  Handles:
 *
 *  - createElements  → ad-hoc element creation (sticky, shape, text, connector)
 *  - updateElements  → batch edits with semantic instructions
 *  - layoutElements  → arrange existing shapes into layout patterns
 *  - createDiagram   → structured framed layouts (SWOT, kanban, etc.)
 *
 * The LLM outputs only declarative intent (no coordinates).
 * This resolver handles all canvas math and element placement.
 */

import type { Editor } from '@tldraw/editor';
import { createShapeId } from 'tldraw';

// ── Types matching the shared ToolCall schemas ────────────────────────────────

interface CreateElementEntry {
  type: 'sticky' | 'shape' | 'text' | 'connector' | 'frame';
  color?: string;
  text?: string;
}

interface CreateElementsCall {
  tool: 'createElements';
  elements: CreateElementEntry[];
}

interface ElementUpdate {
  shapeId: string;
  newText?: string;
  newColor?: string;
  resizeInstruction?: 'double' | 'half' | 'fit-to-content';
  moveInstruction?: 'left' | 'right' | 'up' | 'down' | 'closer-together';
}

interface UpdateElementsCall {
  tool: 'updateElements';
  updates: ElementUpdate[];
}

interface LayoutElementsCall {
  tool: 'layoutElements';
  shapeIds: string[];
  layoutType: 'grid' | 'horizontal-row' | 'vertical-column' | 'even-spacing';
}

interface DiagramSection {
  sectionTitle: string;
  items: string[];
}

interface CreateDiagramCall {
  tool: 'createDiagram';
  diagramType: string;
  title: string;
  sections: DiagramSection[];
}

type ToolCall = CreateElementsCall | UpdateElementsCall | LayoutElementsCall | CreateDiagramCall;

// ── Layout geometry constants ─────────────────────────────────────────────────

const NOTE_W = 200;
const NOTE_H = 200;
const NOTE_GAP = 20;
const NOTE_PADDING = 30;         // padding inside frame
const FRAME_HEADER = 30;         // frame header height
const FRAME_GAP = 40;            // gap between frames
const FRAME_BOTTOM_PADDING = 20; // extra breathing room at frame bottom
const MIN_FRAME_HEIGHT = 280;    // minimum frame height even with 0-1 items
const MOVE_DISTANCE = 150;       // pixels for move instructions
const FRAME_LABEL_HEIGHT = 28;   // tldraw renders frame name ABOVE frame bounds
const SECTION_COLORS = ['yellow', 'green', 'blue', 'orange', 'red', 'violet'] as const;

/** Calculate frame height to fully contain a vertical column of notes. */
function calcFrameHeight(itemCount: number): number {
  const contentH = itemCount * NOTE_H + Math.max(itemCount - 1, 0) * NOTE_GAP;
  return Math.max(MIN_FRAME_HEIGHT, FRAME_HEADER + NOTE_PADDING + contentH + FRAME_BOTTOM_PADDING);
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export function resolveToolCalls(editor: Editor, toolCalls: ToolCall[]): void {
  const createdFrameIds: string[] = [];

  editor.batch(() => {
    for (const call of toolCalls) {
      switch (call.tool) {
        case 'createElements':
          resolveCreateElements(editor, call);
          break;
        case 'updateElements':
          resolveUpdateElements(editor, call);
          break;
        case 'layoutElements':
          resolveLayoutElements(editor, call);
          break;
        case 'createDiagram':
          createdFrameIds.push(...resolveCreateDiagram(editor, call));
          break;
      }
    }
  });

  // Post-batch: bounds are now accurate. Resize frames to fit their children.
  if (createdFrameIds.length > 0) {
    fitFramesToChildren(editor, createdFrameIds);
  }
}

// ── Post-batch frame resize ──────────────────────────────────────────────────

function fitFramesToChildren(editor: Editor, frameIds: string[]): void {
  for (const fid of frameIds) {
    const frameId = fid as ReturnType<typeof createShapeId>;
    const children = editor.getSortedChildIdsForParent(frameId);
    if (children.length === 0) continue;

    const frameBounds = editor.getShapePageBounds(frameId);
    const childBounds = children
      .map((cid) => editor.getShapePageBounds(cid))
      .filter(Boolean);

    if (childBounds.length > 0 && frameBounds) {
      const contentMaxX = Math.max(...childBounds.map((b) => b!.maxX));
      const contentMaxY = Math.max(...childBounds.map((b) => b!.maxY));

      const neededW = (contentMaxX - frameBounds.x) + NOTE_PADDING;
      const neededH = (contentMaxY - frameBounds.y) + FRAME_BOTTOM_PADDING;

      editor.updateShape({
        id: frameId,
        type: 'frame',
        props: {
          w: Math.max(neededW, MIN_FRAME_HEIGHT),
          h: Math.max(neededH, MIN_FRAME_HEIGHT),
        },
      });
    }
  }
}

// ── Find clear canvas area ───────────────────────────────────────────────────

function findStartPosition(editor: Editor): { x: number; y: number } {
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

  return { x: startX, y: startY };
}

// ── 1. createElements resolver ──────────────────────────────────────────────

function resolveCreateElements(editor: Editor, call: CreateElementsCall): void {
  const start = findStartPosition(editor);

  // Place elements in a horizontal row
  for (let i = 0; i < call.elements.length; i++) {
    const el = call.elements[i];
    const x = start.x + i * (NOTE_W + NOTE_GAP);
    const y = start.y;
    const id = createShapeId();

    switch (el.type) {
      case 'sticky':
        editor.createShape({
          id,
          type: 'note',
          x,
          y,
          props: {
            text: el.text ?? '',
            color: el.color ?? 'yellow',
          },
        });
        break;

      case 'shape':
        editor.createShape({
          id,
          type: 'geo',
          x,
          y,
          props: {
            geo: 'rectangle',
            w: NOTE_W,
            h: NOTE_H,
            color: el.color ?? 'blue',
            fill: 'solid',
            text: el.text ?? '',
          },
        });
        break;

      case 'text':
        editor.createShape({
          id,
          type: 'text',
          x,
          y,
          props: {
            text: el.text ?? '',
            color: el.color ?? 'black',
          },
        } as Parameters<typeof editor.createShape>[0]);
        break;

      case 'connector':
        // Connectors without targets get placed as standalone arrows
        editor.createShape({
          id,
          type: 'arrow',
          x,
          y,
          props: {
            start: { x: 0, y: 0 },
            end: { x: 200, y: 0 },
            text: el.text ?? '',
          },
        });
        break;

      case 'frame':
        editor.createShape({
          id,
          type: 'frame',
          x,
          y,
          props: {
            w: 300,
            h: 300,
            name: el.text || 'Frame',
          },
        });
        break;
    }
  }
}

// ── 2. updateElements resolver ──────────────────────────────────────────────

function resolveUpdateElements(editor: Editor, call: UpdateElementsCall): void {
  for (const update of call.updates) {
    const shapeId = update.shapeId as ReturnType<typeof createShapeId>;
    const shape = editor.getShape(shapeId);

    if (!shape) {
      console.warn('[aiResolver] Skipping update — shape not found:', update.shapeId);
      continue;
    }

    // Apply text/color changes
    const props: Record<string, unknown> = {};
    if (update.newText !== undefined) props.text = update.newText;
    if (update.newColor !== undefined) {
      props.color = update.newColor;
      if (shape.type === 'geo') props.fill = 'solid';
    }

    if (Object.keys(props).length > 0) {
      editor.updateShape({ id: shapeId, type: shape.type, props });
    }

    // Apply resize instruction
    if (update.resizeInstruction) {
      const bounds = editor.getShapePageBounds(shapeId);
      if (bounds) {
        let newW = bounds.w;
        let newH = bounds.h;

        switch (update.resizeInstruction) {
          case 'double':
            newW = bounds.w * 2;
            newH = bounds.h * 2;
            break;
          case 'half':
            newW = bounds.w * 0.5;
            newH = bounds.h * 0.5;
            break;
          case 'fit-to-content': {
            if (shape.type === 'frame') {
              const children = editor.getSortedChildIdsForParent(shapeId);
              if (children.length > 0) {
                const frameBounds = editor.getShapePageBounds(shapeId);
                // Use page bounds for accurate child dimensions (handles growY, auto-size, etc.)
                const childBounds = children
                  .map((cid) => editor.getShapePageBounds(cid))
                  .filter(Boolean);
                if (childBounds.length > 0 && frameBounds) {
                  const contentMinX = Math.min(...childBounds.map((b) => b!.x));
                  const contentMaxX = Math.max(...childBounds.map((b) => b!.maxX));
                  const contentMinY = Math.min(...childBounds.map((b) => b!.y));
                  const contentMaxY = Math.max(...childBounds.map((b) => b!.maxY));
                  // Convert page-space content extent to local frame size
                  const contentW = contentMaxX - contentMinX;
                  const contentH = contentMaxY - contentMinY;
                  newW = Math.max(contentW + NOTE_PADDING * 2, MIN_FRAME_HEIGHT);
                  newH = Math.max(contentH + FRAME_HEADER + NOTE_PADDING + FRAME_BOTTOM_PADDING, MIN_FRAME_HEIGHT);
                }
              }
            }
            break;
          }
        }

        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: { w: newW, h: newH },
        });
      }
    }

    // Apply move instruction
    if (update.moveInstruction && update.moveInstruction !== 'closer-together') {
      const delta = { x: 0, y: 0 };
      switch (update.moveInstruction) {
        case 'left':  delta.x = -MOVE_DISTANCE; break;
        case 'right': delta.x = MOVE_DISTANCE;  break;
        case 'up':    delta.y = -MOVE_DISTANCE; break;
        case 'down':  delta.y = MOVE_DISTANCE;  break;
      }
      editor.nudgeShapes([shapeId], delta);
    }
  }

  // Handle 'closer-together' — move all affected shapes toward their centroid
  const closerShapes = call.updates
    .filter((u) => u.moveInstruction === 'closer-together')
    .map((u) => u.shapeId as ReturnType<typeof createShapeId>)
    .filter((id) => editor.getShape(id));

  if (closerShapes.length >= 2) {
    const bounds = closerShapes
      .map((id) => ({ id, b: editor.getShapePageBounds(id)! }))
      .filter((entry) => entry.b);

    const cx = bounds.reduce((sum, e) => sum + e.b.midX, 0) / bounds.length;
    const cy = bounds.reduce((sum, e) => sum + e.b.midY, 0) / bounds.length;

    for (const entry of bounds) {
      const dx = (cx - entry.b.midX) * 0.4; // move 40% closer to centroid
      const dy = (cy - entry.b.midY) * 0.4;
      editor.nudgeShapes([entry.id], { x: dx, y: dy });
    }
  }
}

// ── 3. layoutElements resolver ──────────────────────────────────────────────

function resolveLayoutElements(editor: Editor, call: LayoutElementsCall): void {
  const validIds = call.shapeIds
    .map((id) => id as ReturnType<typeof createShapeId>)
    .filter((id) => editor.getShape(id));

  if (validIds.length < 2) {
    console.warn('[aiResolver] layoutElements needs at least 2 valid shapes');
    return;
  }

  // Get current bounds to find a starting position
  const firstBounds = editor.getShapePageBounds(validIds[0]);
  const startX = firstBounds?.x ?? 100;
  const startY = firstBounds?.y ?? 100;

  // Get average dimensions for spacing
  const allBounds = validIds
    .map((id) => editor.getShapePageBounds(id))
    .filter(Boolean);
  const avgW = allBounds.reduce((sum, b) => sum + b!.w, 0) / allBounds.length;
  const avgH = allBounds.reduce((sum, b) => sum + b!.h, 0) / allBounds.length;

  switch (call.layoutType) {
    case 'horizontal-row': {
      let curX = startX;
      for (const id of validIds) {
        const shape = editor.getShape(id)!;
        editor.updateShape({ id, type: shape.type, x: curX, y: startY });
        curX += avgW + NOTE_GAP;
      }
      break;
    }

    case 'vertical-column': {
      let curY = startY;
      for (const id of validIds) {
        const shape = editor.getShape(id)!;
        editor.updateShape({ id, type: shape.type, x: startX, y: curY });
        curY += avgH + NOTE_GAP;
      }
      break;
    }

    case 'grid': {
      const cols = Math.ceil(Math.sqrt(validIds.length));
      for (let i = 0; i < validIds.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const shape = editor.getShape(validIds[i])!;
        editor.updateShape({
          id: validIds[i],
          type: shape.type,
          x: startX + col * (avgW + NOTE_GAP),
          y: startY + row * (avgH + NOTE_GAP),
        });
      }
      break;
    }

    case 'even-spacing': {
      // Spread evenly in a horizontal row with generous spacing
      const totalWidth = validIds.length * avgW;
      const spacing = (totalWidth + validIds.length * NOTE_GAP * 3) / (validIds.length - 1);
      for (let i = 0; i < validIds.length; i++) {
        const shape = editor.getShape(validIds[i])!;
        editor.updateShape({
          id: validIds[i],
          type: shape.type,
          x: startX + i * spacing,
          y: startY,
        });
      }
      break;
    }
  }
}

// ── 4. createDiagram resolver ───────────────────────────────────────────────

function resolveCreateDiagram(editor: Editor, call: CreateDiagramCall): string[] {
  switch (call.diagramType) {
    case 'swot':
      return layoutSwot(editor, call);
    case 'kanban':
    case 'retrospective':
    case 'custom_frame':
      return layoutColumns(editor, call);
    case 'user_journey':
      return layoutUserJourney(editor, call);
    default:
      return layoutColumns(editor, call);
  }
}

// ── SWOT: 2x2 grid of frames ────────────────────────────────────────────────

function layoutSwot(editor: Editor, call: CreateDiagramCall): string[] {
  const start = findStartPosition(editor);
  const adjustedStartY = start.y + FRAME_LABEL_HEIGHT; // room for first row's label
  const sections = call.sections.slice(0, 4);
  const allFrameIds: string[] = [];

  const frameW = NOTE_W + NOTE_PADDING * 2;

  const topRowH = Math.max(
    calcFrameHeight(sections[0]?.items.length ?? 0),
    calcFrameHeight(sections[1]?.items.length ?? 0),
  );

  // Create top row
  const topXPositions = [start.x, start.x + frameW + FRAME_GAP];
  for (let i = 0; i < Math.min(sections.length, 2); i++) {
    const fid = createFrameWithNotes(
      editor, sections[i], { x: topXPositions[i], y: adjustedStartY },
      frameW, topRowH, SECTION_COLORS[i % SECTION_COLORS.length],
    );
    allFrameIds.push(fid);
  }

  // Position bottom row using deterministic calculated height
  // (bounds aren't reliable inside editor.batch — post-batch resize handles fit)
  const bottomRowY = adjustedStartY + topRowH + FRAME_GAP + FRAME_LABEL_HEIGHT;
  const bottomRowH = Math.max(
    calcFrameHeight(sections[2]?.items.length ?? 0),
    calcFrameHeight(sections[3]?.items.length ?? 0),
  );

  for (let i = 2; i < sections.length; i++) {
    const fid = createFrameWithNotes(
      editor, sections[i], { x: topXPositions[i - 2], y: bottomRowY },
      frameW, bottomRowH, SECTION_COLORS[i % SECTION_COLORS.length],
    );
    allFrameIds.push(fid);
  }

  return allFrameIds;
}

// ── Columns: kanban, retrospective, custom_frame ─────────────────────────────

function layoutColumns(editor: Editor, call: CreateDiagramCall): string[] {
  const start = findStartPosition(editor);
  const adjustedStartY = start.y + FRAME_LABEL_HEIGHT; // room for frame labels
  const frameW = NOTE_W + NOTE_PADDING * 2;
  const allFrameIds: string[] = [];
  let curX = start.x;

  for (let i = 0; i < call.sections.length; i++) {
    const section = call.sections[i];
    const frameH = calcFrameHeight(section.items.length);

    const fid = createFrameWithNotes(editor, section, { x: curX, y: adjustedStartY }, frameW, frameH, SECTION_COLORS[i % SECTION_COLORS.length]);
    allFrameIds.push(fid);
    curX += frameW + FRAME_GAP;
  }

  return allFrameIds;
}

// ── User Journey: horizontal flow with arrows ────────────────────────────────

function layoutUserJourney(editor: Editor, call: CreateDiagramCall): string[] {
  const start = findStartPosition(editor);
  const adjustedStartY = start.y + FRAME_LABEL_HEIGHT; // room for frame labels
  const frameW = NOTE_W + NOTE_PADDING * 2;
  const frameIds: string[] = [];
  let curX = start.x;

  for (let i = 0; i < call.sections.length; i++) {
    const section = call.sections[i];
    const frameH = calcFrameHeight(section.items.length);

    const frameId = createFrameWithNotes(
      editor, section, { x: curX, y: adjustedStartY }, frameW, frameH,
      SECTION_COLORS[i % SECTION_COLORS.length],
    );
    frameIds.push(frameId);
    curX += frameW + FRAME_GAP + 20; // extra gap for arrows
  }

  // Connect stages with arrows
  for (let i = 0; i < frameIds.length - 1; i++) {
    createArrowBetween(editor, frameIds[i], frameIds[i + 1]);
  }

  return frameIds;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createFrameWithNotes(
  editor: Editor,
  section: DiagramSection,
  pos: { x: number; y: number },
  frameW: number,
  frameH: number,
  noteColor: string,
): string {
  const frameId = createShapeId();

  // Use the pre-calculated frameH. Post-batch fitFramesToChildren() will
  // resize to actual content once tldraw has computed growY bounds.
  editor.createShape({
    id: frameId,
    type: 'frame',
    x: pos.x,
    y: pos.y,
    props: { w: frameW, h: frameH, name: section.sectionTitle },
  });

  for (let i = 0; i < section.items.length; i++) {
    const noteId = createShapeId();
    editor.createShape({
      id: noteId,
      type: 'note',
      x: NOTE_PADDING,
      y: NOTE_PADDING + FRAME_HEADER + i * (NOTE_H + NOTE_GAP),
      parentId: frameId,
      props: {
        text: section.items[i],
        color: noteColor,
      },
    } as Parameters<typeof editor.createShape>[0]);
  }

  return frameId;
}

function createArrowBetween(editor: Editor, fromId: string, toId: string): void {
  const arrowId = createShapeId();

  editor.createShape({
    id: arrowId,
    type: 'arrow',
    x: 0,
    y: 0,
    props: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      text: '',
    },
  });

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
}
