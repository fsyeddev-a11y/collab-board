<!-- CLAUDE-PM PLANNING DOCUMENT — Claude-B implementation prompts for CB-002 features. -->
<!-- Copy each prompt separately when implementing that feature. Implement in order: F1 → F2 → F3 → F4 → F5 -->

---

# PROMPT 1: F1 — Minimap Always Visible

---

## Task

Make the tldraw minimap visible by default when a board loads in CollabBoard.

## Context

tldraw v2 includes a built-in NavigationPanel component (bottom-left corner) containing a minimap and zoom controls. It should be enabled by default, but it may not be rendering in our app. The issue could be CSS overrides hiding it, or it may need explicit component configuration.

## Read These Files First

1. `frontend/src/pages/BoardPage.tsx` — Look at the `TLDRAW_COMPONENTS` constant (currently overrides `ContextMenu` and `Toolbar` only) and the CSS overrides at the bottom of the file (lines ~701-712).

## What to Do

1. **Check if the minimap is already rendering.** Run the dev frontend (`npm run dev:frontend`) and inspect the DOM for `.tlui-navigation-panel` or `.tlui-minimap` elements. If they exist but are hidden, it's a CSS issue.

2. **If the minimap is not rendering:** Add `NavigationPanel: DefaultNavigationPanel` to the `TLDRAW_COMPONENTS` constant. Import `DefaultNavigationPanel` from `tldraw`.

3. **If the minimap is hidden by CSS:** Check the CSS overrides at the bottom of BoardPage.tsx. Ensure no rules target `.tlui-navigation-panel` or `.tlui-minimap` with `display: none`. Also check if any global CSS files hide these elements.

4. **Ensure the minimap is expanded (not collapsed) by default.** tldraw may default to collapsed. If so, look for a way to force it open — either via a tldraw prop, by calling an editor method on mount, or via CSS that sets the collapsed state to expanded.

## Constraints

- Do NOT modify any AI service code, shared schemas, or backend code.
- Do NOT modify the existing toolbar or context menu overrides.
- Do NOT add any new dependencies.
- The minimap should work with the existing board sync (shapes synced via WebSocket should appear in the minimap).

## Acceptance Criteria

- Minimap is visible in the bottom-left corner when a board loads
- Zoom controls (+/−, reset, fit) are visible alongside the minimap
- Minimap shows a bird's-eye view of all shapes on the canvas
- Clicking on the minimap pans the viewport to that area
- No regressions in existing toolbar, context menu, or AI panel behavior

---

# PROMPT 2: F2 — Pan/Zoom to AI-Created Objects

---

## Task

After the AI agent creates or modifies objects on the board, automatically animate the viewport to show the user what changed. Smart behavior: zoom-to-fit for multi-shape creation, pan-only for single updates. Also: keep the AI panel open after generation instead of closing it.

## Context

Currently, after AI generation, objects appear at `findStartPosition()` (below existing shapes) and the AI panel closes. The user has no idea where the shapes landed. We need to:

1. Return created/modified shape IDs from resolver functions
2. Compute their bounding box
3. Animate the camera to show them

tldraw v2 provides:
- `editor.zoomToBounds(bounds, opts)` — Zoom camera to fit a bounding box. `opts.animation.duration` controls animation speed. `opts.inset` adds padding.
- `editor.centerOnPoint(point, opts)` — Center camera on a point without changing zoom. Same animation options.
- `editor.getShapePageBounds(id)` — Get bounding box of a shape in page space (returns Box with minX, minY, maxX, maxY, midX, midY, w, h).

## Read These Files First

1. `frontend/src/utils/aiResolver.ts` — All resolver functions (resolveCreateElements, resolveUpdateElements, resolveLayoutElements, resolveCreateDiagram). Note their current return types.
2. `frontend/src/pages/BoardPage.tsx` — `handleAiGenerate()` function (lines ~154-202). Note how `resolveToolCalls()` is called and what happens after.

