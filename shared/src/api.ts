import { z } from 'zod';
import { ShapeSchema } from './shapes.js';

/**
 * Zod schemas for API requests and responses.
 *
 * Service boundary contracts:
 *   Browser → CF Worker:          AIGenerateRequestSchema
 *   CF Worker → Hono AI Service:  AIServiceRequestSchema  (same payload + internal auth header)
 *   Hono AI Service → CF Worker:  AIServiceResponseSchema (array of tool executions)
 *   CF Worker → Browser:          AIGenerateResponseSchema
 */

// ── Browser → CF Worker ───────────────────────────────────────────────────────
export const AIGenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  boardId: z.string(),
  boardState: z.array(z.record(z.unknown())).optional(), // loose — just context for the AI
});

export type AIGenerateRequest = z.infer<typeof AIGenerateRequestSchema>;

// ── CF Worker → Hono AI Service ───────────────────────────────────────────────
// Identical payload; the Worker adds X-Internal-Secret as a header (not in body).
export const AIServiceRequestSchema = AIGenerateRequestSchema;
export type AIServiceRequest = AIGenerateRequest;

// ── Tool execution records returned by the agent ──────────────────────────────
//
// Compound Tool Strategy: the LLM outputs high-level declarative intent.
// The frontend handles all canvas math, frame creation, and element placement.
// No x/y coordinates — the LLM only provides content structure and semantic instructions.

// tldraw colour palette shared between agent tool schemas and frontend
export const TLToolColorSchema = z.enum([
  'yellow', 'green', 'blue', 'orange', 'red', 'violet',
  'light-blue', 'light-green', 'light-red', 'light-violet',
  'grey', 'white',
]);

// ── 1. Ad-hoc element creation (no coordinates) ─────────────────────────────

export const CreateElementSchema = z.object({
  type: z.enum(['sticky', 'shape', 'text', 'connector', 'frame']),
  color: TLToolColorSchema.optional(),
  text: z.string().optional(),
});

export const CreateElementsToolCallSchema = z.object({
  tool: z.literal('createElements'),
  elements: z.array(CreateElementSchema),
});

// ── 2. Batch edit tool (semantic instructions) ──────────────────────────────

export const ElementUpdateSchema = z.object({
  shapeId: z.string(),
  newText: z.string().optional(),
  newColor: TLToolColorSchema.optional(),
  resizeInstruction: z.enum(['double', 'half', 'fit-to-content']).optional(),
  moveInstruction: z.enum(['left', 'right', 'up', 'down', 'closer-together']).optional(),
});

export const UpdateElementsToolCallSchema = z.object({
  tool: z.literal('updateElements'),
  updates: z.array(ElementUpdateSchema),
});

// ── 3. Layout existing shapes ───────────────────────────────────────────────

export const LayoutElementsToolCallSchema = z.object({
  tool: z.literal('layoutElements'),
  shapeIds: z.array(z.string()),
  layoutType: z.enum(['grid', 'horizontal-row', 'vertical-column', 'even-spacing']),
});

// ── 4. Compound diagram creation (frames + templates) ───────────────────────

export const CreateDiagramToolCallSchema = z.object({
  tool: z.literal('createDiagram'),
  diagramType: z.enum(['swot', 'kanban', 'user_journey', 'retrospective', 'custom_frame']),
  title: z.string(),
  sections: z.array(z.object({
    sectionTitle: z.string(),
    items: z.array(z.string()),
  })),
});

// ── Discriminated union ─────────────────────────────────────────────────────

export const ToolCallSchema = z.discriminatedUnion('tool', [
  CreateElementsToolCallSchema,
  UpdateElementsToolCallSchema,
  LayoutElementsToolCallSchema,
  CreateDiagramToolCallSchema,
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type CreateElement = z.infer<typeof CreateElementSchema>;
export type CreateElementsToolCall = z.infer<typeof CreateElementsToolCallSchema>;
export type ElementUpdate = z.infer<typeof ElementUpdateSchema>;
export type UpdateElementsToolCall = z.infer<typeof UpdateElementsToolCallSchema>;
export type LayoutElementsToolCall = z.infer<typeof LayoutElementsToolCallSchema>;
export type CreateDiagramToolCall = z.infer<typeof CreateDiagramToolCallSchema>;

// ── Hono AI Service → CF Worker ───────────────────────────────────────────────
export const AIServiceResponseSchema = z.object({
  toolCalls: z.array(ToolCallSchema),
  modelUsed: z.string().optional(),   // e.g. "openai/gpt-4o-mini"
});

export type AIServiceResponse = z.infer<typeof AIServiceResponseSchema>;

// ── CF Worker → Browser ───────────────────────────────────────────────────────
export const AIGenerateResponseSchema = AIServiceResponseSchema;
export type AIGenerateResponse = AIServiceResponse;

// A tldraw record as transmitted over WebSocket.
// Uses passthrough() to allow arbitrary shape-specific fields beyond id and typeName.
export const TLRecordSchema = z.object({
  id: z.string(),
  typeName: z.string(),
}).passthrough();

export type TLRecordPayload = z.infer<typeof TLRecordSchema>;

// The tldraw diff payload sent in 'update' messages.
// Note: 'updated' contains only the new value (not the [before, after] tuple tldraw uses
// internally) because the frontend extracts update[1] before sending over the wire.
export const TLChangesSchema = z.object({
  added: z.record(z.string(), TLRecordSchema).default({}),
  updated: z.record(z.string(), TLRecordSchema).default({}),
  removed: z.record(z.string(), TLRecordSchema).default({}),
});

export type TLChanges = z.infer<typeof TLChangesSchema>;

// Client → Server WebSocket messages
export const ClientWSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connect'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
    token: z.string(),
  }),
  z.object({
    type: z.literal('disconnect'),
    userId: z.string(),
  }),
  z.object({
    type: z.literal('cursor'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('update'),
    userId: z.string(),
    changes: TLChangesSchema,
  }),
]);

export type ClientWSMessage = z.infer<typeof ClientWSMessageSchema>;

// Server → Client WebSocket messages
export const ServerWSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    records: z.array(TLRecordSchema),
    users: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
    })),
  }),
  z.object({
    type: z.literal('update'),
    userId: z.string(),
    changes: TLChangesSchema,
  }),
  z.object({
    type: z.literal('cursor'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    type: z.literal('user-joined'),
    userId: z.string(),
    userName: z.string(),
    userColor: z.string(),
  }),
  z.object({
    type: z.literal('user-left'),
    userId: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    error: z.string(),
    shouldRetry: z.boolean().optional(),
  }),
]);

export type ServerWSMessage = z.infer<typeof ServerWSMessageSchema>;

// Board state
export const BoardStateSchema = z.object({
  id: z.string(),
  shapes: z.array(ShapeSchema),
  users: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  })),
});

export type BoardState = z.infer<typeof BoardStateSchema>;
