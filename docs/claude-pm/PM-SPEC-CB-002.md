<!-- CLAUDE-PM PLANNING DOCUMENT — Do not modify. This file is maintained by the Claude-PM project management agent. -->

# CLAUDE-B IMPLEMENTATION SPEC

**SPEC ID**: CB-002
**DATE**: 2026-02-22
**PRIORITY**: P0–P1 (5 features, ordered by priority)

**GOAL**: Add viewport intelligence, navigation, and spatial code generation to CollabBoard. These features make the AI agent spatially aware (it sees what the user sees), navigable (it can find and pan to objects), and generative beyond board content (it can compile wireframes into code).

---

## CONTEXT

The AI agent currently creates and edits objects on the board, but has no awareness of where the user is looking. Objects appear at `findStartPosition()` (below existing shapes) regardless of viewport position. The user has no way to navigate to AI-created content, no way to ask the agent to find things, and the agent receives ALL shapes on every request regardless of board size.

CB-001 (batch tool schema) is deferred — the current 4-tool architecture (createElements, updateElements, layoutElements, createDiagram) remains unchanged. This spec focuses on 5 new capabilities layered on top of the existing tool architecture.

---

## FEATURE SUMMARY

| # | Feature | Codename | Complexity | Dependencies |
|---|---------|----------|------------|--------------|
| F1 | Minimap always visible | MINIMAP | Trivial | None |
| F2 | Pan/zoom to AI-created objects | AUTO-PAN | Low | None |
| F3 | Viewport windowing (tiered board state) | VP-WINDOW | Medium | None |
| F4 | Semantic camera navigation (search + pan) | SEARCH-NAV | Medium-High | F2 (pan logic), F3 (global index) |
| F5 | Spatial compiler (wireframe → React code) | SPATIAL-CODE | High | None |

---

## READ THESE FILES FIRST

1. `frontend/src/pages/BoardPage.tsx` — Main canvas page, AI panel, tldraw component config, handleAiGenerate(), board state serialization
2. `frontend/src/utils/aiResolver.ts` — Tool call resolution, findStartPosition(), all layout functions
3. `ai-service/src/agent.ts` — Tool definitions, SYSTEM_PROMPT, runAgent(), boardState injection
4. `ai-service/src/index.ts` — Hono routes, POST /generate handler
5. `shared/src/api.ts` — ToolCallSchema discriminated union, AI request/response schemas
6. `shared/src/shapes.ts` — Shape type definitions (note, geo, text, frame, arrow)

---

## F1: MINIMAP ALWAYS VISIBLE

### Overview

tldraw v2 includes a built-in NavigationPanel with minimap and zoom controls. It is enabled by default but may not be rendering due to CSS overrides or component configuration. Ensure the minimap is always visible.

### Files to Modify

1. `frontend/src/pages/BoardPage.tsx` — Verify and fix minimap visibility

### Requirements

**F1-R1.** The tldraw minimap must be visible by default when a board loads. The NavigationPanel (which contains the minimap and zoom controls) must render in its default position (bottom-left corner).

**F1-R2.** Check the current `TLDRAW_COMPONENTS` constant (currently only overrides `ContextMenu` and `Toolbar`). Ensure that `NavigationPanel` and `Minimap` are NOT set to `null`. If tldraw defaults are not showing the minimap, explicitly set `NavigationPanel: DefaultNavigationPanel` in the components prop.

**F1-R3.** Check the CSS overrides at the bottom of BoardPage.tsx (lines ~701-712). Ensure no CSS rules hide the navigation panel or minimap elements. tldraw uses class names like `.tlui-navigation-panel` and `.tlui-minimap`.

**F1-R4.** The minimap should be open (expanded) by default, not collapsed. If tldraw defaults to collapsed, find the appropriate prop or CSS to force it open.

### Acceptance Criteria

- [ ] Minimap is visible in the bottom-left corner when a board loads
- [ ] Zoom controls (+/-, reset, fit) are visible alongside the minimap
- [ ] Minimap shows a bird's-eye view of all shapes on the canvas
- [ ] Clicking on the minimap pans the viewport to that area
- [ ] No regressions in existing toolbar or context menu behavior