## What to Do

### Step 1: Make resolvers return affected shape IDs

In `aiResolver.ts`:

- `resolveCreateElements()` — Currently returns void. Change to return `string[]` containing the IDs of every shape it creates via `editor.createShape()`. Collect the IDs as you create shapes.
- `resolveUpdateElements()` — Currently returns void. Change to return `string[]` containing the `shapeId` of every shape it updates.
- `resolveLayoutElements()` — Currently returns void. Change to return `string[]` containing the shapeIds it rearranges.
- `resolveCreateDiagram()` — Currently returns frame IDs for fitting. Change to return `string[]` containing ALL created shape IDs (frames + notes + arrows).
- `resolveToolCalls()` — Currently returns void. Change to return `string[]`. Inside the function, collect all IDs returned by each resolver call into a flat array. Return the combined array.

### Step 2: Animate camera in BoardPage.tsx

In `handleAiGenerate()`:

After `resolveToolCalls(editor, data.toolCalls)` returns the affected IDs:

1. Filter out any IDs where `editor.getShapePageBounds(id)` returns null.
2. Compute union bounding box of all remaining shapes:
   ```
   let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
   for each id:
     bounds = editor.getShapePageBounds(id)
     minX = Math.min(minX, bounds.minX)
     minY = Math.min(minY, bounds.minY)
     maxX = Math.max(maxX, bounds.maxX)
     maxY = Math.max(maxY, bounds.maxY)
   ```
3. Apply smart pan/zoom:
   - **2+ shapes:** `editor.zoomToBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, { animation: { duration: 500 }, inset: 80 })`
   - **1 shape:** `editor.centerOnPoint({ x: bounds.midX, y: bounds.midY }, { animation: { duration: 500 } })`
   - **0 shapes:** Do nothing.

### Step 3: Keep AI panel open

In `handleAiGenerate()`:
- Remove the line `setAiPanelOpen(false)` — the panel should stay open after generation.
- Keep `setAiPrompt('')` — clear the prompt text so the user can type a follow-up.

## Constraints

- Do NOT modify the AI service or shared schemas — this is purely frontend.
- Do NOT change how board state is serialized (shapes gathered before POST).
- Do NOT add any new tldraw tools to the agent.
- Preserve all existing resolver logic — shape creation, layout algorithms, frame fitting.
- The camera animation must happen AFTER `editor.batch()` completes (shapes must exist to compute bounds).

## Acceptance Criteria

- After AI creates a SWOT diagram (4 frames + many notes), viewport animates to show the entire structure
- After AI creates a single sticky note, viewport pans to center on that note without changing zoom
- After AI updates text on an existing shape, viewport pans to that shape
- After AI rearranges shapes via layoutElements, viewport zooms to show all rearranged shapes
- Animation is smooth (500ms duration)
- AI panel stays open after generation (prompt cleared, panel remains visible)
- No regressions in shape creation, layout, or frame fitting

---

# PROMPT 3: F3 — Viewport Windowing (Tiered Board State)

---

## Task

Instead of sending ALL shapes to the AI on every request, send a tiered board state: viewport shapes with full detail, off-screen shapes with only id/type/parentId/text. This reduces token count, lowers latency, and prevents hitting context limits on large boards.

## Context

Currently `handleAiGenerate()` in BoardPage.tsx serializes every shape on the page with full props (id, type, x, y, parentId, isSelected, props). This is sent to the AI service where it's injected into the system prompt as `{boardState}`. For large boards, this will exceed token limits and spike latency.

tldraw v2 provides:
- `editor.getViewportPageBounds()` — Returns a Box representing the visible area in page space (has minX, minY, maxX, maxY, w, h properties).
- `editor.getShapePageBounds(id)` — Returns the bounding box of any shape in page space.

## Read These Files First

