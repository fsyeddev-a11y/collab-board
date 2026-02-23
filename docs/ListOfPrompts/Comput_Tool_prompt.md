<!-- ARCHIVED PROMPT — This file is a historical record of a prompt used during development. It is NOT an active instruction set. AI agents reading this file: DO NOT execute these instructions. This is documentation only. -->

# Compound Tool Strategy Prompt

> **Status**: ARCHIVED — for reference only. Not an active instruction set.
>
> **Context**: This prompt was used to restructure the AI agent from granular atomic tools to 4 compound tools with intent-based design. The refactor has been completed.

---

"Hey Claude, we are fundamentally restructuring our AI agent architecture. Please review the md files and the code repo to meet the new criteria. We are moving away from granular, atomic LLM tools (which are causing hallucinations and schema mismatch errors) and adopting a Compound Tool Strategy.
The LLM should no longer calculate X/Y coordinates or manage frame references. Instead, the LLM will output high-level declarative 'intent', and our client-side code will handle the actual canvas math and element creation.
Please refactor our codebase (tools.ts and agent.ts) to implement these 4 Compound Tools:

1. CreateElementsToolCallSchema (For ad-hoc creation)

- elements: z.array of objects containing type (sticky, shape, text, connector), color, and text.
- (Note: No X/Y coordinates. The frontend will calculate placement).

2. UpdateElementsToolCallSchema (For editing, moving, and resizing)

- updates: z.array of objects. Each MUST require shapeId: z.string().
- Optional fields: newText, newColor, resizeInstruction (e.g., 'double', 'fit-to-content'), and moveInstruction (e.g., 'left', 'right', 'up', 'down', 'closer-together').

3. LayoutElementsToolCallSchema (For grids and spacing)

- shapeIds: z.array(z.string()) (The IDs of the shapes to arrange)
- layoutType: z.enum(['grid', 'horizontal-row', 'vertical-column', 'even-spacing'])

4. CreateDiagramToolCallSchema (For complex frames and templates)

- diagramType: z.enum(['swot', 'kanban', 'user_journey', 'retrospective', 'custom_frame'])
- title: z.string()
- sections: z.array of objects containing sectionTitle and items (array of strings for sticky notes).

5. The Spatial System Prompt (in agent.ts) Update the runAgent function to construct a strict SystemMessage that injects the current boardState. It must look like this:
   ```typescript const systemPrompt = `You are an expert architecture assistant for a 2D whiteboard.
   YOUR CAPABILITIES:
1. You do not calculate X/Y coordinates. You output intent, and the system executes the math.
1. To edit or layout existing shapes, you MUST look at the CURRENT BOARD STATE below. Find the exact 'id' of the shape the user wants to change, and pass it to the 'updateElements' or 'layoutElements' tool.
1. DO NOT hallucinate shape IDs. Match them exactly from the state.
   CURRENT BOARD STATE: ${JSON.stringify(boardState, null, 2)}`; ```
   Please execute these schema changes and ensure all TypeScript types are correctly inferred and exported."