---

## F2: PAN/ZOOM TO AI-CREATED OBJECTS

### Overview

After the AI creates or modifies objects, the viewport should automatically move to show the user what changed. Currently objects appear off-screen and the user has no idea where they are. The behavior is smart: zoom-to-fit for multi-shape creation (shows the whole structure), pan-only for single updates (preserves zoom level).

### tldraw APIs to Use

- `editor.zoomToBounds(bounds, opts)` — Zoom camera to fit a bounding box. Supports animation via `opts.animation.duration`.
- `editor.centerOnPoint(point, opts)` — Center camera on a page-space point without changing zoom. Supports animation.
- `editor.getShapePageBounds(id)` — Get bounding box of a shape in page space. Returns a `Box` with `x, y, w, h, minX, minY, maxX, maxY`.
- `Box.expandBy(amount)` — Expand bounds by padding.

### Files to Modify

1. `frontend/src/utils/aiResolver.ts` — Return created/modified shape IDs from resolver functions
2. `frontend/src/pages/BoardPage.tsx` — After resolveToolCalls(), compute bounds and animate camera

### Requirements

**F2-R1.** Each resolver function (`resolveCreateElements`, `resolveUpdateElements`, `resolveLayoutElements`, `resolveCreateDiagram`) must return an array of shape IDs that were created or modified during that call. Currently these functions return `void` or frame IDs only for fitting. Change their return types to `string[]` (tldraw shape IDs).

**F2-R2.** The main `resolveToolCalls()` function must collect all returned shape IDs from all tool call resolutions into a single flat array of affected shape IDs.

**F2-R3.** `resolveToolCalls()` must return this collected array of affected shape IDs to the caller (BoardPage.tsx). Current return type is `void` — change to `string[]`.

**F2-R4.** In `handleAiGenerate()` in BoardPage.tsx, after calling `resolveToolCalls()`, compute the bounding box of all affected shapes:
- For each shape ID, call `editor.getShapePageBounds(id)` to get its bounds.
- Merge all bounds into a single encompassing bounding box (union of all individual bounds).
- Skip any IDs where `getShapePageBounds` returns `null` (shape may have been deleted).

**F2-R5.** Apply smart pan/zoom behavior based on the number of affected shapes:
- **Multi-shape creation (2+ shapes affected):** Call `editor.zoomToBounds(unionBounds, { animation: { duration: 500 }, inset: 80 })`. The `inset` adds padding so shapes aren't flush against the viewport edge.
- **Single shape update (1 shape affected):** Call `editor.centerOnPoint({ x: bounds.midX, y: bounds.midY }, { animation: { duration: 500 } })`. This pans to the shape without changing zoom level.
- **No shapes affected (0):** Do nothing.

**F2-R6.** The camera animation must happen AFTER the `editor.batch()` completes (shapes must exist before computing bounds). The current flow is: `resolveToolCalls()` → `setAiPanelOpen(false)`. The new flow is: `resolveToolCalls()` → animate camera → keep panel open (panel closing is addressed separately — do NOT change panel open/close behavior in this feature).

**F2-R7.** Do NOT close the AI panel after generation. Remove the line `setAiPanelOpen(false)` from `handleAiGenerate()`. The user should be able to see the result and continue prompting. Clear the prompt text (`setAiPrompt('')`) but keep the panel open.

### Constraints

- Do NOT modify the AI service or shared schemas — this is purely frontend.
- Do NOT change how board state is serialized — that's F3.
- Do NOT add new tools — that's F4.
- Preserve all existing resolver logic (shape creation, layout algorithms, frame fitting).

### Acceptance Criteria

- [ ] After AI creates a SWOT diagram (4 frames + notes), the viewport animates to show the entire structure
- [ ] After AI creates a single sticky note, the viewport pans to center on that note without changing zoom
- [ ] After AI updates text on an existing shape, the viewport pans to that shape
- [ ] After AI rearranges shapes via layoutElements, the viewport zooms to show all rearranged shapes
- [ ] Animation is smooth (500ms duration)
- [ ] AI panel stays open after generation (prompt cleared, panel remains)
- [ ] No regressions in shape creation, layout, or frame fitting