1. `frontend/src/pages/BoardPage.tsx` — `handleAiGenerate()` function, specifically the board state serialization (lines ~165-175).
2. `ai-service/src/agent.ts` — `SYSTEM_PROMPT` constant and how `{boardState}` is injected (lines ~272-317 and ~349-355).

## What to Do

### Step 1: Build tiered board state in BoardPage.tsx

In `handleAiGenerate()`, replace the current board state serialization with:

1. Get viewport bounds with 10% padding:
   ```
   const vp = editor.getViewportPageBounds()
   const padX = vp.w * 0.1
   const padY = vp.h * 0.1
   const expanded = {
     minX: vp.minX - padX, minY: vp.minY - padY,
     maxX: vp.maxX + padX, maxY: vp.maxY + padY
   }
   ```

2. For each shape, check if it intersects the expanded viewport (AABB intersection test):
   ```
   const shapeBounds = editor.getShapePageBounds(shape.id)
   const inViewport = shapeBounds &&
     shapeBounds.maxX >= expanded.minX && shapeBounds.minX <= expanded.maxX &&
     shapeBounds.maxY >= expanded.minY && shapeBounds.minY <= expanded.maxY
   ```

3. Frame grouping rule: If a frame is in the viewport, ALL of its children are viewport shapes (full detail). If a child is in viewport but its parent frame is NOT, include the parent frame as a viewport shape too. Implementation:
   - First pass: determine which shapes are geometrically in viewport
   - Second pass: for any frame in viewport, mark all its children as viewport shapes
   - Third pass: for any non-frame shape in viewport whose parentId starts with "shape:", mark that parent as a viewport shape too

4. Build the merged array:
   - Viewport shapes: `{ id, type, parentId, isSelected, props: { ...all props } }`
   - Off-screen shapes: `{ id, type, parentId, text: <extracted> }`

   Text extraction per type:
   - note: `props.text`
   - frame: `props.name`
   - geo: `props.text`
   - text: `props.text`
   - arrow: `props.text` (label)

5. Strip x, y coordinates from ALL shapes (even viewport shapes). The LLM never uses coordinates — this is consistent with the intent-based architecture.

### Step 2: Update system prompt in agent.ts

Add this section to SYSTEM_PROMPT, after the "CURRENT BOARD STATE:" line but before `{boardState}`:

```
BOARD STATE FORMAT:
- Shapes with a 'props' field are in the user's current viewport (full detail).
- Shapes with only id, type, parentId, and text are off-screen (compact summary).
- You can reference ANY shape by ID for updateElements or layoutElements, whether viewport or off-screen.
- When creating new elements, they will be placed in the user's viewport automatically.
- If the user asks about a specific off-screen shape, you can still edit it by ID — you just won't see its visual properties.
```

### Step 3: Verify backward compatibility

The AI service receives `boardState` as `z.array(z.record(z.unknown())).optional()` — this is a loose schema that accepts any shape format. No changes needed to `shared/src/api.ts` or `ai-service/src/index.ts`.

## Constraints

- Do NOT change the AI service request/response schemas — the loose `z.record(z.unknown())` array already accepts the new format.
- Do NOT change the POST /generate endpoint or proxy.
- Do NOT modify findStartPosition() — it still uses editor.getCurrentPageShapes() for placement logic.
- Shapes with no text (arrows without labels, empty geo shapes) should still appear in the off-screen index with `text: ""`.
- Do NOT send x, y coordinates for any shapes (viewport or off-screen).

## Acceptance Criteria

- Board state sent to AI includes full props only for shapes in/near the viewport
- Off-screen shapes appear with id, type, parentId, and text only (no props, no coordinates)
- Frame children are grouped with their parent (parent in viewport → all children get full detail)
- Child in viewport but parent off-screen → parent promoted to full detail
- LLM can still edit off-screen shapes by ID (updateElements works on shapes not in viewport)
- No regressions in AI generation quality for visible shapes
- System prompt explains the tiered format

