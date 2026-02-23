# CLAUDE-SE PROMPT: F5 Spatial Compiler — System Prompt Overhaul

> **Produced by**: Claude-PM
> **Date**: 2026-02-22
> **Spec**: CB-002-F5 (refinement pass)
> **Depends on**: Existing F5 implementation (codeGenerator.ts, spatialAnalyzer.ts, CodePreviewPanel.tsx)

---

## Context

The F5 spatial compiler is implemented and working end-to-end. This overhaul refines the LLM system prompt and adds frontend-computed layout hints to produce **deterministic, high-quality** wireframe-to-JSX output. The LLM should act as a **compiler executing a dictionary**, not a creative coder.

## Core Design Convention: Shape Type = Semantic Role

This is the fundamental mental model the entire system enforces. Users learn ONE rule per tldraw tool:

| tldraw Tool | Shape Type | Always Translates To | Never Translates To |
|-------------|-----------|---------------------|-------------------|
| Frame tool | `frame` | Layout container (`<div>`, `<nav>`, `<section>`, etc.) | Interactive elements |
| Text tool | `text` | Read-only typography (`<h1>`, `<h2>`, `<p>`) | Buttons, links, inputs |
| Geo tool (rectangle/ellipse) | `geo` | Interactive element (`<button>`, `<input>`, `<a>`) | Plain text, containers |
| Note tool | `note` | Invisible metadata (styling overrides) | Visible UI elements |
| Arrow tool | `arrow` (connections array) | `onClick` handler / routing logic | SVG lines, visual arrows |

**The LLM never guesses.** Shape type alone determines the semantic role. Labels determine the specific element within that role.

## Summary of Changes

| Area | What Changes |
|------|-------------|
| `shared/src/api.ts` | Add `layoutType`, `gridCols`, `alignSelf` to SpatialNode. Add `ArrowConnection` type/schema. Update `CodeGenerateRequestSchema` to accept `connections`. |
| `frontend/src/utils/spatialAnalyzer.ts` | Stop filtering arrows. Compute `layoutType`/`gridCols` for frame nodes. Export `buildConnections()` alongside `buildSpatialTree()`. |
| `frontend/src/pages/BoardPage.tsx` | Call `buildConnections()` and send `connections` array in POST body. Update error message (arrows no longer excluded). |
| `ai-service/src/codeGenerator.ts` | Replace entire system prompt. Accept `connections` parameter. Include connections in user message. |
| `frontend/src/tests/spatialAnalyzer.test.ts` | Add tests for layoutType computation and arrow connection extraction. |

---

## CHANGE 1: Shared Schema (`shared/src/api.ts`)

### 1a. Update `SpatialNode` type and schema

Add these optional fields to SpatialNode:
- `layoutType` and `gridCols` — only on `frame` nodes (layout direction)
- `elementHint` — only on `geo` nodes (`'button'` or `'input'`, computed by frontend keyword matching)
- `inputType` — only when `elementHint` is `'input'` (the HTML input type attribute)
- `alignSelf` — only on children of `col`-layout frames (horizontal position within parent)

**Type** (replace the existing `SpatialNode` type starting around line 237):
```typescript
export type SpatialNode = {
  shapeId: string;
  type: 'frame' | 'geo' | 'text' | 'note';
  label: string;
  geo?: string;
  sizeHint: {
    width: 'narrow' | 'medium' | 'wide';
    height: 'short' | 'medium' | 'tall';
  };
  layoutType?: 'row' | 'col' | 'grid';
  gridCols?: number;
  elementHint?: 'button' | 'input';
  inputType?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
  alignSelf?: 'start' | 'center' | 'end';
  children: SpatialNode[];
};
```

