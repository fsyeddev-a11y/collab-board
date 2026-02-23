/**
 * Spatial Analyzer — builds a containment tree from selected tldraw shapes.
 *
 * Uses purely geometric AABB containment (not tldraw's parentId) so users can
 * draw freeform wireframe hierarchies without relying on tldraw frame parenting.
 */

import type { Editor, TLShapeId } from '@tldraw/editor';
import type { SpatialNode, ArrowConnection } from '@collabboard/shared';

/** Y-tolerance band (px): shapes within this range are considered same row. */
const Y_TOLERANCE = 20;

/** Convert pixel width to categorical size hint. */
function widthCategory(px: number): 'narrow' | 'medium' | 'wide' {
  if (px < 200) return 'narrow';
  if (px <= 500) return 'medium';
  return 'wide';
}

/** Convert pixel height to categorical size hint. */
function heightCategory(px: number): 'short' | 'medium' | 'tall' {
  if (px < 100) return 'short';
  if (px <= 300) return 'medium';
  return 'tall';
}

/**
 * Determine layout direction for a frame's children using AABB center analysis.
 * - Row: children centers have more X-variance than Y-variance (side by side)
 * - Col: children centers have more Y-variance (stacked vertically)
 * - Grid: multiple rows detected, each with 2+ items
 */
function computeLayoutType(
  children: ShapeEntry[],
): { layoutType: 'row' | 'col' | 'grid'; gridCols?: number } {
  if (children.length <= 1) return { layoutType: 'col' };

  // Group children by Y-coordinate bands (reuse Y_TOLERANCE)
  const sorted = [...children].sort((a, b) => a.bounds.y - b.bounds.y);
  const yGroups: ShapeEntry[][] = [];

  for (const child of sorted) {
    const lastGroup = yGroups[yGroups.length - 1];
    if (!lastGroup) {
      yGroups.push([child]);
    } else {
      // Compare against the first child in the group (the Y reference)
      const groupY = lastGroup[0].bounds.y + lastGroup[0].bounds.h / 2;
      const childY = child.bounds.y + child.bounds.h / 2;
      if (Math.abs(childY - groupY) <= Y_TOLERANCE) {
        lastGroup.push(child);
      } else {
        yGroups.push([child]);
      }
    }
  }

  // Single Y-group: all children on roughly the same row
  if (yGroups.length === 1) {
    return yGroups[0].length >= 2 ? { layoutType: 'row' } : { layoutType: 'col' };
  }

  // Multiple Y-groups: check for grid pattern (2+ groups, each with 2+ items)
  const maxCols = Math.max(...yGroups.map((g) => g.length));
  if (yGroups.length >= 2 && maxCols >= 2) {
    return { layoutType: 'grid', gridCols: maxCols };
  }

  // Default: column (multiple rows but each has only 1 item)
  return { layoutType: 'col' };
}

/** Input keyword → HTML input type mapping. Case-insensitive match against label. */
const INPUT_KEYWORDS: Array<{ keywords: string[]; inputType: SpatialNode['inputType'] }> = [
  { keywords: ['email', 'e-mail'],                    inputType: 'email' },
  { keywords: ['password', 'passwd'],                  inputType: 'password' },
  { keywords: ['search', 'find', 'look up'],           inputType: 'search' },
  { keywords: ['phone', 'tel', 'mobile', 'cell'],      inputType: 'tel' },
  { keywords: ['url', 'website', 'link', 'web'],       inputType: 'url' },
  // Generic text inputs — catch-all for data entry shapes
  { keywords: [
      'username', 'user name', 'name', 'first name', 'last name', 'full name',
      'address', 'city', 'state', 'zip', 'country',
      'enter', 'type', 'type here', 'input',
      'message', 'comment', 'description', 'notes', 'bio',
    ],                                                  inputType: 'text' },
];

/**
 * Classify a geo shape as 'button' or 'input' based on its label.
 * Returns elementHint and (for inputs) the HTML input type.
 */
