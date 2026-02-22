<!-- CLAUDE-PM PLANNING DOCUMENT — Do not modify. This file is maintained by the Claude-PM project management agent. -->

# CLAUDE-B IMPLEMENTATION SPEC

**SPEC ID**: CB-001
**DATE**: 2026-02-22
**PRIORITY**: P0

**GOAL**: Replace `createElements` and `createDiagram` tools with a single unified `batchOperations` tool that supports ref-ID cross-referencing, layout directives, and novel structure creation.

---

## CONTEXT

The AI agent currently has 4 tools: `createElements`, `updateElements`, `layoutElements`, and `createDiagram`. The `createDiagram` tool handles known templates (SWOT, kanban, retrospective, user journey) reliably because the frontend resolver has hardcoded layout algorithms. However, the agent cannot express novel structures (flowcharts with branching connectors, org charts, arbitrary topologies) because there is no mechanism for cross-referencing newly-created objects within a single response. `createElements` creates flat lists of unrelated objects with no parent-child binding. This causes BUG-002 (multi-step prompts fail or partially complete).

This spec replaces both `createElements` and `createDiagram` with a single `batchOperations` tool. The new tool uses a ref-ID system for cross-referencing objects within a batch, and layout directives to dispatch to existing template algorithms or a new generic layout engine. After this change, the agent has 3 tools: `batchOperations`, `updateElements`, `layoutElements`.

---

## READ THESE FILES FIRST

1. `shared/src/api.ts` — Current tool call schemas (CreateElementsToolCallSchema, CreateDiagramToolCallSchema, and the ToolCallSchema discriminated union)
2. `shared/src/shapes.ts` — TLColorSchema enum (the valid color values), shape type definitions
3. `shared/src/index.ts` — Re-exports
4. `ai-service/src/agent.ts` — Current tool definitions (createElements, createDiagram), SYSTEM_PROMPT, COLOR_ALIASES, buildTools(), runAgent()
5. `ai-service/src/index.ts` — Hono route handler for POST /generate (to understand how agent responses flow)
6. `frontend/src/utils/aiResolver.ts` — Current resolver functions: resolveCreateElements, resolveCreateDiagram, layoutSwot, layoutColumns, layoutUserJourney, createFrameWithNotes, calcFrameHeight, fitFramesToChildren, findStartPosition, SWOT_COLORS, NOTE_W, NOTE_H, NOTE_GAP, NOTE_PADDING, FRAME_HEADER, FRAME_GAP, COL_W
7. `frontend/src/pages/BoardPage.tsx` — How resolveToolCalls is called after AI response
8. `ai-service/src/__tests__/agent-tools.test.ts` — Current tool schema tests
9. `frontend/src/tests/aiResolver.test.ts` — Current resolver tests

---

## FILES TO MODIFY

1. `shared/src/api.ts` — Replace CreateElementsToolCallSchema and CreateDiagramToolCallSchema with BatchOperationsToolCallSchema
2. `ai-service/src/agent.ts` — Replace createElements and createDiagram tool definitions with batchOperations tool; rewrite SYSTEM_PROMPT
3. `frontend/src/utils/aiResolver.ts` — Replace resolveCreateElements and resolveCreateDiagram with resolveBatchOperations; add ref-ID map, layout directive dispatch, generic layout engine
4. `ai-service/src/__tests__/agent-tools.test.ts` — Replace createElements and createDiagram tests with batchOperations tests
5. `frontend/src/tests/aiResolver.test.ts` — Replace createElements and createDiagram resolver tests with batchOperations resolver tests

---

## REQUIREMENTS

### Shared Schema (shared/src/api.ts)

**R1.** Define a ref field validation rule: non-empty string, minimum 2 characters, maximum 40 characters, matching the pattern of lowercase letters, digits, and underscores only. This validation is reused by every operation schema.

**R2.** Define 5 operation schemas as a discriminated union on the `op` field:

- **createFrame**: fields `op` (literal "createFrame"), `ref` (ref validation), `name` (string, required), `color` (TLToolColorSchema, optional), `parentRef` (ref validation, optional).
- **createNote**: fields `op` (literal "createNote"), `ref`, `text` (string, required), `color` (TLToolColorSchema, optional), `parentRef` (optional).
- **createShape**: fields `op` (literal "createShape"), `ref`, `geo` (string, optional, defaults to "rectangle"), `text` (string, optional), `color` (optional), `parentRef` (optional).
- **createText**: fields `op` (literal "createText"), `ref`, `text` (string, required), `color` (optional), `parentRef` (optional).
- **createConnector**: fields `op` (literal "createConnector"), `ref`, `fromRef` (ref validation, required), `toRef` (ref validation, required), `label` (string, optional), `color` (optional).

**R3.** Define a layout directive enum with values: `"swot-2x2"`, `"columns"`, `"journey-stages"`, `"grid"`, `"rows"`, `"flowchart-top-down"`, `"flowchart-left-right"`, `"freeform"`.

**R4.** Define the BatchOperationsToolCallSchema with fields:
- `tool`: literal `"batchOperations"`
- `operations`: array of the operation discriminated union, minimum 1, maximum 50
- `layoutDirective`: the layout directive enum, optional
- `title`: string, optional

**R5.** Update the ToolCallSchema discriminated union to include BatchOperationsToolCallSchema in place of CreateElementsToolCallSchema and CreateDiagramToolCallSchema. The union should now contain 3 members: BatchOperationsToolCallSchema, UpdateElementsToolCallSchema, LayoutElementsToolCallSchema.

**R6.** Remove CreateElementsToolCallSchema and CreateDiagramToolCallSchema entirely. Remove any associated types or exports.

**R7.** Export the new schemas and their inferred TypeScript types so that both the AI service and frontend can import them.

---

### AI Service Tool Definition (ai-service/src/agent.ts)

**R8.** Remove the `createElements` and `createDiagram` tool definitions from `buildTools()`.

**R9.** Add a `batchOperations` tool definition using DynamicStructuredTool with a Zod schema matching the shared BatchOperationsToolCallSchema structure. The tool description must clearly state: "Create one or more objects on the board with optional parent-child relationships and layout arrangement. Use ref IDs to reference objects within the same batch. Parents must appear before children. Objects must appear before connectors that reference them."

**R10.** The batchOperations tool's Zod schema must include the same color alias preprocessing that the current createElements tool uses (the COLOR_ALIASES map that converts "purple" to "violet", "pink" to "light-red", etc.). Apply this preprocessing to every color field across all operation types.

**R11.** The batchOperations tool's `func` must return a JSON string containing all input fields plus a `tool: "batchOperations"` field and an `_observation` field (same pattern as existing tools). The `_observation` should summarize what was requested (e.g., "Batch of N operations with layout directive X").

**R12.** `buildTools()` should now return exactly 3 tools: `batchOperations`, `updateElements`, `layoutElements`.

**R13.** Rewrite SYSTEM_PROMPT with the following structure and content:

- **Identity section**: Same as today — the agent is a whiteboard assistant that outputs intent, not coordinates.

- **Tool selection rules**: Three tools only. Use `batchOperations` for creating ANY new objects or structures. Use `updateElements` for editing existing objects by their real shape ID from board state. Use `layoutElements` for rearranging existing objects by their real shape IDs.

- **Ref-ID rules**: Every operation in a batch must have a unique ref. Refs must be short, descriptive, and use the format `type_descriptor` or `type_descriptor_N` (e.g., "frame_strengths", "note_brand_1", "note_brand_2"). Never reuse a ref within a batch. parentRef must reference a ref defined earlier in the operations array. Connector fromRef and toRef must reference refs defined earlier. The system will skip any operation with a duplicate, empty, or invalid ref.