**Zod schema** (replace the existing `SpatialNodeSchema`):
```typescript
export const SpatialNodeSchema: z.ZodType<SpatialNode> = z.lazy(() =>
  z.object({
    shapeId: z.string(),
    type: z.enum(['frame', 'geo', 'text', 'note']),
    label: z.string(),
    geo: z.string().optional(),
    sizeHint: z.object({
      width: z.enum(['narrow', 'medium', 'wide']),
      height: z.enum(['short', 'medium', 'tall']),
    }),
    layoutType: z.enum(['row', 'col', 'grid']).optional(),
    gridCols: z.number().int().min(1).optional(),
    elementHint: z.enum(['button', 'input']).optional(),
    inputType: z.enum(['text', 'email', 'password', 'search', 'tel', 'url']).optional(),
    alignSelf: z.enum(['start', 'center', 'end']).optional(),
    children: z.array(SpatialNodeSchema),
  }),
);
```

### 1b. Add `ArrowConnection` type and schema

Add these **after** the SpatialNode definitions, before `CodeGenerateRequestSchema`:

```typescript
export type ArrowConnection = {
  fromShapeId: string;
  toShapeId: string;
  label: string;
};

export const ArrowConnectionSchema = z.object({
  fromShapeId: z.string(),
  toShapeId: z.string(),
  label: z.string(),
});
```

### 1c. Update `CodeGenerateRequestSchema`

Add optional `connections` field:

```typescript
export const CodeGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  spatialTree: z.array(SpatialNodeSchema),
  connections: z.array(ArrowConnectionSchema).optional(),
  boardId: z.string(),
});
```

---

## CHANGE 2: Spatial Analyzer (`frontend/src/utils/spatialAnalyzer.ts`)

### 2a. Compute `layoutType` and `gridCols` for frame nodes

Add a helper function that analyzes a frame's children to determine layout direction. Place it near the existing `widthCategory`/`heightCategory` functions:

```typescript
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
```

### 2b. Add `classifyGeoElement()` — deterministic input vs button detection

Add this function near the other helper functions. It does keyword matching in JS so the LLM never has to guess:

```typescript
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
```

### 2c. Add `computeAlignSelf()` — horizontal position detection for col-layout children

Add this function near the other layout helpers. It checks where a child's horizontal center falls relative to its parent frame, dividing into thirds:

```typescript
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
```

### 2d. Apply `layoutType`/`gridCols`/`elementHint`/`alignSelf` in `toNode()`

Update the `toNode()` function inside `buildSpatialTree()`. The function now accepts optional parent context so children of col-layout frames get an `alignSelf` hint:

```typescript
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
```

