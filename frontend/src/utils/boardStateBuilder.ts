/**
 * Tiered Board State Builder
 *
 * Builds a viewport-aware board state for the AI agent:
 *  - Viewport shapes → full detail (id, type, parentId, isSelected, props)
 *  - Off-screen shapes → compact summary (id, type, parentId, text)
 *  - No x/y coordinates on any shape (LLM never uses them)
 *
 * Frame grouping rules:
 *  - Frame in viewport → all children get full detail
 *  - Child in viewport but parent off-screen → parent promoted to full detail
 */

import type { Editor } from '@tldraw/editor';

export interface ViewportShape {
  id: string;
  type: string;
  parentId: string;
  isSelected: boolean;
  props: Record<string, unknown>;
}

export interface OffScreenShape {
  id: string;
  type: string;
  parentId: string;
  text: string;
}

export type TieredShape = ViewportShape | OffScreenShape;

export function buildTieredBoardState(editor: Editor): TieredShape[] {
  const selectedIds = new Set(editor.getSelectedShapeIds());
  const allShapes = editor.getCurrentPageShapes();

  // Viewport bounds with 10% padding
  const vp = editor.getViewportPageBounds();
  const padX = vp.w * 0.1;
  const padY = vp.h * 0.1;
  const expanded = {
    minX: vp.minX - padX, minY: vp.minY - padY,
    maxX: vp.maxX + padX, maxY: vp.maxY + padY,
  };

  // Pass 1: geometric viewport intersection
  const viewportIds = new Set<string>();
  for (const s of allShapes) {
    const b = editor.getShapePageBounds(s.id);
    if (b && b.maxX >= expanded.minX && b.minX <= expanded.maxX &&
        b.maxY >= expanded.minY && b.minY <= expanded.maxY) {
      viewportIds.add(s.id);
    }
  }

  // Pass 2: frame in viewport → all children get full detail
  for (const s of allShapes) {
    if (viewportIds.has(s.id) && s.type === 'frame') {
      for (const childId of editor.getSortedChildIdsForParent(s.id)) {
        viewportIds.add(childId);
      }
    }
  }

  // Pass 3: child in viewport → promote parent frame to full detail
  for (const s of allShapes) {
    if (viewportIds.has(s.id) && String(s.parentId).startsWith('shape:')) {
      viewportIds.add(String(s.parentId));
    }
  }

  // Build tiered array (no x, y coordinates — LLM never uses them)
  return allShapes.map((s): TieredShape => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    if (viewportIds.has(s.id)) {
      return {
        id: s.id, type: s.type, parentId: s.parentId as string,
        isSelected: selectedIds.has(s.id), props,
      };
    }
    // Off-screen: compact summary with extracted text
    let text = '';
    switch (s.type) {
      case 'frame':
        text = (props.name as string) ?? '';
        break;
      case 'note': case 'geo': case 'text': case 'arrow':
        text = (props.text as string) ?? '';
        break;
    }
    return { id: s.id, type: s.type, parentId: s.parentId as string, text };
  });
}