- **Dependency ordering rules**: Always order operations as: (1) standalone frames first, (2) child objects inside frames second, (3) connectors last. For nested frames, outer frames before inner frames.

- **Layout directive guidance**: When the overall structure matches a known template, use the corresponding directive. When no template fits, use "freeform" or the appropriate generic directive.

- **Common pattern recipes section**: Include explicit, detailed recipes for these patterns:

  - **SWOT analysis**: Use layoutDirective "swot-2x2". Create exactly 4 frames (Strengths, Weaknesses, Opportunities, Threats) as the first 4 operations. Then create notes with parentRef pointing to the appropriate frame. Do not create connectors — the layout handles arrangement.

  - **Kanban board / Retrospective**: Use layoutDirective "columns". Create one frame per column as the first operations. Then create notes inside each frame via parentRef. Do not create connectors.

  - **User journey / Process flow with stages**: Use layoutDirective "journey-stages". Create one frame per stage as the first operations. Create detail notes inside each frame via parentRef. Do NOT create connectors between stages — the layout engine auto-connects consecutive frames.

  - **Flowchart**: Use layoutDirective "flowchart-top-down" or "flowchart-left-right". Create a shape (geo rectangle by default) for each step. Then create connectors between steps using fromRef and toRef. Order: all shapes first, then all connectors.

  - **Simple object creation**: For a single sticky note or a handful of unrelated objects, use batchOperations with no layoutDirective (or "freeform"). One operation per object. No parentRef needed.

- **Parallel tool calls**: Same guidance as today — call all tools in a single response using parallel tool calls when possible. For example, a batchOperations to create new structures AND an updateElements to edit existing shapes can be called in parallel.

- **Board state reference**: Same as today — the agent reads shape IDs from the CURRENT BOARD STATE. For updateElements and layoutElements, match exact IDs. For batchOperations, do NOT reference board state IDs as refs — refs are for newly-created objects only.

- **Color guidance**: Same as today — use varied colors for visual distinction.

**R14.** The SYSTEM_PROMPT must still include the `{boardState}` template variable placeholder that gets injected with the serialized board state at runtime (same mechanism as today via ChatPromptTemplate).

---

### Frontend Resolver (frontend/src/utils/aiResolver.ts)

**R15.** Remove the `resolveCreateElements` function and its associated types/interfaces.

**R16.** Remove the `resolveCreateDiagram` function. Do NOT remove the layout algorithm functions it calls: `layoutSwot`, `layoutColumns`, `layoutUserJourney`, `createFrameWithNotes`, `calcFrameHeight`. These are reused by the new resolver.

**R17.** Add a `resolveBatchOperations` function that accepts the tldraw Editor instance and a BatchOperationsToolCall object. This is the main entry point for processing batch tool calls.

**R18.** The resolveBatchOperations function must maintain an internal ref-to-real-ID map (a plain object or Map) that is populated as operations are processed sequentially.

**R19.** Ref-ID safety: Before processing each operation, the resolver must validate:
- The ref is a non-empty string (if not, skip the operation and log a console warning).
- The ref does not already exist in the ref-to-real-ID map (if duplicate, skip the operation and log a console warning: "Duplicate ref '[ref]' — skipping operation").
- For parentRef: if specified, it must exist in the ref-to-real-ID map. If not found, treat the object as top-level (parentId = page ID) and log a warning.
- For fromRef/toRef on connectors: both must exist in the map. If either is missing, skip the connector entirely and log a warning.

**R20.** Layout directive dispatch: When resolveBatchOperations is called, check the layoutDirective field:

- If `"swot-2x2"`: Extract frames and their child notes from the operations array. Build a sections array where each frame becomes a section (sectionTitle = frame name, items = texts of child notes grouped by parentRef). Construct a call object matching the shape that `layoutSwot` expects (the same structure as the old CreateDiagramCall: diagramType, title, sections). Call `layoutSwot` with the editor and this constructed call object. Skip the sequential processing for objects covered by the template — but still process any connector operations sequentially after the template layout.