---

# PROMPT 4: F4 — Semantic Camera Navigation (Search + Pan)

---

## Task

Add a `navigateToElements` tool that lets the AI agent navigate the user's viewport to specific shapes. When the user says "find the SWOT analysis" or "where is the kanban board?", the agent identifies the matching shapes and the frontend pans the camera to them.

## Context

The AI agent receives the full board state (including off-screen compact index from F3) which contains text/name for all shapes. The LLM can semantically match "SWOT analysis" to frames named "Strengths", "Weaknesses", "Opportunities", "Threats" without any vector DB or embedding. It returns the matching shape IDs, and the frontend uses the same pan/zoom logic from F2 to move the camera.

## Read These Files First

1. `shared/src/api.ts` — ToolCallSchema discriminated union (currently 4 members)
2. `ai-service/src/agent.ts` — Tool definitions in buildTools(), SYSTEM_PROMPT
3. `frontend/src/utils/aiResolver.ts` — resolveToolCalls() dispatch and resolver functions
4. `frontend/src/pages/BoardPage.tsx` — handleAiGenerate() and the camera animation logic added in F2

## What to Do

### Step 1: Add schema in shared/src/api.ts

Add `NavigateToElementsToolCallSchema`:
```typescript
export const NavigateToElementsToolCallSchema = z.object({
  tool: z.literal('navigateToElements'),
  shapeIds: z.array(z.string()).min(1),
  description: z.string().optional(),
});
```

Add it to the `ToolCallSchema` discriminated union (now 5 members):
```typescript
export const ToolCallSchema = z.discriminatedUnion('tool', [
  CreateElementsToolCallSchema,
  UpdateElementsToolCallSchema,
  LayoutElementsToolCallSchema,
  CreateDiagramToolCallSchema,
  NavigateToElementsToolCallSchema,
]);
```

Build the shared package: `npm run build:shared`

### Step 2: Add tool definition in ai-service/src/agent.ts

Add a 5th tool to `buildTools()`:

```typescript
new DynamicStructuredTool({
  name: 'navigateToElements',
  description: 'Navigate the user\'s viewport to specific shapes on the board. Use when the user says "find", "show me", "go to", "where is", or "navigate to". Return exact shape IDs from the board state. For framed structures (SWOT, kanban), return the frame IDs — the system will zoom to show them and their contents. This tool does NOT modify anything.',
  schema: z.object({
    shapeIds: z.array(z.string()).min(1).describe('Exact shape IDs from board state to navigate to'),
    description: z.string().optional().describe('Brief label for what was found, e.g. "SWOT Analysis"'),
  }),
  func: async (input) => {
    return JSON.stringify({
      tool: 'navigateToElements',
      shapeIds: input.shapeIds,
      description: input.description || '',
      _observation: `Navigating to ${input.shapeIds.length} shape(s): ${input.description || 'selected shapes'}`,
    });
  },
})
```

### Step 3: Update SYSTEM_PROMPT

Add navigateToElements to the AVAILABLE TOOLS section:
```
- **navigateToElements**: Navigate the user's view to specific shapes. Use when the user says "find", "show me", "go to", "where is", "navigate to". Return shape IDs matching the query. For framed structures, return the frame IDs. This tool does NOT modify anything — it only moves the camera. When the user asks WHERE something is, ALWAYS use this tool — do not describe the location in words.
```

### Step 4: Add resolver in aiResolver.ts

Add `resolveNavigateToElements(editor, call)`:
```typescript
function resolveNavigateToElements(
  editor: Editor,
  call: { shapeIds: string[]; description?: string }
): string[] {
  if (call.description) {
    console.log('[AI Navigate]', call.description);
  }
  // Return the shape IDs directly — no shapes created or modified.
  // The caller (resolveToolCalls) will use these IDs for camera animation.
  return call.shapeIds;
}
```

