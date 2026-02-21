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
// Each entry is one planned operation.  The agent assigns ref IDs (e.g.
// "ref:frame_1") so later steps can reference earlier ones.  The frontend
// resolves refs to real tldraw shape IDs when applying the calls to the canvas.

// tldraw colour palette shared between agent tool schemas and frontend
export const TLToolColorSchema = z.enum([
  'yellow', 'green', 'blue', 'orange', 'red', 'violet',
  'light-blue', 'light-green', 'light-red', 'light-violet',
  'grey', 'white',
]);

export const CreateFrameToolCallSchema = z.object({
  tool: z.literal('createFrame'),
  ref: z.string(),                   // e.g. "ref:frame_1"
  label: z.string(),
  position: z.enum(['auto', 'left', 'center', 'right', 'far-right']).default('auto'),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
});

export const CreateLayoutToolCallSchema = z.object({
  tool: z.literal('createLayout'),
  ref: z.string(),                   // e.g. "ref:layout_1"
  layoutType: z.enum(['grid', 'columns', 'mindmap', 'timeline', 'list']),
  items: z.array(z.object({
    text: z.string(),
    color: TLToolColorSchema.nullable().optional(),
  })),
  frameLabel: z.string().nullable().optional(),
  frameRef: z.string().nullable().optional(),   // ref of auto-created or targeted frame
  targetFrameRef: z.string().nullable().optional(), // ref to nest inside an existing frame
});

export const CreateConnectorToolCallSchema = z.object({
  tool: z.literal('createConnector'),
  ref: z.string(),
  fromRef: z.string(),               // shape ID or ref ID
  toRef: z.string(),
  label: z.string().nullable().optional(),
});

export const MoveObjectToolCallSchema = z.object({
  tool: z.literal('moveObject'),
  shapeId: z.string(),
  direction: z.enum(['left', 'right', 'up', 'down']),
  distance: z.enum(['small', 'medium', 'large']).default('medium'),
});

export const CreateShapeToolCallSchema = z.object({
  tool: z.literal('createShape'),
  ref: z.string(),
  geoType: z.enum([
    'rectangle', 'ellipse', 'diamond', 'triangle', 'star',
    'cloud', 'hexagon', 'pentagon', 'octagon', 'arrow-right',
    'arrow-left', 'arrow-up', 'arrow-down', 'x-box', 'check-box',
  ]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: TLToolColorSchema,
  text: z.string().nullable().optional(),
});

export const ResizeObjectToolCallSchema = z.object({
  tool: z.literal('resizeObject'),
  shapeId: z.string(),
  width: z.number(),
  height: z.number(),
});

export const UpdateTextToolCallSchema = z.object({
  tool: z.literal('updateText'),
  shapeId: z.string(),
  newText: z.string(),
});

export const ChangeColorToolCallSchema = z.object({
  tool: z.literal('changeColor'),
  shapeId: z.string(),
  color: TLToolColorSchema,
});

export const ToolCallSchema = z.discriminatedUnion('tool', [
  CreateFrameToolCallSchema,
  CreateLayoutToolCallSchema,
  CreateConnectorToolCallSchema,
  MoveObjectToolCallSchema,
  CreateShapeToolCallSchema,
  ResizeObjectToolCallSchema,
  UpdateTextToolCallSchema,
  ChangeColorToolCallSchema,
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type CreateFrameToolCall = z.infer<typeof CreateFrameToolCallSchema>;
export type CreateLayoutToolCall = z.infer<typeof CreateLayoutToolCallSchema>;
export type CreateConnectorToolCall = z.infer<typeof CreateConnectorToolCallSchema>;
export type MoveObjectToolCall = z.infer<typeof MoveObjectToolCallSchema>;
export type CreateShapeToolCall = z.infer<typeof CreateShapeToolCallSchema>;
export type ResizeObjectToolCall = z.infer<typeof ResizeObjectToolCallSchema>;
export type UpdateTextToolCall = z.infer<typeof UpdateTextToolCallSchema>;
export type ChangeColorToolCall = z.infer<typeof ChangeColorToolCallSchema>;

// ── Hono AI Service → CF Worker ───────────────────────────────────────────────
export const AIServiceResponseSchema = z.object({
  toolCalls: z.array(ToolCallSchema),
  modelUsed: z.string().optional(),   // e.g. "google/gemini-2.0-flash-exp:free"
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