**Key design decisions:**
- `alignSelf` is only computed for children of `col`-layout frames (row and grid handle alignment differently)
- `alignSelf: 'start'` is **omitted** (it's the default for `items-start` containers — no need to send redundant data)
- Only `'center'` and `'end'` are sent, which map to `self-center` and `self-end` in the LLM prompt

### 2c. Stop filtering arrows from the spatial tree

Remove line 97 (`if (shape.type === 'arrow') continue;`). **However**, arrows should still NOT be included in the containment tree (they don't have meaningful parent/child geometry). Instead, they get extracted separately by `buildConnections()`.

The approach: keep the arrow filter in the main loop (arrows don't go into the spatial tree), but add a new exported function `buildConnections()` that extracts arrow connections separately.

So: **keep** the arrow filter on line 97 as-is. Add a new function:

### 2d. New exported function: `buildConnections()`

Add this new exported function at the bottom of the file (after `buildSpatialTree`):

```typescript
import type { ArrowConnection } from '@collabboard/shared';

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
  const idSet = new Set<string>(shapeIds);

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

  for (const id of shapeIds) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== 'arrow') continue;

    // Get bindings from this arrow shape
    const bindings = editor.getBindingsFromShape(id, 'arrow');

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
```

**Important**: Add `ArrowConnection` to the import from `@collabboard/shared` at the top of the file:
```typescript
import type { SpatialNode, ArrowConnection } from '@collabboard/shared';
```

**Note on the tldraw binding API**: The code above uses `editor.getBindingsFromShape(arrowId, 'arrow')` which returns bindings where each binding has `props.terminal` ('start' | 'end') and `toId` (the bound shape). This matches the existing usage pattern in `aiResolver.ts` (line ~673) and `canvas-objects.test.ts` (line ~272). Verify the exact API if needed by checking those files.

---

## CHANGE 3: Frontend — BoardPage.tsx

### 3a. Import `buildConnections`

Update the import from spatialAnalyzer:
```typescript
import { buildSpatialTree, buildConnections } from '../utils/spatialAnalyzer';
```

### 3b. Call `buildConnections()` and send in POST body

In `handleCodeGenerate()`, after building the spatial tree, also extract connections. Update the function body (around lines 253-265):

```typescript
const spatialTree = buildSpatialTree(editor, selectedIds as SharedTLShapeId[]);
const connections = buildConnections(editor, selectedIds as SharedTLShapeId[]);

if (spatialTree.length === 0) {
  setCodePreview({ code: '', isLoading: false, error: 'No valid shapes selected' });
  return;
}

const res = await fetch(`${API_URL}/api/generate-code`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    spatialTree,
    connections: connections.length > 0 ? connections : undefined,
    boardId,
  }),
});
```

Also update the error message — remove "(arrows are excluded)" since arrows are now used for connections.

---

## CHANGE 4: AI Service — codeGenerator.ts

### 4a. Replace the entire `SYSTEM_PROMPT` constant

Replace the full `SYSTEM_PROMPT` string (lines 11-49) with the new master prompt below:

```typescript
const SYSTEM_PROMPT = `You are an expert Frontend Code Compiler. Your sole objective is to translate a nested JSON tree of spatial canvas elements into a single, stateless React component using strict Tailwind CSS utility classes.

You are a COMPILER, not a creative coder. Follow the dictionary rules below exactly. Do not improvise.

## 1. INPUT DATA STRUCTURE

### Spatial Tree
A nested array of nodes. Each node:
- shapeId: unique identifier
- type: "frame" | "geo" | "text" | "note"
- label: text content or element name
- geo: shape sub-type (only when type is "geo") — e.g. "rectangle", "ellipse", "diamond"
- sizeHint: { width: "narrow" | "medium" | "wide", height: "short" | "medium" | "tall" }
- layoutType: "row" | "col" | "grid" (only on "frame" nodes — computed layout direction)
- gridCols: number (only when layoutType is "grid" — number of columns)
- elementHint: "button" | "input" (only on "geo" nodes — pre-computed element classification)
- inputType: "text" | "email" | "password" | "search" | "tel" | "url" (only when elementHint is "input")
- alignSelf: "start" | "center" | "end" (only on children of col-layout frames — horizontal position within parent)
- children: nested child nodes

### Connections
A flat array of arrows representing user flow:
- fromShapeId: source element
- toShapeId: target element
- label: optional arrow text

## 2. OBJECT DICTIONARY (STRICT TRANSLATION RULES)

### "frame" → Layout Containers
Translate to semantic HTML based on the label:
- Label contains "nav" → <nav>
- Label contains "sidebar" or "aside" → <aside>
- Label contains "form" or "login" or "signup" or "register" → <form>
- Label contains "header" → <header>
- Label contains "footer" → <footer>
- Empty label or generic name like "Frame" → <div> (layout wrapper)
- Otherwise → <section>

**CRITICAL LAYOUT RULE — obey layoutType strictly:**
- layoutType: "row" → className includes "flex flex-row items-center gap-6"
- layoutType: "col" → className includes "flex flex-col items-start gap-6"
- layoutType: "grid" → className includes "grid grid-cols-{gridCols} gap-6" (use the gridCols value)
- No layoutType present → default to "flex flex-col items-start gap-6"

**Semantic element spacing overrides:**
- <nav> and <header> with layoutType "row": add "justify-evenly w-full" to spread children across the full width
- <aside> with layoutType "col": add "justify-start" (children stack from top)
- <form>: keep default layout, do NOT add justify-evenly

**Padding rule:**
- Root-level frames and semantic containers (<nav>, <form>, <header>, <footer>, <aside>): apply p-6
- Nested frames (a frame whose parent is another frame) with a generic/empty label or <section>/<div>: apply p-0 (they are layout groupers, not visual containers)

### Child alignment — obey alignSelf strictly
If a child node has an alignSelf field, apply the corresponding Tailwind class:
- alignSelf: "start" → self-start (default, rarely sent)
- alignSelf: "center" → self-center
- alignSelf: "end" → self-end
If alignSelf is absent, do not add any self-* class (the container's items-start default applies).

### "geo" → Interactive UI Elements
**CORE CONVENTION: Every geo shape is an interactive element.** The frontend pre-computes the element type — strictly obey the elementHint and inputType fields. Do NOT guess.

**When elementHint is "input"** → render as <input>:
- Use the inputType field as the HTML type attribute (e.g. inputType: "email" → type="email")
- Default styling: className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
- Use the label as placeholder text

**When elementHint is "button"** (or elementHint is absent) → render as <button>:
- Use the label as button text
- **Button size is determined by sizeHint — obey strictly:**
  - sizeHint.width: "narrow" → small button: className="w-fit px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "medium" → medium button: className="w-fit px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "wide" → large full-width button: className="w-full px-6 py-3 text-lg bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
- IMPORTANT: narrow and medium buttons use w-fit so they do NOT stretch in flex-col containers. Only wide buttons use w-full.

**Ellipse shapes** (geo: "ellipse"):
- If label suggests avatar/profile → <div className="rounded-full bg-gray-200 w-10 h-10 flex items-center justify-center"> with emoji 👤
- Otherwise → <div className="rounded-full"> styled as a decorative circle

**Geo with empty label and no elementHint** → decorative placeholder: <div className="rounded-lg bg-gray-100 border border-gray-200"> with sizeHint-based dimensions

General sizeHint dimensions (for non-button geo elements):
- width: narrow → w-48, medium → w-64, wide → w-full
- height: short → h-12, medium → h-32, tall → h-64

### "text" → Typography (NEVER Interactive)
**CORE CONVENTION: Text nodes are always read-only typography.** They are never buttons, links, or inputs.

Map to text elements based on sizeHint.height:
- tall → <h1 className="text-3xl font-bold">
- medium → <h2 className="text-xl font-semibold">
- short → <p className="text-base text-gray-700">

Use the label as the text content. If the label is empty, skip this node.

### "note" → Invisible Metadata / Styling Instructions
**CRITICAL: NEVER render note nodes as visible UI elements.**

Read the note's label text and interpret it as styling overrides or structural commands for the parent container or nearest sibling element.
- Example: a note with label "dark background, white text" inside a frame → apply bg-gray-900 text-white to that frame's container
- Example: a note with label "3 column grid" → override the parent's layout to grid grid-cols-3
- Root-level notes: apply as global styling instructions to the outermost container
- If the note text is ambiguous or nonsensical, ignore it silently

### Connections → Interaction Handlers
For each connection:
- Find the source element (fromShapeId) in the output
- If the source is a button, add onClick={() => alert('Navigate to [target label]')}
- If the source is a link or card, wrap in a clickable container with cursor-pointer
- NEVER render arrows as SVG lines or visual elements

## 3. STYLING CONSTRAINTS

- Tailwind ONLY: Use standard Tailwind CSS utility classes exclusively
- NO inline styles: Never use style={{...}}
- Spacing: Use gap-6 between sibling elements, p-6 on containers. Never let elements touch without spacing
- Icons: Do NOT import icon libraries. Use text emojis if contextually needed (🔍 ⚙️ 👤 ➡️ 📧 🔒)
- Colors: Use Tailwind default palette (slate, gray, blue, red, green, etc.)
- Typography: Use font-sans (default). Headings get font-bold or font-semibold

## 4. COMPONENT CONSTRAINTS

- Stateless: Do NOT use useState, useEffect, useRef, or any React hooks. Output is visual-only
- No imports/exports: React and ReactDOM are injected as globals. Never write import or export statements
- Function name: The component MUST be a single function named exactly App
- No external dependencies: Do not reference any libraries, packages, or modules
- No TypeScript: Output plain JSX, not TSX

## 5. OUTPUT FORMAT

Return ONLY raw code inside a single jsx code fence. No explanation, no markdown outside the fence, no conversational text before or after.

\`\`\`jsx
function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* translated elements */}
    </div>
  );
}
\`\`\``;
```

### 4b. Update `generateCode()` function signature and user message

Update the function to accept and use `connections`:

```typescript
export async function generateCode(
  spatialTree: SpatialNode[],
  prompt?: string,
  connections?: ArrowConnection[],
  signal?: AbortSignal,
): Promise<{ code: string; modelUsed: string }> {
```

Update the import at the top of the file:
```typescript
import type { SpatialNode, ArrowConnection } from '@collabboard/shared';
```

Update the user message construction to include connections:

```typescript
const treeDescription = JSON.stringify(spatialTree, null, 2);
const connectionsDescription = connections && connections.length > 0
  ? `\n\nConnections (arrows indicating user flow):\n${JSON.stringify(connections, null, 2)}`
  : '';

const userMessage = prompt
  ? `Convert this wireframe to React+Tailwind code.\n\nUser instructions: ${prompt}\n\nSpatial tree:\n${treeDescription}${connectionsDescription}`
  : `Convert this wireframe to React+Tailwind code.\n\nSpatial tree:\n${treeDescription}${connectionsDescription}`;
```

### 4c. Update the Hono endpoint to pass connections

In `ai-service/src/index.ts`, update the `/generate-code` handler to pass `connections` to `generateCode()`:

```typescript
// Line ~116: extract connections from validated body
const { spatialTree, prompt, connections } = c.req.valid('json');

// Line ~119: pass connections to generateCode
const result = await generateCode(spatialTree, prompt, connections, c.req.raw.signal);
```

---

## CHANGE 5: Tests (`frontend/src/tests/spatialAnalyzer.test.ts`)

### 5a. Layout type computation tests

Add these test cases (use existing test patterns with the headless tldraw Editor):

```typescript
describe('computeLayoutType', () => {
  it('detects row layout when children share similar Y coordinates', () => {
    // Create a frame containing 3 shapes arranged side by side (same Y, different X)
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

  it('frames with 0 or 1 child have no layoutType', () => {
    const emptyFrame = createShapeId();
    const singleFrame = createShapeId();
    const child = createShapeId();

    editor.createShape({ id: emptyFrame, type: 'frame', x: 0, y: 0, props: { w: 200, h: 200, name: 'empty' } });
    editor.createShape({ id: singleFrame, type: 'frame', x: 800, y: 800, props: { w: 200, h: 200, name: 'single' } });
    editor.createShape({ id: child, type: 'geo', x: 810, y: 810, props: { w: 50, h: 50, geo: 'rectangle' } });

    const tree = buildSpatialTree(editor, [emptyFrame, singleFrame]);
    const empty = tree.find(n => n.label === 'empty')!;
    const single = tree.find(n => n.label === 'single')!;

    // Empty frame: col default since no children to analyze
    // Single child frame: col since only 1 child
    expect(empty.layoutType).toBeUndefined();  // or 'col' depending on implementation
    expect(single.layoutType).toBe('col');
  });
});
```

### 5b. Arrow connection extraction tests

```typescript
describe('buildConnections', () => {
  it('extracts connections from bound arrows', () => {
    const btn = createShapeId();
    const target = createShapeId();
    const arrow = createShapeId();

    editor.createShape({ id: btn, type: 'geo', x: 0, y: 0, props: { w: 100, h: 40, geo: 'rectangle', text: 'Submit' } });
    editor.createShape({ id: target, type: 'frame', x: 300, y: 0, props: { w: 200, h: 200, name: 'Success Page' } });
    editor.createShape({ id: arrow, type: 'arrow', x: 100, y: 20, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, text: 'navigate' } });

    // Create bindings (start → btn, end → target)
    editor.createBinding({ type: 'arrow', fromId: arrow, toId: btn, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });
    editor.createBinding({ type: 'arrow', fromId: arrow, toId: target, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } });

    const connections = buildConnections(editor, [btn, target, arrow]);
    expect(connections).toHaveLength(1);
    expect(connections[0].fromShapeId).toBe(btn);
    expect(connections[0].toShapeId).toBe(target);
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
```

### 5c. Element hint classification tests

These test the `classifyGeoElement()` function via `buildSpatialTree()` output — geo shapes should have `elementHint` and `inputType` set based on their label:

```typescript
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
```

### 5d. alignSelf computation tests

Test that children of col-layout frames get correct horizontal alignment based on position:

```typescript
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
```

---

## CHANGE 6: Rebuild shared package

After modifying `shared/src/api.ts`, rebuild the shared package so downstream consumers pick up the new types:

```bash
cd shared && npm run build
```

---

## Testing Checklist

After all changes:

1. **`cd shared && npm run build`** — shared package compiles
2. **`cd frontend && npx vitest run`** — all existing + new tests pass
3. **`cd ai-service && npx tsc --noEmit`** — AI service compiles
4. **Manual test**: Draw a wireframe → select → Generate Code → verify:
   - Request body in DevTools includes `layoutType` on frame nodes
   - Request body includes `elementHint` and `inputType` on geo nodes
   - "Username" rectangle → `elementHint: "input"`, `inputType: "text"`
   - "Submit" rectangle → `elementHint: "button"`, no `inputType`
   - Request body includes `connections` array if arrows with bindings exist
   - Generated code uses flex-row / flex-col / grid matching the layoutType values
   - Input shapes render as `<input>` with correct type attribute
   - Button shapes render as `<button>` with consistent sizing based on sizeHint
   - Note nodes are NOT rendered as visible UI elements
   - Arrow connections produce onClick handlers on source elements
   - Submit button drawn on right side of form → `alignSelf: "end"` in request body → `self-end` class in generated code
   - Nested frames (frame inside frame) with generic label → no extra padding (`p-0` or no padding class)
5. **Button size consistency test**: Draw 3 same-sized rectangles (Home, About, Contact) in a navbar → Generate Code 3 times → all buttons should have identical size classes every time
6. **Consistency test**: Click Generate Code 3 times on the same wireframe → output should be identical (temperature=0)
7. **All existing tests still pass** (regression check)

---

## Files Modified (Summary)

| File | Action |
|------|--------|
| `shared/src/api.ts` | Add layoutType, gridCols, alignSelf to SpatialNode. Add ArrowConnection type/schema. Update CodeGenerateRequestSchema. |
| `frontend/src/utils/spatialAnalyzer.ts` | Add computeLayoutType(), computeAlignSelf(). Update toNode() with parent context. Add buildConnections(). |
| `frontend/src/pages/BoardPage.tsx` | Import buildConnections. Send connections in POST body. |
| `ai-service/src/codeGenerator.ts` | Replace SYSTEM_PROMPT. Accept connections param. Update user message. |
| `ai-service/src/index.ts` | Pass connections from request to generateCode(). |
| `frontend/src/tests/spatialAnalyzer.test.ts` | Add layout detection + arrow connection tests. |