- If `"columns"`: Same extraction pattern. Call `layoutColumns`.

- If `"journey-stages"`: Same extraction pattern. Call `layoutUserJourney`. Reminder: this layout auto-creates connectors between consecutive frames, so any explicit connector operations that duplicate these connections should still be processed (they will create additional arrows — the system prompt recipe tells the LLM not to create them, but the resolver should not crash if it does).

- If any generic directive (`"grid"`, `"rows"`, `"flowchart-top-down"`, `"flowchart-left-right"`, `"freeform"`) or if layoutDirective is absent: Process all operations sequentially using the generic layout engine (described in R21-R24).

**R21.** Generic layout engine — sequential processing: For each operation in the array, in order:
- Generate a real tldraw shape ID using `createShapeId()`.
- Record the mapping: ref -> real ID in the ref map.
- Determine parentId: if parentRef is specified and found in map, use the mapped real ID. Otherwise, use the page ID.
- Create the shape on the editor using the appropriate tldraw shape type:
  - createFrame → type "frame", props: w (default 300), h (default 300), name
  - createNote → type "note", props: text, color (default "yellow"), size "m"
  - createShape → type "geo", props: geo (default "rectangle"), w 200, h 200, color, fill "solid", text
  - createText → type "text", props: text, color
  - createConnector → type "arrow"; after creation, create two bindings (start terminal bound to fromRef's real ID, end terminal bound to toRef's real ID) using the same binding creation pattern used in `layoutUserJourney` for stage connectors
- For child objects (those with a resolved parentRef), use local coordinates relative to the parent frame. Place children vertically within the frame: x = 30 (NOTE_PADDING), y = FRAME_HEADER + NOTE_PADDING + (childIndex * (NOTE_H + NOTE_GAP)), where childIndex is the zero-based index of this child among all children of the same parent processed so far.

**R22.** Generic layout — post-creation arrangement: After all operations are processed, arrange the top-level objects (those without a parentRef, excluding connectors) according to the layoutDirective:
- `"grid"`: Arrange in a square grid. Columns = ceiling of square root of count. Spacing between cells = FRAME_GAP. Determine cell size from the largest object's bounds.
- `"rows"` or `"freeform"` or absent: Arrange in a horizontal row with FRAME_GAP spacing (same pattern as the current resolveCreateElements horizontal placement).
- `"flowchart-top-down"`: Use connector relationships (fromRef/toRef) to determine tier assignment. Objects with no incoming connectors are tier 0 (top). Objects whose sources are all in previous tiers go in the next tier. Within a tier, space objects horizontally with FRAME_GAP. Between tiers, space vertically with FRAME_GAP * 1.5. Center each tier horizontally relative to the widest tier.
- `"flowchart-left-right"`: Same tier logic as flowchart-top-down but swap horizontal and vertical axes.

**R23.** Post-batch frame fitting: After arrangement, call `fitFramesToChildren` on every frame that was created in this batch (collect frame IDs during processing). This is the same post-batch pass that exists today.

**R24.** Object placement: Use the existing `findStartPosition` function to determine the starting position for the batch. Place the entire arranged group starting at that position. (Note: viewport-aware placement will be added in a future spec — for now, use the existing positioning logic.)

**R25.** Wrap all shape creation and arrangement operations inside a single `editor.batch(() => { ... })` call for atomic rendering.

**R26.** Update the main `resolveToolCalls` dispatch function to handle `"batchOperations"` tool calls by calling `resolveBatchOperations`. Remove the cases for `"createElements"` and `"createDiagram"`.

---

### Tests

