/**
 * Zod schema validation tests for the AI tool call contracts.
 *
 * These tests ensure that:
 *  - Valid tool call payloads parse correctly through the discriminated union
 *  - Invalid/missing fields are rejected
 *  - Edge cases (empty arrays, optional fields) behave correctly
 */

import { describe, it, expect } from 'vitest';
import {
  ToolCallSchema,
  CreateDiagramToolCallSchema,
  CreateElementsToolCallSchema,
  UpdateElementsToolCallSchema,
  LayoutElementsToolCallSchema,
  ElementUpdateSchema,
  TLToolColorSchema,
} from '../api.js';

// ── CreateDiagramToolCallSchema ──────────────────────────────────────────────

describe('CreateDiagramToolCallSchema', () => {
  const validSwot = {
    tool: 'createDiagram' as const,
    diagramType: 'swot' as const,
    title: 'Product SWOT',
    sections: [
      { sectionTitle: 'Strengths', items: ['Fast', 'Cheap'] },
      { sectionTitle: 'Weaknesses', items: ['Small team'] },
      { sectionTitle: 'Opportunities', items: ['New market'] },
      { sectionTitle: 'Threats', items: ['Competitors'] },
    ],
  };

  it('parses a valid SWOT diagram', () => {
    const result = CreateDiagramToolCallSchema.safeParse(validSwot);
    expect(result.success).toBe(true);
  });

  it('parses all diagram types', () => {
    for (const dt of ['swot', 'kanban', 'user_journey', 'retrospective', 'custom_frame'] as const) {
      const result = CreateDiagramToolCallSchema.safeParse({ ...validSwot, diagramType: dt });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid diagramType', () => {
    const result = CreateDiagramToolCallSchema.safeParse({ ...validSwot, diagramType: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing title', () => {
    const { title: _, ...noTitle } = validSwot;
    const result = CreateDiagramToolCallSchema.safeParse(noTitle);
    expect(result.success).toBe(false);
  });

  it('rejects missing sections', () => {
    const { sections: _, ...noSections } = validSwot;
    const result = CreateDiagramToolCallSchema.safeParse(noSections);
    expect(result.success).toBe(false);
  });

  it('allows empty sections array (min constraint is only in agent tool schema)', () => {
    const result = CreateDiagramToolCallSchema.safeParse({ ...validSwot, sections: [] });
    expect(result.success).toBe(true);
  });

  it('allows sections with empty items array', () => {
    const result = CreateDiagramToolCallSchema.safeParse({
      ...validSwot,
      sections: [{ sectionTitle: 'Empty', items: [] }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects sections missing sectionTitle', () => {
    const result = CreateDiagramToolCallSchema.safeParse({
      ...validSwot,
      sections: [{ items: ['a'] }],
    });
    expect(result.success).toBe(false);
  });
});

// ── CreateElementsToolCallSchema ─────────────────────────────────────────────

describe('CreateElementsToolCallSchema', () => {
  it('parses valid elements', () => {
    const result = CreateElementsToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [
        { type: 'sticky', color: 'yellow', text: 'Hello' },
        { type: 'shape', text: 'Box' },
        { type: 'text', text: 'Label' },
        { type: 'connector' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('allows elements without optional color/text', () => {
    const result = CreateElementsToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [{ type: 'sticky' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid element type', () => {
    const result = CreateElementsToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [{ type: 'invalid' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows empty elements array (min constraint is only in agent tool schema)', () => {
    const result = CreateElementsToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid color', () => {
    const result = CreateElementsToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [{ type: 'sticky', color: 'neon-pink' }],
    });
    expect(result.success).toBe(false);
  });
});

// ── UpdateElementsToolCallSchema ─────────────────────────────────────────────

describe('UpdateElementsToolCallSchema', () => {
  it('parses a valid update with all fields', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{
        shapeId: 'shape:abc123',
        newText: 'Updated',
        newColor: 'blue',
        resizeInstruction: 'double',
        moveInstruction: 'left',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('parses update with only shapeId (all optional fields omitted)', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:abc' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing shapeId', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{ newText: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows empty updates array (min constraint is only in agent tool schema)', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid resizeInstruction', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:a', resizeInstruction: 'triple' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid moveInstruction', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:a', moveInstruction: 'diagonal' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid resizeInstruction values', () => {
    for (const ri of ['double', 'half', 'fit-to-content'] as const) {
      const result = UpdateElementsToolCallSchema.safeParse({
        tool: 'updateElements',
        updates: [{ shapeId: 'shape:a', resizeInstruction: ri }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid moveInstruction values', () => {
    for (const mi of ['left', 'right', 'up', 'down', 'closer-together'] as const) {
      const result = UpdateElementsToolCallSchema.safeParse({
        tool: 'updateElements',
        updates: [{ shapeId: 'shape:a', moveInstruction: mi }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('supports multiple updates in one call', () => {
    const result = UpdateElementsToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [
        { shapeId: 'shape:a', newColor: 'red' },
        { shapeId: 'shape:b', newText: 'Hello' },
        { shapeId: 'shape:c', moveInstruction: 'up' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates).toHaveLength(3);
    }
  });
});

// ── LayoutElementsToolCallSchema ─────────────────────────────────────────────

describe('LayoutElementsToolCallSchema', () => {
  it('parses a valid layout call', () => {
    const result = LayoutElementsToolCallSchema.safeParse({
      tool: 'layoutElements',
      shapeIds: ['shape:a', 'shape:b', 'shape:c'],
      layoutType: 'grid',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all layout types', () => {
    for (const lt of ['grid', 'horizontal-row', 'vertical-column', 'even-spacing'] as const) {
      const result = LayoutElementsToolCallSchema.safeParse({
        tool: 'layoutElements',
        shapeIds: ['shape:a', 'shape:b'],
        layoutType: lt,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid layoutType', () => {
    const result = LayoutElementsToolCallSchema.safeParse({
      tool: 'layoutElements',
      shapeIds: ['shape:a', 'shape:b'],
      layoutType: 'circle',
    });
    expect(result.success).toBe(false);
  });

  it('allows fewer than 2 shapeIds (min constraint is only in agent tool schema)', () => {
    const result = LayoutElementsToolCallSchema.safeParse({
      tool: 'layoutElements',
      shapeIds: ['shape:a'],
      layoutType: 'grid',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing shapeIds', () => {
    const result = LayoutElementsToolCallSchema.safeParse({
      tool: 'layoutElements',
      layoutType: 'grid',
    });
    expect(result.success).toBe(false);
  });
});

// ── ToolCallSchema discriminated union ───────────────────────────────────────

describe('ToolCallSchema discriminated union', () => {
  it('routes createDiagram correctly', () => {
    const result = ToolCallSchema.safeParse({
      tool: 'createDiagram',
      diagramType: 'kanban',
      title: 'Board',
      sections: [{ sectionTitle: 'Todo', items: ['Task 1'] }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tool).toBe('createDiagram');
  });

  it('routes createElements correctly', () => {
    const result = ToolCallSchema.safeParse({
      tool: 'createElements',
      elements: [{ type: 'sticky', text: 'Hi' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tool).toBe('createElements');
  });

  it('routes updateElements correctly', () => {
    const result = ToolCallSchema.safeParse({
      tool: 'updateElements',
      updates: [{ shapeId: 'shape:x', newColor: 'red' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tool).toBe('updateElements');
  });

  it('routes layoutElements correctly', () => {
    const result = ToolCallSchema.safeParse({
      tool: 'layoutElements',
      shapeIds: ['shape:a', 'shape:b'],
      layoutType: 'grid',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tool).toBe('layoutElements');
  });

  it('rejects unknown tool type', () => {
    const result = ToolCallSchema.safeParse({
      tool: 'deleteEverything',
      shapeIds: ['shape:a'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when tool field is missing', () => {
    const result = ToolCallSchema.safeParse({
      diagramType: 'swot',
      title: 'Test',
      sections: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── TLToolColorSchema ────────────────────────────────────────────────────────

describe('TLToolColorSchema', () => {
  const validColors = [
    'yellow', 'green', 'blue', 'orange', 'red', 'violet',
    'light-blue', 'light-green', 'light-red', 'light-violet',
    'grey', 'white',
  ];

  it('accepts all 12 valid colors', () => {
    for (const color of validColors) {
      expect(TLToolColorSchema.safeParse(color).success).toBe(true);
    }
  });

  it('rejects invalid colors', () => {
    for (const bad of ['black', 'pink', 'neon', '', 'RED']) {
      expect(TLToolColorSchema.safeParse(bad).success).toBe(false);
    }
  });
});

// ── ElementUpdateSchema ──────────────────────────────────────────────────────

describe('ElementUpdateSchema', () => {
  it('parses with all optional fields present', () => {
    const result = ElementUpdateSchema.safeParse({
      shapeId: 'shape:abc',
      newText: 'Hello',
      newColor: 'blue',
      resizeInstruction: 'double',
      moveInstruction: 'left',
    });
    expect(result.success).toBe(true);
  });

  it('parses with only shapeId', () => {
    const result = ElementUpdateSchema.safeParse({ shapeId: 'shape:abc' });
    expect(result.success).toBe(true);
  });

  it('rejects without shapeId', () => {
    const result = ElementUpdateSchema.safeParse({ newText: 'Hello' });
    expect(result.success).toBe(false);
  });
});