Add the dispatch case in `resolveToolCalls()`:
```typescript
case 'navigateToElements':
  ids.push(...resolveNavigateToElements(editor, call as any));
  break;
```

Note: `resolveNavigateToElements` does NOT run inside `editor.batch()` since it doesn't modify the store. It can be called outside the batch, or inside (no-op since it creates nothing).

### Step 5: Camera animation

The camera pan/zoom already works from F2 — `resolveToolCalls()` returns the affected IDs, and `handleAiGenerate()` in BoardPage.tsx computes bounds and animates. The navigateToElements IDs will flow through the same path.

## Constraints

- navigateToElements is READ-ONLY — it must NEVER create, modify, or delete shapes.
- No vector DB, no embedding service — the LLM does semantic matching against the board state.
- The tool can be called in parallel with other tools (e.g., "find the SWOT and change Strengths to blue").
- Build shared package (`npm run build:shared`) after modifying shared/src/api.ts.
- Do NOT modify the backend proxy — it passes tool calls through without inspecting them.

## Acceptance Criteria

- "Find the SWOT analysis" → viewport pans to show the 4 SWOT frames
- "Where is the kanban board?" → viewport pans to the kanban columns
- "Show me the sticky note about pricing" → viewport centers on that note
- Navigation works for off-screen shapes (LLM sees them in compact index)
- navigateToElements can be called in parallel with updateElements
- Smooth camera animation (500ms)
- No shapes are created, modified, or deleted
- All existing tests pass (run `npm run test`)

---

# PROMPT 5: F5 — Spatial Compiler (Wireframe → React Code)

---

## Task

Add a "wireframe to code" feature. The user draws a rough UI layout using tldraw shapes (rectangles, text, frames), selects them, and clicks "Generate Code". The system analyzes the spatial containment hierarchy, sends it to the LLM, and displays the generated React + Tailwind code in a floating draggable preview panel with live rendering.

## Context

This has 3 stages:
1. **Spatial analysis** (frontend): Compute which shapes contain which, build a hierarchy tree
2. **Code generation** (AI service): Send the tree to the LLM with a code-gen prompt, get back JSX
3. **Preview rendering** (frontend): Show the code and a live preview in a floating panel

## Read These Files First

1. `frontend/src/pages/BoardPage.tsx` — AI panel structure, editor access, selected shapes
2. `frontend/src/utils/aiResolver.ts` — Shape bounding box usage patterns
3. `ai-service/src/index.ts` — Existing endpoint pattern (POST /generate)
4. `ai-service/src/agent.ts` — getLLM() singleton pattern
5. `shared/src/api.ts` — Schema patterns
6. `backend/src/index.ts` — Proxy routing pattern (POST /api/generate)

## What to Do

### Step 1: Shared schemas (shared/src/api.ts)

Add these schemas:

```typescript
export const SpatialNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    shapeId: z.string(),
    type: z.enum(['frame', 'geo', 'text', 'note']),
    label: z.string(),
    geo: z.string().optional(),
    sizeHint: z.object({
      width: z.enum(['narrow', 'medium', 'wide']),
      height: z.enum(['short', 'medium', 'tall']),
    }),
    children: z.array(SpatialNodeSchema),
  })
);

export const CodeGenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  spatialTree: z.array(SpatialNodeSchema),
  boardId: z.string(),
});

export const CodeGenerateResponseSchema = z.object({
  code: z.string(),
  modelUsed: z.string().optional(),
});
```

Build shared: `npm run build:shared`

### Step 2: Spatial analyzer (NEW FILE: frontend/src/utils/spatialAnalyzer.ts)

Create a function `buildSpatialTree(editor: Editor, shapeIds: TLShapeId[]): SpatialNode[]`

