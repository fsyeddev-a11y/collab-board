# CLAUDE-SE PROMPT: Zoom-to-Fit on Board Load

> **Produced by**: Claude-PM
> **Date**: 2026-02-23
> **Feature**: Viewport initialization on board load
> **Depends on**: Existing BoardPage.tsx WebSocket init handler

---

## Problem

When a user loads a board, the viewport starts at tldraw's default position (0,0) with default zoom. If shapes are positioned elsewhere on the canvas, the user sees an empty viewport and must manually pan/zoom to find their content.

## Solution

After the WebSocket `init` message loads all shapes into the editor store, call `editor.zoomToFit()` to center the camera on all existing content. If the board is empty, do nothing (stay at default).

---

## CHANGE 1: Add zoom-to-fit after init records merge

**File**: `frontend/src/pages/BoardPage.tsx`

In the WebSocket message handler, find the `init` block (around lines 391-419). After the records are merged and `isRemoteChangeRef.current` is set back to `false`, add a zoom-to-fit call.

Find this code:

```typescript
            if (message.records.length > 0) {
              isRemoteChangeRef.current = true;
              editor.store.mergeRemoteChanges(() => {
                try {
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];
                  message.records.forEach((record: TLRecord) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid initial record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });
                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                } catch (error) {
                  console.error('[WS] Error loading initial records:', error);
                } finally {
                  isRemoteChangeRef.current = false;
                }
              });
            }
```

Replace with:

```typescript
            if (message.records.length > 0) {
              isRemoteChangeRef.current = true;
              editor.store.mergeRemoteChanges(() => {
                try {
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];
                  message.records.forEach((record: TLRecord) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid initial record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });
                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                } catch (error) {
                  console.error('[WS] Error loading initial records:', error);
                } finally {
                  isRemoteChangeRef.current = false;
                }
              });

              // Zoom to fit all loaded content so the user sees their board immediately.
              // requestAnimationFrame ensures the store changes are rendered before zooming.
              requestAnimationFrame(() => {
                if (editor.getCurrentPageShapeIds().size > 0) {
                  editor.zoomToFit({ animation: { duration: 0 }, inset: 100 });
                }
              });
            }
```

**Key details:**
- `requestAnimationFrame` ensures shapes are rendered in the store before we calculate the bounding box for zoom
- `editor.getCurrentPageShapeIds().size > 0` guards against empty boards (though the outer `message.records.length > 0` check mostly covers this — the inner check is a safety net since not all records are shapes)
- `animation: { duration: 0 }` — instant positioning, no animation on initial load (the user hasn't seen the board yet, animation would feel jarring)
- `inset: 100` — 100px padding so shapes don't touch the viewport edges

---

## That's it — single change

No other files need modification. This is a one-location fix in the WebSocket init handler.

---

## Testing

1. **Board with content**: Load a board that has shapes → viewport should immediately show all shapes, centered and zoomed to fit
2. **Empty board**: Load a new/empty board → viewport stays at default (0,0), no errors in console
3. **Large spread-out board**: Load a board with shapes far apart → all shapes visible, may be zoomed out
4. **Single shape board**: Load a board with one shape → centered on that shape
5. **Multiplayer**: Second user joins → their viewport also zooms to fit (each client handles their own init)