---

## F3: VIEWPORT WINDOWING (TIERED BOARD STATE)

### Overview

Instead of sending ALL shapes to the AI on every request, send a tiered board state:
- **Viewport shapes (full detail):** Shapes visible in the user's current viewport + 10% padding. Include all props.
- **Off-screen shapes (compact index):** Everything else. Include only id, type, parentId, and text/name — no coordinates, no visual props, no dimensions.

This reduces token count, lowers latency, and prevents hitting context limits on large boards. The LLM can still reference off-screen shapes by ID for edits, but gets spatial detail only for what the user is looking at.

### tldraw APIs to Use

- `editor.getViewportPageBounds()` — Returns a `Box` representing the visible area in page space.
- `editor.getShapePageBounds(id)` — Returns the bounding box of a shape in page space.
- `Box` methods: `minX`, `minY`, `maxX`, `maxY`, `w`, `h` — for intersection checks.

### Files to Modify

1. `frontend/src/pages/BoardPage.tsx` — Replace board state serialization with tiered approach
2. `ai-service/src/agent.ts` — Update SYSTEM_PROMPT to explain tiered board state format
3. `shared/src/api.ts` — Update AIGenerateRequestSchema to support tiered format (optional)

### Requirements

**F3-R1.** In `handleAiGenerate()`, before building the board state, get the viewport bounds:
```
const vpBounds = editor.getViewportPageBounds()
```
Expand by 10% padding on all sides:
```
const padX = vpBounds.w * 0.1
const padY = vpBounds.h * 0.1
const expandedBounds = {
  minX: vpBounds.minX - padX, minY: vpBounds.minY - padY,
  maxX: vpBounds.maxX + padX, maxY: vpBounds.maxY + padY
}
```

**F3-R2.** For each shape on the current page, check if its page bounds intersect the expanded viewport bounds. A shape is "in viewport" if its bounding box overlaps the expanded bounds (standard AABB intersection: not `shapeBounds.maxX < expandedBounds.minX` and not `shapeBounds.minX > expandedBounds.maxX` and same for Y).

**F3-R3.** Build two arrays in the board state payload:

**Viewport shapes (full detail):**
```
{
  id, type, parentId, isSelected,
  props: { ...all props }
}
```
Note: x, y coordinates are STRIPPED even for viewport shapes — the LLM never uses coordinates. This is consistent with the intent-based architecture.

**Off-screen shapes (compact index):**
```
{
  id, type, parentId,
  text: <extracted text or name>
}
```
Where `text` is:
- For notes: `props.text`
- For frames: `props.name`
- For geo shapes: `props.text` (may be empty)
- For text shapes: `props.text`
- For arrows: `props.text` (label, may be empty)

**F3-R4.** Frame inclusion rule: If a frame is in the viewport, ALL of its children are included as viewport shapes (full detail), even if some children are technically outside the expanded bounds. Rationale: the LLM needs the complete frame context to make sensible edits. Conversely, if a child is in the viewport but its parent frame is not, include the parent frame as a viewport shape too.

**F3-R5.** Send the tiered board state in the request body. Two options (choose one):
- **Option A (simple):** Merge both arrays into a single `boardState` array. Viewport shapes have a `props` field, off-screen shapes do not. The LLM and system prompt can distinguish by presence of `props`.
- **Option B (explicit):** Send as `{ viewportShapes: [...], offScreenIndex: [...] }` and update the AI request schema accordingly.

Recommended: **Option A** — simpler, no schema changes needed, backward-compatible. The system prompt explains the format.

**F3-R6.** Update SYSTEM_PROMPT in `ai-service/src/agent.ts` to explain the tiered format. Add a section after CURRENT BOARD STATE:

```
BOARD STATE FORMAT:
- Shapes with a 'props' field are in the user's current viewport (full detail).
- Shapes with only id, type, parentId, and text are off-screen (compact summary).
- You can reference ANY shape by ID for updateElements or layoutElements, whether in-viewport or off-screen.
- When creating new elements, they will be placed in the user's viewport automatically.
- If the user asks about a specific off-screen shape, you can still edit it by ID. You just won't have its visual properties (color, size, etc.) — only its text/name content.
```

