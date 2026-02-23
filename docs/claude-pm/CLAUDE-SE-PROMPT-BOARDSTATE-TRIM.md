# CLAUDE-SE PROMPT: F8 — Trim Board State Props for AI Agent

> **Produced by**: Claude-PM
> **Date**: 2026-02-23
> **Feature**: CB-002-F8 — Strip unused props from board state sent to AI agent
> **Depends on**: F3 viewport windowing (buildTieredBoardState)

---

## Context

The AI agent receives the full tldraw `props` object for every viewport shape. Inspecting LangSmith traces reveals massive amounts of unused data:

- **Notes** send 10 props but the agent only reads `text` and `color`
- **Frames** send 3 props but the agent only reads `name`
- **Geo shapes** send 14 props but the agent only reads `text`, `color`, and `geo`
- **Arrows** send 15 props but the agent only reads `text` and `color`

The agent's tools (`updateElements`, `layoutElements`, etc.) only emit semantic instructions — they never reference `font`, `size`, `align`, `verticalAlign`, `growY`, `fontSizeAdjustment`, `url`, `scale`, `labelColor`, `fill`, `dash`, `bend`, `start`, `end`, `arrowheadStart`, `arrowheadEnd`, or `labelPosition`.

Frame `w`/`h` are also unused — the agent's `resizeInstruction` is semantic ("double"/"half"/"fit-to-content"), and the frontend resolves actual geometry from the tldraw Editor.

**Note**: The code generator (`/generate-code`) is NOT affected — it uses `spatialAnalyzer.ts` which reads directly from the tldraw Editor, not from the board state builder.

---

## Summary of Changes

| Area | What Changes |
|------|-------------|
| `frontend/src/utils/boardStateBuilder.ts` | Filter props per shape type, only include agent-relevant fields |

This is a **single-file change**.

---

## CHANGE 1: Filter props in `buildTieredBoardState()`

**File**: `frontend/src/utils/boardStateBuilder.ts`

### What to change

In the viewport shape mapping (line 84-91), instead of passing the raw `props` object, filter it to only include the fields the AI agent uses.

**Find** (lines 84-91):

```typescript
  const tieredShapes = allShapes.map((s): TieredShape => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    if (viewportIds.has(s.id)) {
      return {
        id: s.id, type: s.type, parentId: s.parentId as string,
        isSelected: selectedIds.has(s.id), props,
      };
    }
```

**Replace with**:

```typescript
  const tieredShapes = allShapes.map((s): TieredShape => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    if (viewportIds.has(s.id)) {
      // Only send props the AI agent actually reads — trim the rest to save tokens
      let trimmedProps: Record<string, unknown>;
      switch (s.type) {
        case 'note':
          trimmedProps = { color: props.color, text: props.text };
          break;
        case 'frame':
          trimmedProps = { name: props.name };
          break;
        case 'geo':
          trimmedProps = { color: props.color, text: props.text, geo: props.geo };
          break;
        case 'arrow':
          trimmedProps = { color: props.color, text: props.text };
          break;
        case 'text':
          trimmedProps = { color: props.color, text: props.text };
          break;
        default:
          trimmedProps = { text: props.text, color: props.color };
          break;
      }
      return {
        id: s.id, type: s.type, parentId: s.parentId as string,
        isSelected: selectedIds.has(s.id), props: trimmedProps,
      };
    }
```

### Why these fields

| Shape Type | Kept Props | Agent Use |
|-----------|-----------|-----------|
| `note` | `color`, `text` | Identify by content, change text or color |
| `frame` | `name` | Identify by name, rename with `newName` |
| `geo` | `color`, `text`, `geo` | Identify by content, change text/color, `geo` distinguishes rectangle/ellipse |
| `arrow` | `color`, `text` | Identify by label, change text/color |
| `text` | `color`, `text` | Identify by content, change text/color |

### What's dropped (per type)

| Shape Type | Dropped Props |
|-----------|--------------|
| `note` | `size`, `font`, `align`, `verticalAlign`, `growY`, `fontSizeAdjustment`, `url`, `scale` |
| `frame` | `w`, `h` |
| `geo` | `w`, `h`, `labelColor`, `fill`, `dash`, `size`, `font`, `align`, `verticalAlign`, `growY`, `url`, `scale` |
| `arrow` | `dash`, `size`, `fill`, `labelColor`, `bend`, `start`, `end`, `arrowheadStart`, `arrowheadEnd`, `text`, `labelPosition`, `font`, `scale` |
| `text` | `size`, `font`, `align`, `scale`, `w` |

---

## CHANGE 2: Update full-size estimate to also use trimmed props

The `fullSizeChars` metric (used by F7 stats panel) estimates what would be sent WITHOUT viewport windowing. To keep the comparison fair (apples to apples), the full-size estimate should also use trimmed props — otherwise we'd be comparing trimmed-tiered vs raw-full, which inflates the savings number.

**Find** (lines 107-115):

```typescript
  // Estimate full-detail size: what would be sent without viewport windowing
  const fullShapes = allShapes.map((s) => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    return {
      id: s.id, type: s.type, parentId: s.parentId as string,
      isSelected: selectedIds.has(s.id), props,
    };
  });
  const fullJson = JSON.stringify(fullShapes);
```