**R27.** In `ai-service/src/__tests__/agent-tools.test.ts`:
- Remove all tests for createElements and createDiagram tools.
- Add tests for the batchOperations tool verifying:
  - `buildTools()` returns exactly 3 tools.
  - Tool names are: batchOperations, updateElements, layoutElements.
  - batchOperations rejects an empty operations array.
  - batchOperations accepts 1-50 operations.
  - batchOperations rejects more than 50 operations.
  - Each operation type is accepted with valid fields.
  - Ref field rejects empty strings.
  - Ref field rejects strings shorter than 2 characters.
  - Color aliases are preprocessed (e.g., "purple" becomes "violet").
  - createConnector requires fromRef and toRef.
  - layoutDirective accepts all valid enum values.
  - layoutDirective rejects invalid values.
  - The tool func returns JSON with `tool: "batchOperations"` and `_observation`.

**R28.** In `frontend/src/tests/aiResolver.test.ts`:
- Remove all tests for resolveCreateElements and resolveCreateDiagram.
- Add tests for resolveBatchOperations verifying:
  - **Single object**: A batch with one createNote operation creates exactly one note shape on the editor.
  - **Multiple unrelated objects**: A batch with 3 createNote operations (no parentRef) creates 3 notes arranged in a row.
  - **Parent-child binding**: A batch with a createFrame followed by a createNote with parentRef pointing to the frame results in the note being a child of the frame (verify via editor.getSortedChildIdsForParent).
  - **Connector binding**: A batch with two createShape operations followed by a createConnector with fromRef/toRef creates an arrow with bindings to both shapes.
  - **Duplicate ref handling**: A batch with two operations sharing the same ref creates only the first object. The second is skipped.
  - **Missing parentRef**: A batch where a createNote references a parentRef that doesn't exist in the batch results in the note being created as a top-level object (parentId = page).
  - **Missing connector ref**: A batch with a createConnector where fromRef doesn't exist skips the connector without crashing.
  - **SWOT template**: A batch with layoutDirective "swot-2x2", 4 createFrame operations (Strengths, Weaknesses, Opportunities, Threats), and child notes produces the same layout structure as the old createDiagram SWOT — 4 frames in a 2x2 arrangement, each containing the correct child notes. Verify frame count, child counts per frame, and that frames are arranged in a grid (the top two frames have similar Y values, the bottom two have similar Y values, left frames have similar X values, right frames have similar X values).
  - **Columns template**: A batch with layoutDirective "columns" and multiple frames with children produces frames arranged horizontally (ascending X values, similar Y values).
  - **Journey template**: A batch with layoutDirective "journey-stages" and multiple frames produces frames arranged horizontally with arrow connectors between consecutive frames.
  - **Grid layout**: A batch with 4 top-level shapes and layoutDirective "grid" produces a 2x2 arrangement.
  - **Flowchart layout**: A batch with shapes and connectors and layoutDirective "flowchart-top-down" places root nodes (no incoming connectors) above nodes that depend on them.
  - **Empty color defaults**: Operations without a color field use sensible defaults (yellow for notes, black for shapes).
  - **Frame fitting**: After batch processing, frames that contain children are sized to fit their content (same behavior as existing fitFramesToChildren).

---

## CONSTRAINTS

**C1.** Do NOT modify `updateElements` or `layoutElements` — their tool definitions, schemas, and resolver functions must remain exactly as they are.

**C2.** Do NOT modify `backend/src/index.ts` — the backend proxy passes tool calls through without inspecting them. The schema change is transparent to the proxy.

**C3.** Do NOT modify `shared/src/shapes.ts` — shape definitions are unchanged.

**C4.** Do NOT add viewport/camera awareness — that is a separate spec. Use the existing `findStartPosition` function for placement.

**C5.** Do NOT add chat UI changes — that is a separate spec.

**C6.** Preserve the existing layout algorithm functions (`layoutSwot`, `layoutColumns`, `layoutUserJourney`, `createFrameWithNotes`, `calcFrameHeight`, `fitFramesToChildren`) and their internal logic. The new resolver must call these functions — not reimplement their layout math.