Algorithm:
1. Get bounding boxes for all selected shapes via `editor.getShapePageBounds(id)`
2. Filter out arrow shapes (they represent relationships, not UI elements)
3. For each shape, find its spatial parent — the smallest shape that fully contains it:
   - Shape A is inside Shape B if: A.minX >= B.minX && A.maxX <= B.maxX && A.minY >= B.minY && A.maxY <= B.maxY
   - If multiple containers qualify, pick the one with smallest area (most specific parent)
4. Build tree: shapes with no spatial parent are root nodes. Others are children.
5. Sort children within each parent: top-to-bottom (by Y), then left-to-right (by X) for shapes on the same row (Y within 20px tolerance).
6. For each node, compute size hints:
   - width: w < 200 → "narrow", 200-500 → "medium", w > 500 → "wide"
   - height: h < 100 → "short", 100-300 → "medium", h > 300 → "tall"
7. Extract label: use `props.text` for text/note/geo, `props.name` for frame
8. Strip pixel coordinates — output the hierarchy with labels and size hints only

The `SpatialNode` type:
```typescript
interface SpatialNode {
  shapeId: string;
  type: 'frame' | 'geo' | 'text' | 'note';
  label: string;
  geo?: string;
  sizeHint: { width: 'narrow' | 'medium' | 'wide'; height: 'short' | 'medium' | 'tall' };
  children: SpatialNode[];
}
```

### Step 3: Code generation endpoint (ai-service)

**In `ai-service/src/agent.ts`** (or create `ai-service/src/codeGenerator.ts`):

Add function `generateCode(prompt: string, spatialTree: SpatialNode[]): Promise<string>`:
- Uses `getLLM()` singleton (same LLM instance)
- Single LLM call (NOT agent with tools — just a direct invoke)
- System prompt:

```
You are an expert React developer. Convert the following spatial layout description into a React functional component using Tailwind CSS.

SPATIAL LAYOUT (JSON):
{spatialTree}

USER REQUEST:
{prompt}

RULES:
1. Output a single React functional component as a default export.
2. Use Tailwind CSS classes for all styling.
3. Use semantic HTML elements where the layout implies them (header, nav, main, section, aside, footer).
4. The component must be self-contained with no imports beyond React.
5. Children nested inside containers become child JSX elements.
6. Use the label text as placeholder content.
7. Use flexbox/grid to match the spatial arrangement:
   - Siblings arranged horizontally → flex-row
   - Siblings arranged vertically → flex-col
   - Grid-like arrangement → CSS grid
8. Size hints map to Tailwind:
   - narrow → w-48, medium → w-64 or flex-1, wide → w-full or flex-1
   - short → h-12, medium → h-32 or min-h-fit, tall → h-64 or min-h-screen
9. Respond with ONLY the code block (```jsx ... ```). No explanations.
```

- Parse response: extract code between ```jsx and ``` markers. If no markers found, use entire response.

**In `ai-service/src/index.ts`:**

Add `POST /generate-code` endpoint:
- Same auth middleware as /generate (x-internal-secret validation)
- Validate body with `CodeGenerateRequestSchema`
- Call `generateCode(prompt, spatialTree)`
- Return `CodeGenerateResponseSchema` response
- Timeout: 120 seconds (same as /generate)

### Step 4: Backend proxy (backend/src/index.ts)

Add a proxy route for `POST /api/generate-code`:
- Same pattern as the existing `/api/generate` proxy
- Verify Clerk JWT
- Forward to Hono service at `${AI_SERVICE_URL}/generate-code`
- Include `X-Internal-Secret` header
- Pass through response

### Step 5: Preview panel (NEW FILE: frontend/src/components/CodePreviewPanel.tsx)

Build a floating, draggable, resizable panel component:

**Props:**
```typescript
interface CodePreviewPanelProps {
  code: string;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}
```

**Structure:**
- Title bar: "Code Preview" + close button (X). Title bar is the drag handle.
- Two tabs: "Preview" | "Code"
- Default size: 600×500px. Minimum: 400×300px.
- Position: initially `top: 80px, right: 20px`. Stored in state.
- Z-index: 1001 (above AI panel at 1000)