function classifyGeoElement(label: string): {
  elementHint: 'button' | 'input';
  inputType?: SpatialNode['inputType'];
} {
  const lower = label.toLowerCase().trim();
  if (!lower) return { elementHint: 'button' }; // empty label → button

  for (const entry of INPUT_KEYWORDS) {
    if (entry.keywords.some((kw) => lower === kw || lower.includes(kw))) {
      return { elementHint: 'input', inputType: entry.inputType };
    }
  }

  return { elementHint: 'button' };
}

/**
 * Compute horizontal alignment of a child within its col-layout parent.
 * Divides parent width into thirds: left → 'start', center → 'center', right → 'end'.
 * Only meaningful for children of col-layout frames.
 */
function computeAlignSelf(
  childBounds: { x: number; y: number; w: number; h: number },
  parentBounds: { x: number; y: number; w: number; h: number },
): 'start' | 'center' | 'end' {
  const childCenterX = childBounds.x + childBounds.w / 2;
  const relativeX = (childCenterX - parentBounds.x) / parentBounds.w;

  if (relativeX < 0.33) return 'start';
  if (relativeX > 0.66) return 'end';
  return 'center';
}

interface ShapeEntry {
  id: TLShapeId;
  type: string;
  label: string;
  geo?: string;
  bounds: { x: number; y: number; w: number; h: number };
  parent: ShapeEntry | null;
  children: ShapeEntry[];
}

/** True if `inner` is fully contained within `outer`. */
function contains(
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Area of a bounds rect. */
function area(b: { w: number; h: number }): number {
  return b.w * b.h;
}

/** Extract a human-readable label from a tldraw shape. */
function extractLabel(shape: { type: string; props: Record<string, unknown> }): string {
  if (shape.type === 'frame') {
    return (shape.props.name as string) || '';
  }
  return (shape.props.text as string) || '';
}

/**
 * Build a spatial containment tree from the given shape IDs.
 *
 * Algorithm:
 * 1. Get page bounds for all selected shapes, filter out arrows.
 * 2. For each shape, find its spatial parent (smallest fully-containing shape).
 * 3. Build tree recursively (parentless shapes = roots).
 * 4. Sort children by Y then X (with tolerance band).
 */
export function buildSpatialTree(editor: Editor, shapeIds: TLShapeId[]): SpatialNode[] {
  if (shapeIds.length === 0) return [];

  // Expand selection to include all descendant shapes.
  // When a user selects a frame, tldraw only returns the frame ID —
  // children are not in getSelectedShapeIds(). We need them for the tree.
  const expandedIds = new Set<TLShapeId>(shapeIds);
  function addDescendants(parentId: TLShapeId) {
    const childIds = editor.getSortedChildIdsForParent(parentId);
    for (const childId of childIds) {
      expandedIds.add(childId as TLShapeId);
      addDescendants(childId as TLShapeId);
    }
  }
  for (const id of shapeIds) {
    addDescendants(id);
  }

  // Collect shape entries with bounds, filtering out arrows
  const entries: ShapeEntry[] = [];
  for (const id of expandedIds) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    // Skip arrows/connectors — they're not UI elements
    if (shape.type === 'arrow') continue;

    const pageBounds = editor.getShapePageBounds(id);
    if (!pageBounds) continue;

    entries.push({
      id,
      type: shape.type,
      label: extractLabel(shape as { type: string; props: Record<string, unknown> }),
      geo: shape.type === 'geo' ? ((shape.props as Record<string, unknown>).geo as string) : undefined,
      bounds: { x: pageBounds.x, y: pageBounds.y, w: pageBounds.w, h: pageBounds.h },
      parent: null,
      children: [],
    });
  }

  if (entries.length === 0) return [];

  // Find spatial parent for each shape: smallest containing shape
  for (const entry of entries) {
    let bestParent: ShapeEntry | null = null;
    let bestArea = Infinity;

    for (const candidate of entries) {
      if (candidate === entry) continue;
      if (contains(candidate.bounds, entry.bounds)) {
        const candidateArea = area(candidate.bounds);
        if (candidateArea < bestArea) {
          bestArea = candidateArea;
          bestParent = candidate;
        }
      }
    }

    if (bestParent) {
      entry.parent = bestParent;
      bestParent.children.push(entry);
    }
  }

  // Roots are entries with no parent
  const roots = entries.filter((e) => e.parent === null);

  // Sort children recursively: by Y (with tolerance band), then by X
  function sortChildren(items: ShapeEntry[]): void {
    items.sort((a, b) => {
      const dy = a.bounds.y - b.bounds.y;
      if (Math.abs(dy) <= Y_TOLERANCE) {
        return a.bounds.x - b.bounds.x;
      }
      return dy;
    });
    for (const item of items) {
      sortChildren(item.children);
    }
  }
  sortChildren(roots);

  // Convert to SpatialNode
  function toNode(
    entry: ShapeEntry,
    parentEntry?: ShapeEntry,
    parentLayoutType?: 'row' | 'col' | 'grid',
  ): SpatialNode {
    const nodeType = mapType(entry.type);
    const layout =
      nodeType === 'frame' && entry.children.length > 0
        ? computeLayoutType(entry.children)
        : undefined;
    const geoHint =
      nodeType === 'geo'
        ? classifyGeoElement(entry.label)
        : undefined;

    // Compute alignSelf only for children of col-layout frames
    const alignSelf =
      parentEntry && parentLayoutType === 'col'
        ? computeAlignSelf(entry.bounds, parentEntry.bounds)
        : undefined;

    return {
      shapeId: entry.id,
      type: nodeType,
      label: entry.label,
      ...(entry.geo ? { geo: entry.geo } : {}),
      sizeHint: { width: widthCategory(entry.bounds.w), height: heightCategory(entry.bounds.h) },
      ...(layout?.layoutType ? { layoutType: layout.layoutType } : {}),
      ...(layout?.gridCols ? { gridCols: layout.gridCols } : {}),
      ...(geoHint ? { elementHint: geoHint.elementHint } : {}),
      ...(geoHint?.inputType ? { inputType: geoHint.inputType } : {}),
      ...(alignSelf && alignSelf !== 'start' ? { alignSelf } : {}),
      children: entry.children.map((child) =>
        toNode(child, entry, layout?.layoutType),
      ),
    };
  }

  return roots.map((root) => toNode(root));
}

