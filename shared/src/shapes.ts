import { z } from 'zod';

/**
 * Zod schemas for tldraw shapes
 * These schemas ensure type safety between frontend canvas and backend AI agent
 */

// Base shape properties that all tldraw shapes share
export const BaseShapeSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  isLocked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
});

// Sticky Note Shape
export const StickyNoteSchema = BaseShapeSchema.extend({
  type: z.literal('sticky-note'),
  text: z.string(),
  color: z.enum(['yellow', 'blue', 'green', 'pink', 'purple', 'red', 'orange']).default('yellow'),
  width: z.number().default(200),
  height: z.number().default(200),
});

// Rectangle Shape
export const RectangleSchema = BaseShapeSchema.extend({
  type: z.literal('rectangle'),
  width: z.number(),
  height: z.number(),
  fill: z.string().default('#cccccc'),
  stroke: z.string().default('#000000'),
  strokeWidth: z.number().default(2),
});

// Circle Shape
export const CircleSchema = BaseShapeSchema.extend({
  type: z.literal('circle'),
  radius: z.number(),
  fill: z.string().default('#cccccc'),
  stroke: z.string().default('#000000'),
  strokeWidth: z.number().default(2),
});

// Line/Connector Shape
export const LineSchema = BaseShapeSchema.extend({
  type: z.literal('line'),
  points: z.array(z.object({
    x: z.number(),
    y: z.number(),
  })),
  stroke: z.string().default('#000000'),
  strokeWidth: z.number().default(2),
  startArrow: z.boolean().default(false),
  endArrow: z.boolean().default(false),
});

// Text Shape
export const TextSchema = BaseShapeSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  fontSize: z.number().default(16),
  fontFamily: z.enum(['sans', 'serif', 'mono']).default('sans'),
  color: z.string().default('#000000'),
  align: z.enum(['left', 'center', 'right']).default('left'),
});

// Frame Shape (for grouping content)
export const FrameSchema = BaseShapeSchema.extend({
  type: z.literal('frame'),
  width: z.number(),
  height: z.number(),
  name: z.string().default('Frame'),
  backgroundColor: z.string().default('#ffffff'),
});

// Union of all shape types
export const ShapeSchema = z.discriminatedUnion('type', [
  StickyNoteSchema,
  RectangleSchema,
  CircleSchema,
  LineSchema,
  TextSchema,
  FrameSchema,
]);

// Type exports
export type BaseShape = z.infer<typeof BaseShapeSchema>;
export type StickyNote = z.infer<typeof StickyNoteSchema>;
export type Rectangle = z.infer<typeof RectangleSchema>;
export type Circle = z.infer<typeof CircleSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Text = z.infer<typeof TextSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Shape = z.infer<typeof ShapeSchema>;