**C7.** The operations array maximum (50) must be a named constant that can be changed in one place.

**C8.** All console warnings for skipped operations (duplicate refs, missing refs) must include the specific ref string that caused the issue, for debuggability.

**C9.** Do NOT import shared schemas via relative paths (e.g., `../../shared/src/`). Always import via the workspace dependency `@collabboard/shared`.

**C10.** Build the shared package (`npm run build:shared`) after modifying shared schemas, before testing AI service or frontend changes.

---

## DEPENDENCY ORDER

This must be implemented in exactly this sequence:

**Phase 1: Shared schemas** — Modify `shared/src/api.ts`. Build shared package (`npm run build:shared`). This must complete first because both the AI service and frontend import from `@collabboard/shared`.

**Phase 2: AI service** — Modify `ai-service/src/agent.ts` (tool definitions + system prompt). Update `ai-service/src/__tests__/agent-tools.test.ts`. Run AI service tests to verify schema validation.

**Phase 3: Frontend resolver** — Modify `frontend/src/utils/aiResolver.ts` (resolver functions). Update `frontend/src/tests/aiResolver.test.ts`. Run frontend tests to verify resolver behavior.

**Phase 4: Verification** — Run full test suite across all packages to confirm nothing is broken. Verify that updateElements and layoutElements tests still pass unchanged.

---

## ACCEPTANCE CRITERIA

- [ ] `buildTools()` in agent.ts returns exactly 3 tools: batchOperations, updateElements, layoutElements.
- [ ] The batchOperations Zod schema rejects: empty operations array, operations array exceeding max limit, empty ref strings, refs shorter than 2 characters, invalid layoutDirective values, missing fromRef/toRef on createConnector operations.
- [ ] The batchOperations Zod schema accepts: all 5 operation types with valid fields, all 8 layout directive values, optional fields omitted, color aliases preprocessed.
- [ ] The frontend resolver creates the correct number of tldraw shapes for a batch (one shape per valid operation, minus skipped duplicates/invalid refs).
- [ ] Parent-child relationships are established correctly: a createNote with parentRef pointing to a createFrame's ref results in the note being a child of that frame in the tldraw Editor.
- [ ] Connector bindings are established correctly: a createConnector with fromRef/toRef creates an arrow bound to both endpoint shapes.
- [ ] Duplicate refs are handled gracefully: second operation with same ref is skipped, first operation's shape is preserved, console warning is logged.
- [ ] Missing parentRef is handled gracefully: object is created as top-level, console warning is logged.
- [ ] Missing connector refs are handled gracefully: connector is skipped, console warning is logged.
- [ ] SWOT layout directive produces the same visual arrangement as the old createDiagram SWOT (4 frames in 2x2 grid with correctly-parented children).
- [ ] Columns layout directive produces horizontal frame arrangement (same as old createDiagram kanban/retrospective).
- [ ] Journey-stages layout directive produces horizontal frames with auto-connectors (same as old createDiagram user_journey).
- [ ] Grid layout directive arranges top-level objects in a square grid.
- [ ] Flowchart-top-down layout directive places root nodes above dependent nodes.
- [ ] All existing updateElements and layoutElements tests pass without modification.
- [ ] `npm run build:shared` completes without errors.
- [ ] AI service tests (`npm run test` in ai-service) pass.
- [ ] Frontend tests (`npm run test:frontend`) pass.

---

## OUT OF SCOPE

- Viewport-aware placement (P0-A) — objects use existing findStartPosition logic.
- Viewport-scoped context / global index (P0-C) — board state serialization is unchanged.
- Find/navigate tool (P0-D) — no new tools beyond batchOperations.
- Chat UI fixes (BUG-003, P1) — no UI changes.
- Backend proxy changes — none needed.
- New diagram template types beyond the existing 3 known directives — generic directives handle all other cases.