**Drag implementation:**
- On mousedown on title bar, track starting mouse position and panel position
- On mousemove, update panel position by delta
- On mouseup, stop tracking

**Resize implementation:**
- Bottom-right corner drag handle (16×16px)
- On mousedown, track starting mouse position and panel size
- On mousemove, update size by delta (enforce minimum 400×300)
- On mouseup, stop tracking

**Preview tab:**
- Render an iframe with `sandbox="allow-scripts"` and `srcdoc` containing:
  ```html
  <!DOCTYPE html>
  <html>
  <head>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel">
      ${generatedCode}
      const App = typeof exports !== 'undefined' ? exports.default : (typeof Default !== 'undefined' ? Default : () => <div>No component exported</div>);
      ReactDOM.createRoot(document.getElementById('root')).render(<App />);
    </script>
  </body>
  </html>
  ```
- The iframe has `width: 100%` and `height: 100%` of the tab content area

**Code tab:**
- `<pre><code>` block with monospace font, overflow scroll
- "Copy" button that calls `navigator.clipboard.writeText(code)`
- Show a brief "Copied!" confirmation after copy

**Loading state:** Spinner centered in the panel content area

**Error state:** Red error message in the panel content area

### Step 6: Integration in BoardPage.tsx

1. Add state:
   ```
   const [codePreview, setCodePreview] = useState<{ code: string; isLoading: boolean; error: string | null } | null>(null)
   ```

2. Add "Generate Code" button to the AI panel — show it ONLY when shapes are selected:
   ```
   {selectedShapeCount > 0 && (
     <button onClick={handleCodeGenerate}>Generate Code</button>
   )}
   ```
   Track selected count via `editor.getSelectedShapeIds().length` (update on selection change using editor store listener).

3. `handleCodeGenerate()` function:
   - Get selected shape IDs from editor
   - Call `buildSpatialTree(editor, selectedIds)`
   - Set loading state: `setCodePreview({ code: '', isLoading: true, error: null })`
   - POST to `/api/generate-code` with { prompt: aiPrompt, spatialTree, boardId }
   - On success: `setCodePreview({ code: response.code, isLoading: false, error: null })`
   - On error: `setCodePreview({ code: '', isLoading: false, error: message })`

4. Render CodePreviewPanel when `codePreview !== null`:
   ```
   {codePreview && (
     <CodePreviewPanel
       code={codePreview.code}
       isLoading={codePreview.isLoading}
       error={codePreview.error}
       onClose={() => setCodePreview(null)}
     />
   )}
   ```

## Constraints

- Code output is React + Tailwind CSS only. No framework selection.
- The spatial analyzer runs purely in the browser (no network calls).
- The /generate-code endpoint uses the SAME LLM instance but a DIFFERENT system prompt than the board agent.
- The preview iframe is sandboxed (allow-scripts only) — no access to parent page.
- Do NOT modify the existing AI generation flow (handleAiGenerate). Code generation is a separate flow.
- The Tailwind CDN in the iframe does not affect the main application styling.
- Do NOT add any new npm dependencies for the preview panel. Use native drag/resize handling.

## Acceptance Criteria

- User draws rectangles and text labels, selects them, clicks "Generate Code"
- Spatial analyzer builds correct containment hierarchy (text inside rectangle = child)
- LLM generates valid React + Tailwind component
- Floating panel appears with "Preview" and "Code" tabs
- Preview tab renders the component live in a sandboxed iframe
- Code tab shows raw JSX with working "Copy" button
- Panel is draggable by title bar
- Panel is resizable from bottom-right corner (minimum 400×300)
- Panel closes via X button
- Multiple requests update panel content (don't open new panels)
- Error states display in panel (not as alerts)
- Existing AI generation (createElements, etc.) still works independently
- No new npm dependencies added
