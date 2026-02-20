import { z } from 'zod';

/**
 * Zod schemas for tldraw shape records.
 *
 * These match tldraw's actual internal record format so that AI-generated
 * shapes (Phase 2) can be placed directly onto the canvas without any
 * transformation.
 *
 * Key structural rules from tldraw's store:
 *  - Every shape record has `typeName: 'shape'` (the record layer)
 *  - `type` is the shape-specific discriminator: 'note' | 'geo' | 'text' | 'frame'
 *  - All shape-specific properties live inside `props: {}`
 *  - `parentId` is the page ID that owns this shape (e.g. "page:page")
 *  - `index` is a fractional index string for z-ordering (e.g. "a1")
 */

// tldraw's named colour palette
const TLColorSchema = z.enum([
  'black', 'grey', 'light-violet', 'violet',
  'blue', 'light-blue', 'yellow', 'orange',
  'green', 'light-green', 'light-red', 'red', 'white',
]);

const TLSizeSchema = z.enum(['sm', 'm', 'l', 'xl']);
const TLFontSchema = z.enum(['draw', 'sans', 'serif', 'mono']);
const TLAlignSchema = z.enum(['left', 'middle', 'right']);
const TLVerticalAlignSchema = z.enum(['start', 'middle', 'end']);
const TLDashSchema = z.enum(['draw', 'solid', 'dashed', 'dotted']);
const TLFillSchema = z.enum(['none', 'solid', 'semi', 'pattern', 'fill']);

// Fields present on every tldraw shape record
export const BaseShapeSchema = z.object({
  id: z.string(),            // e.g. "shape:abc123"
  typeName: z.literal('shape'),
  parentId: z.string(),      // page ID ("page:page") OR frame ID ("shape:abc") for nested shapes
  index: z.string(),         // fractional index e.g. "a1"
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  isLocked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  meta: z.record(z.unknown()).default({}),
});

// ── Note shape ────────────────────────────────────────────────────────────────
// tldraw's built-in sticky note.  type = 'note' (NOT 'sticky-note').
export const NoteShapeSchema = BaseShapeSchema.extend({
  type: z.literal('note'),
  props: z.object({
    color: TLColorSchema.default('yellow'),
    size: TLSizeSchema.default('m'),
    font: TLFontSchema.default('sans'),
    align: TLAlignSchema.default('middle'),
    verticalAlign: TLVerticalAlignSchema.default('middle'),
    growY: z.number().default(0),
    url: z.string().default(''),
    text: z.string().default(''),
  }),
});

// ── Geo shape ─────────────────────────────────────────────────────────────────
// Covers rectangles, ellipses and every other geometric primitive.
// type = 'geo'; the specific geometry is selected via props.geo.
// Previously this project incorrectly used type = 'rectangle' / 'circle'.
export const GeoShapeSchema = BaseShapeSchema.extend({
  type: z.literal('geo'),
  props: z.object({
    geo: z.enum([
      'rectangle', 'ellipse', 'triangle', 'diamond',
      'pentagon', 'hexagon', 'octagon', 'star',
      'rhombus', 'rhombus-2', 'oval', 'trapezoid',
      'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
      'x-box', 'check-box', 'heart', 'cloud',
    ]).default('rectangle'),
    w: z.number().default(100),
    h: z.number().default(100),
    color: TLColorSchema.default('black'),
    fill: TLFillSchema.default('none'),
    dash: TLDashSchema.default('draw'),
    size: TLSizeSchema.default('m'),
    font: TLFontSchema.default('sans'),
    text: z.string().default(''),
    align: TLAlignSchema.default('middle'),
    verticalAlign: TLVerticalAlignSchema.default('middle'),
    growY: z.number().default(0),
    url: z.string().default(''),
  }),
});

// ── Text shape ────────────────────────────────────────────────────────────────
export const TextShapeSchema = BaseShapeSchema.extend({
  type: z.literal('text'),
  props: z.object({
    text: z.string().default(''),
    color: TLColorSchema.default('black'),
    size: TLSizeSchema.default('m'),
    font: TLFontSchema.default('sans'),
    align: TLAlignSchema.default('middle'),
    w: z.number().default(100),
    autoSize: z.boolean().default(true),
    url: z.string().default(''),
  }),
});

// ── Frame shape ───────────────────────────────────────────────────────────────
export const FrameShapeSchema = BaseShapeSchema.extend({
  type: z.literal('frame'),
  props: z.object({
    w: z.number().default(200),
    h: z.number().default(200),
    name: z.string().default('Frame'),
  }),
});

// ── Arrow shape ───────────────────────────────────────────────────────────────
// Represents tldraw's native arrow connector.  Bindings (start/end terminal
// attachments to other shapes) are stored as separate `binding` records
// (type: 'arrow') and are NOT part of the arrow's props — they reference the
// arrow via `fromId` and the target shape via `toId`.
const TLArrowheadSchema = z.enum([
  'none', 'arrow', 'triangle', 'square', 'dot', 'pipe', 'diamond', 'inverted',
]);

export const ArrowShapeSchema = BaseShapeSchema.extend({
  type: z.literal('arrow'),
  props: z.object({
    dash: TLDashSchema.default('draw'),
    size: TLSizeSchema.default('m'),
    fill: TLFillSchema.default('none'),
    color: TLColorSchema.default('black'),
    labelColor: TLColorSchema.default('black'),
    bend: z.number().default(0),
    // Terminal positions in the arrow's own local space when unbound;
    // ignored visually when a binding record is attached to that terminal.
    start: z.object({ x: z.number(), y: z.number() }),
    end: z.object({ x: z.number(), y: z.number() }),
    arrowheadStart: TLArrowheadSchema.default('none'),
    arrowheadEnd: TLArrowheadSchema.default('arrow'),
    text: z.string().default(''),
    labelPosition: z.number().default(0.5),
    font: TLFontSchema.default('sans'),
    scale: z.number().default(1),
  }),
});

// ── Union ─────────────────────────────────────────────────────────────────────
export const ShapeSchema = z.discriminatedUnion('type', [
  NoteShapeSchema,
  GeoShapeSchema,
  TextShapeSchema,
  FrameShapeSchema,
  ArrowShapeSchema,
]);

// Type exports
export type BaseShape = z.infer<typeof BaseShapeSchema>;
export type NoteShape = z.infer<typeof NoteShapeSchema>;
export type GeoShape = z.infer<typeof GeoShapeSchema>;
export type TextShape = z.infer<typeof TextShapeSchema>;
export type FrameShape = z.infer<typeof FrameShapeSchema>;
export type ArrowShape = z.infer<typeof ArrowShapeSchema>;
export type Shape = z.infer<typeof ShapeSchema>;