function mapType(tldrawType: string): SpatialNode['type'] {
  switch (tldrawType) {
    case 'frame': return 'frame';
    case 'geo': return 'geo';
    case 'text': return 'text';
    case 'note': return 'note';
    default: return 'geo';
  }
}

/**
 * Extract arrow connections from selected shapes.
 * Only includes arrows where both endpoints are bound to shapes in the selection.
 * Uses tldraw's binding system to resolve arrow → shape connections.
 */
export function buildConnections(
  editor: Editor,
  shapeIds: TLShapeId[],
): ArrowConnection[] {
  const connections: ArrowConnection[] = [];
  const idSet = new Set<string>(shapeIds as string[]);

  // Also include expanded descendant IDs
  function addDescendants(parentId: TLShapeId) {
    const childIds = editor.getSortedChildIdsForParent(parentId);
    for (const childId of childIds) {
      idSet.add(childId as string);
      addDescendants(childId as TLShapeId);
    }
  }
  for (const id of shapeIds) {
    addDescendants(id);
  }

  for (const id of idSet) {
    const shape = editor.getShape(id as TLShapeId);
    if (!shape || shape.type !== 'arrow') continue;

    // Get bindings from this arrow shape
    const bindings = editor.getBindingsFromShape(shape.id, 'arrow');

    let fromId: string | null = null;
    let toId: string | null = null;

    for (const binding of bindings) {
      const terminal = (binding.props as { terminal: string }).terminal;
      if (terminal === 'start') fromId = binding.toId;
      if (terminal === 'end') toId = binding.toId;
    }

    // Only include if both endpoints are bound to shapes in the selection
    if (fromId && toId && idSet.has(fromId) && idSet.has(toId)) {
      const arrowLabel =
        (shape.props as Record<string, unknown>).text as string || '';
      connections.push({
        fromShapeId: fromId,
        toShapeId: toId,
        label: arrowLabel,
      });
    }
  }

  return connections;
}