**F3-R7.** The viewport camera state itself (zoom level, center point) does NOT need to be sent to the AI service. The frontend uses it for filtering only.

### Constraints

- Do NOT change the AI service request/response flow (POST /generate stays the same).
- Do NOT add new tools — this is about optimizing the existing board state context.
- Shapes without text/name (e.g., arrows with no label, geo shapes with no text) should still appear in the off-screen index with an empty `text` field — the LLM needs their IDs for potential edits.
- Do NOT change how findStartPosition() works (that still uses editor.getCurrentPageShapes()).

### Acceptance Criteria

- [ ] Board state sent to AI only includes full props for shapes in/near the viewport
- [ ] Off-screen shapes appear in board state with id, type, parentId, and text only
- [ ] Frame children are grouped with their parent (if parent is in viewport, all children get full detail)
- [ ] LLM can still edit off-screen shapes by referencing their ID (updateElements works on off-screen shapes)
- [ ] Token count is measurably lower for boards with shapes spread across the canvas
- [ ] No regressions in AI generation quality for viewport-visible shapes
- [ ] System prompt explains the tiered format clearly

---

## F4: SEMANTIC CAMERA NAVIGATION (SEARCH + PAN)

### Overview

The user asks the AI "find the SWOT analysis" and the viewport pans to it. This requires a new agent tool (`navigateToElements`) that the LLM uses to identify matching shapes by semantic query, and the frontend pans the camera to those shapes.

No vector DB is needed. The board state (even in compact form from F3) includes text/name for all shapes. The LLM performs the semantic matching — it understands that "SWOT analysis" means frames named "Strengths", "Weaknesses", "Opportunities", "Threats".

### Files to Modify

1. `shared/src/api.ts` — Add NavigateToElementsToolCallSchema to the ToolCallSchema union
2. `ai-service/src/agent.ts` — Add navigateToElements tool definition, update SYSTEM_PROMPT
3. `frontend/src/utils/aiResolver.ts` — Add resolveNavigateToElements, return shape IDs for panning
4. `frontend/src/pages/BoardPage.tsx` — Handle navigation tool calls (camera pan from F2 logic)

### Requirements

**F4-R1.** Define a `NavigateToElementsToolCallSchema` in `shared/src/api.ts`:
```
{
  tool: literal("navigateToElements"),
  shapeIds: array of strings (min 1),
  description: string (optional — brief label like "SWOT Analysis" for UI feedback)
}
```

**F4-R2.** Add the schema to the `ToolCallSchema` discriminated union. The union now has 5 members: createElements, updateElements, layoutElements, createDiagram, navigateToElements.

**F4-R3.** Define a `navigateToElements` tool in `ai-service/src/agent.ts` using DynamicStructuredTool:
- **Name:** "navigateToElements"
- **Description:** "Navigate the user's viewport to specific shapes on the board. Use this when the user asks to find, locate, show, go to, or navigate to objects. Return the exact shape IDs from the board state that match what the user is looking for. For grouped content (like a SWOT analysis), include the parent frame IDs — the frontend will zoom to show them all."
- **Schema:**
  ```
  z.object({
    shapeIds: z.array(z.string()).min(1).describe("Exact shape IDs from the board state to navigate to"),
    description: z.string().optional().describe("Brief label for what was found, e.g. 'SWOT Analysis'")
  })
  ```
- **func:** Returns JSON string with `tool: "navigateToElements"`, the shapeIds, and description.

**F4-R4.** Update SYSTEM_PROMPT with navigateToElements guidance:
```
- **navigateToElements**: Navigate the user's view to specific shapes. Use when the user says "find", "show me", "go to", "where is", "navigate to", etc. Return the shape IDs that match the user's query. For framed structures (SWOT, kanban, etc.), return the frame IDs — the system will zoom to show them and their contents. This tool does NOT modify anything — it only moves the camera.
```