**Replace with**:

```typescript
  // Estimate full-detail size: all shapes with trimmed props (no viewport windowing)
  const fullShapes = tieredShapes.map((s) => {
    if ('props' in s) return s; // already trimmed viewport shape
    // Off-screen shapes: reconstruct as if they were viewport shapes (trimmed)
    const shape = allShapes.find((a) => a.id === s.id);
    if (!shape) return s;
    const p = (shape as unknown as Record<string, unknown>).props as Record<string, unknown>;
    let trimmedProps: Record<string, unknown>;
    switch (shape.type) {
      case 'note': trimmedProps = { color: p.color, text: p.text }; break;
      case 'frame': trimmedProps = { name: p.name }; break;
      case 'geo': trimmedProps = { color: p.color, text: p.text, geo: p.geo }; break;
      case 'arrow': trimmedProps = { color: p.color, text: p.text }; break;
      case 'text': trimmedProps = { color: p.color, text: p.text }; break;
      default: trimmedProps = { text: p.text, color: p.color }; break;
    }
    return {
      id: s.id, type: shape.type, parentId: shape.parentId as string,
      isSelected: selectedIds.has(shape.id), props: trimmedProps,
    };
  });
  const fullJson = JSON.stringify(fullShapes);
```

**Actually — simpler approach.** The full-size estimate should compare "all shapes at full detail" vs "tiered shapes." Since both now use trimmed props, the savings shown by F7 will reflect purely the viewport windowing benefit (full-detail for all shapes vs compact summaries for off-screen shapes), which is exactly what we want to showcase.

A cleaner implementation: extract the trimming logic into a helper function and reuse it for both the tiered shapes and the full-size estimate.

**Alternative (PREFERRED): Extract helper, reuse in both places**

Replace the entire `tieredShapes` mapping AND the `fullShapes` estimation block with:

```typescript
  // Only send props the AI agent actually reads — trim the rest to save tokens
  function trimProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
    switch (type) {
      case 'note': return { color: props.color, text: props.text };
      case 'frame': return { name: props.name };
      case 'geo': return { color: props.color, text: props.text, geo: props.geo };
      case 'arrow': return { color: props.color, text: props.text };
      case 'text': return { color: props.color, text: props.text };
      default: return { text: props.text, color: props.color };
    }
  }

  const tieredShapes = allShapes.map((s): TieredShape => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    if (viewportIds.has(s.id)) {
      return {
        id: s.id, type: s.type, parentId: s.parentId as string,
        isSelected: selectedIds.has(s.id), props: trimProps(s.type, props),
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

  const tieredJson = JSON.stringify(tieredShapes);

  // Estimate full-detail size: all shapes with trimmed props (no viewport windowing)
  const fullShapes = allShapes.map((s) => {
    const props = (s as unknown as Record<string, unknown>).props as Record<string, unknown>;
    return {
      id: s.id, type: s.type, parentId: s.parentId as string,
      isSelected: selectedIds.has(s.id), props: trimProps(s.type, props),
    };
  });
  const fullJson = JSON.stringify(fullShapes);
```

---

## Testing Checklist

1. **`cd frontend && npx tsc --noEmit`** — compiles without errors
2. **LangSmith trace comparison** — before vs after:
   - Run the same prompt on the same board before and after the change
   - Compare the `boardState` input in LangSmith traces
   - Notes should only show `color` and `text` in props
   - Frames should only show `name` in props
   - Geo shapes should only show `color`, `text`, `geo` in props
   - Arrows should only show `color` and `text` in props
3. **Agent functionality unchanged**:
   - Create elements → works as before
   - Update text on a note → still finds correct shape by text
   - Change color of a shape → still knows current color
   - Rename a frame → still reads frame name
   - Navigate to shapes → still identifies shapes correctly
   - Layout shapes → still works with IDs
4. **Code generation unaffected** — Generate Code button still produces correct React+Tailwind output (uses spatialAnalyzer, not boardStateBuilder)
5. **F7 stats panel** (if implemented) — savings percentage reflects viewport windowing benefit, not prop trimming benefit (both tiered and full use trimmed props)
6. **Existing tests still pass**

---

## Expected Savings

Based on the LangSmith trace samples:

| Shape | Before (chars) | After (chars) | Reduction |
|-------|---------------|---------------|-----------|
| Note | ~180 | ~50 | ~72% |
| Frame | ~80 | ~40 | ~50% |
| Geo | ~320 | ~70 | ~78% |
| Arrow | ~350 | ~50 | ~86% |

For a board with 10 viewport shapes (3 notes, 2 frames, 3 geo, 2 arrows), estimated savings: ~1,500 → ~500 chars of props alone, plus JSON overhead. That's roughly **65-75% reduction in board state tokens**.

---

## Files Modified (Summary)

| File | Action |
|------|--------|
| `frontend/src/utils/boardStateBuilder.ts` | Add `trimProps()` helper. Use it in viewport shape mapping and full-size estimate. |