**F4-R5.** Add `resolveNavigateToElements(editor, call)` in `aiResolver.ts`:
- Does NOT create or modify any shapes.
- Returns the `shapeIds` array directly (these are the "affected" IDs that F2's pan logic uses).
- If `description` is provided, log it: `console.log('[AI Navigate]', description)`.

**F4-R6.** The camera pan behavior for navigation uses the same logic as F2:
- If 1 shape: `centerOnPoint` (pan without zoom change).
- If 2+ shapes: `zoomToBounds` with animation and inset padding.

**F4-R7.** The LLM should prefer `navigateToElements` over explaining location in text. The system prompt should make this clear: "When the user asks WHERE something is, use navigateToElements — do not describe the location in words."

### Constraints

- `navigateToElements` must be read-only — it NEVER creates, modifies, or deletes shapes.
- The LLM receives the full board state (F3's tiered format) which includes text/name for ALL shapes, enabling semantic matching on off-screen shapes.
- No vector DB, no embedding service — the LLM does the matching.
- This tool can be called in parallel with other tools (e.g., "find the SWOT and add a new item to Strengths").

### Acceptance Criteria

- [ ] User says "find the SWOT analysis" → viewport pans to show the 4 SWOT frames
- [ ] User says "where is the kanban board?" → viewport pans to the kanban columns
- [ ] User says "show me the sticky note about pricing" → viewport pans to that specific note
- [ ] Navigation works for off-screen shapes (the LLM can see them in the compact index)
- [ ] navigateToElements can be called in parallel with updateElements (e.g., "find the SWOT and make it blue")
- [ ] Smooth camera animation (500ms)
- [ ] No shapes are created, modified, or deleted by navigateToElements

---

## F5: SPATIAL COMPILER (WIREFRAME → REACT CODE)

### Overview

The user draws a rough UI wireframe using tldraw shapes (rectangles, text boxes, frames), selects them, and asks: "Turn this wireframe into a React component." The system analyzes spatial relationships (containment, alignment, ordering), builds a hierarchical tree, sends it to the LLM with a code generation prompt, and renders the output in a floating draggable preview panel.

### Architecture

The flow has 3 stages:

**Stage 1: Spatial Analysis (frontend, deterministic)**
- Take selected shapes from the editor
- Compute containment hierarchy: which shapes are fully contained inside which
- Compute spatial ordering: left-to-right, top-to-bottom within each container
- Build a hierarchical JSON tree representing the component structure

**Stage 2: Code Generation (AI service)**
- Send the spatial tree + user prompt to a dedicated endpoint
- LLM generates React + Tailwind JSX code
- Return the code string

**Stage 3: Preview Rendering (frontend)**
- Display code in a floating, resizable, draggable panel
- Render a live preview using a sandboxed iframe
- Panel sits on top of the canvas (picture-in-picture style)

### Files to Create

1. `frontend/src/utils/spatialAnalyzer.ts` — New file: spatial containment analysis and tree building
2. `frontend/src/components/CodePreviewPanel.tsx` — New file: floating draggable panel with code + preview

### Files to Modify

1. `frontend/src/pages/BoardPage.tsx` — Add code generation trigger, render CodePreviewPanel
2. `ai-service/src/index.ts` — Add POST /generate-code endpoint
3. `ai-service/src/agent.ts` — Add code generation function (separate from board agent)
4. `shared/src/api.ts` — Add CodeGenerateRequestSchema and CodeGenerateResponseSchema

### Requirements

#### Stage 1: Spatial Analysis

**F5-R1.** Create `frontend/src/utils/spatialAnalyzer.ts` with a function `buildSpatialTree(editor: Editor, shapeIds: TLShapeId[]): SpatialNode[]`.

**F5-R2.** Define the `SpatialNode` type:
```
{
  shapeId: string,
  type: 'frame' | 'geo' | 'text' | 'note' | 'arrow',
  label: string,          // text content or frame name
  geo?: string,           // 'rectangle', 'ellipse', etc. (for geo shapes)
  bounds: { x, y, w, h }, // page-space bounding box
  children: SpatialNode[] // shapes fully contained inside this shape
}
```

**F5-R3.** Containment detection: Shape A is a child of Shape B if A's bounding box is fully contained within B's bounding box (A.minX >= B.minX && A.maxX <= B.maxX && A.minY >= B.minY && A.maxY <= B.maxY). When multiple containers could claim a shape, choose the smallest container (most specific parent).

**F5-R4.** Ordering within a container: Sort children top-to-bottom first (by Y coordinate), then left-to-right (by X coordinate) for shapes on the same row (Y values within 20px tolerance).

**F5-R5.** The spatial tree is ONLY computed from the selected shapes. Shapes not in the selection are ignored. Arrow shapes are excluded from the tree (they represent relationships, not UI elements).

**F5-R6.** Strip coordinates from the spatial tree before sending to the LLM. The LLM receives the hierarchy and labels, not pixel values. Include relative sizing hints instead: "narrow" (w < 200), "medium" (200-500), "wide" (w > 500), "short" (h < 100), "tall" (h > 300).

#### Stage 2: Code Generation

**F5-R7.** Add schemas to `shared/src/api.ts`:

`CodeGenerateRequestSchema`:
```
{
  prompt: string (1-2000 chars),
  spatialTree: array of SpatialNode (the hierarchy),
  boardId: string
}
```

`CodeGenerateResponseSchema`:
```
{
  code: string (the generated JSX/Tailwind code),
  modelUsed: string (optional)
}
```

**F5-R8.** Add `POST /generate-code` endpoint in `ai-service/src/index.ts`:
- Validates `x-internal-secret` header (same auth as /generate)
- Validates body with `CodeGenerateRequestSchema`
- Calls a dedicated code generation function (not the board agent)
- Returns `CodeGenerateResponseSchema`

**F5-R9.** Add `generateCode(prompt: string, spatialTree: SpatialNode[])` function in `ai-service/src/agent.ts` (or a new file `ai-service/src/codeGenerator.ts`):
- Uses the same LLM instance (`getLLM()`)
- Does NOT use tools or AgentExecutor — single LLM call with a code-generation system prompt
- System prompt instructs the LLM to output a single React functional component using Tailwind CSS
- The spatial tree is serialized as JSON in the prompt
- Response is parsed for the code block (extract content between ```jsx and ```)

**F5-R10.** Code generation system prompt (approximate):
```
You are an expert React developer. Convert the following spatial layout description into a React functional component using Tailwind CSS.

SPATIAL LAYOUT:
{spatialTree}

USER REQUEST:
{prompt}

RULES:
1. Output a single React functional component as a default export.
2. Use Tailwind CSS classes for all styling. Do not use inline styles or CSS modules.
3. Use semantic HTML elements (header, nav, main, section, aside, footer) where the spatial layout implies them.
4. The component should be self-contained with no external dependencies beyond React and Tailwind.
5. Preserve the spatial hierarchy: children nested inside containers become child elements.
6. Use the label text as placeholder content.
7. Use flexbox/grid layouts that match the spatial arrangement (horizontal = flex-row, vertical = flex-col, grid = grid).
8. Respond with ONLY the code block. No explanations.
```

**F5-R11.** Add a proxy route in `backend/src/index.ts` for `POST /api/generate-code` that forwards to the Hono service's `/generate-code` endpoint (same pattern as the existing `/api/generate` proxy).

#### Stage 3: Preview Panel

**F5-R12.** Create `frontend/src/components/CodePreviewPanel.tsx` — a floating, resizable, draggable panel component.

**F5-R13.** Panel specifications:
- **Default size:** 600px wide × 500px tall
- **Position:** Initially centered on screen, offset to the right of the selected shapes
- **Draggable:** Title bar enables drag-to-move (track mouse delta, update position state)
- **Resizable:** Bottom-right corner drag handle for resizing (minimum 400×300)
- **Z-index:** Above canvas (z-index 1001, above the AI panel's 1000)
- **Close button:** X button in the title bar
- **Two tabs:** "Preview" and "Code"

**F5-R14.** Preview tab: Renders the generated code in a sandboxed iframe.
- Create an iframe with `srcdoc` containing an HTML document that:
  - Includes the Tailwind CDN (`<script src="https://cdn.tailwindcss.com">`)
  - Includes a minimal React UMD bundle (`react.production.min.js` + `react-dom.production.min.js`)
  - Renders the component inside a `<div id="root">`
- The iframe must have `sandbox="allow-scripts"` for security (no access to parent page)

**F5-R15.** Code tab: Displays the raw JSX code in a `<pre><code>` block with basic syntax highlighting (or use a monospace font without highlighting for simplicity). Include a "Copy to Clipboard" button.

**F5-R16.** Loading state: While code is generating, show a spinner/loading indicator in the panel.

**F5-R17.** Error state: If code generation fails, show the error message in the panel instead of closing it.

#### Integration

**F5-R18.** In BoardPage.tsx, detect when the user's AI prompt is a code generation request. Heuristic: if the prompt contains keywords like "code", "component", "react", "html", "convert to", "turn into", "generate code", "wireframe to" AND shapes are selected, route to the code generation flow instead of the normal AI flow.

**F5-R19.** Alternatively (simpler): Add a "Generate Code" button to the AI panel that appears when shapes are selected. This button triggers the code generation flow. The existing "Generate" button continues to handle normal AI operations. This avoids ambiguous intent detection.

Recommended: **F5-R19** (explicit button). Avoids false positives from the heuristic.

**F5-R20.** The code generation flow:
1. User selects shapes on canvas
2. User clicks "Generate Code" in the AI panel
3. Frontend calls `buildSpatialTree(editor, selectedIds)` to build the hierarchy
4. Frontend POSTs to `/api/generate-code` with prompt + spatialTree + boardId
5. Response contains generated code string
6. Frontend opens CodePreviewPanel with the code
7. Panel renders live preview + code view

### Constraints

- Code output locked to React + Tailwind CSS only (no framework selection).
- The spatial analyzer runs in the browser (pure frontend math, no network calls).
- The code generation uses the same LLM endpoint (OpenRouter via the Hono service) but a different system prompt — NOT the board agent with tools.
- The preview iframe is sandboxed — it cannot access the parent page, localStorage, or cookies.
- Do NOT modify the existing AI generation flow (handleAiGenerate) — code generation is a parallel flow.
- The Tailwind CDN in the iframe is for preview only — it does not affect the main application.

### Acceptance Criteria

- [ ] User draws rectangles and text, selects them, clicks "Generate Code"
- [ ] Spatial analyzer correctly identifies containment hierarchy (text inside rectangle = child element)
- [ ] LLM generates a valid React component with Tailwind CSS
- [ ] Preview panel appears floating on top of the canvas
- [ ] Preview tab shows a rendered version of the component
- [ ] Code tab shows the raw JSX with a copy button
- [ ] Panel is draggable (move by dragging title bar)
- [ ] Panel is resizable (resize from bottom-right corner)
- [ ] Panel can be closed via X button
- [ ] Code generation does not interfere with normal AI generation
- [ ] Multiple code generation requests update the panel content (not open new panels)
- [ ] Error states display in the panel (not as alerts)

---

## DEPENDENCY ORDER

These features should be implemented in sequence:

**Phase 1: F1 (Minimap)** — Trivial CSS/component fix. No code dependencies.

**Phase 2: F2 (Auto-Pan)** — Changes aiResolver return types and adds camera animation in BoardPage. No AI service changes.

**Phase 3: F3 (Viewport Windowing)** — Changes board state serialization in BoardPage and system prompt in AI service. Must be tested with existing tools.

**Phase 4: F4 (Search Navigation)** — Adds a new tool (schema + AI service + resolver). Depends on F2 for camera pan logic and F3 for the compact global index (so LLM can find off-screen shapes).

**Phase 5: F5 (Spatial Compiler)** — Adds new endpoint, new frontend components, new utility. Independent of F1-F4 but scheduled last due to highest complexity.

---

## OUT OF SCOPE

- CB-001 (batch tool schema / batchOperations) — deferred, current 4-tool architecture remains
- Chat UI redesign (persistent chat log, debug toggle) — separate spec
- Vector DB / embedding-based search — not needed at current scale
- Multi-framework code generation (Vue, Svelte, etc.) — React + Tailwind only
- Backend proxy changes beyond the new /api/generate-code route
- Mobile/responsive layout for the preview panel
