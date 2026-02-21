/**
 * Tests for the AI agent tool definitions.
 *
 * Validates that:
 *  - buildTools() returns all 4 expected tools
 *  - Agent tool schemas enforce stricter constraints than shared schemas
 *  - Empty string preprocessing coerces "" to undefined for optional enums
 *  - Tool func() returns valid JSON with correct structure
 */

import { describe, it, expect } from 'vitest';
import { buildTools } from '../agent.js';

const tools = buildTools();

function toolByName(name: string) {
  return tools.find((t) => t.name === name)!;
}

// ── buildTools() overview ──────────────────────────────────────────────────

describe('buildTools()', () => {
  it('returns exactly 4 tools', () => {
    expect(tools).toHaveLength(4);
  });

  it('returns tools with expected names', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['createDiagram', 'createElements', 'layoutElements', 'updateElements']);
  });

  it('every tool has a description', () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });
});

// ── createElements tool schema ──────────────────────────────────────────────

describe('createElements tool schema', () => {
  const tool = toolByName('createElements');

  it('rejects empty elements array (min 1)', () => {
    const result = tool.schema.safeParse({ elements: [] });
    expect(result.success).toBe(false);
  });

  it('accepts 1 element', () => {
    const result = tool.schema.safeParse({
      elements: [{ type: 'sticky', text: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 30 elements (max 30)', () => {
    const elements = Array.from({ length: 31 }, () => ({ type: 'sticky' }));
    const result = tool.schema.safeParse({ elements });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 30 elements', () => {
    const elements = Array.from({ length: 30 }, () => ({ type: 'sticky' }));
    const result = tool.schema.safeParse({ elements });
    expect(result.success).toBe(true);
  });
});

// ── updateElements tool schema ──────────────────────────────────────────────

describe('updateElements tool schema', () => {
  const tool = toolByName('updateElements');

  it('rejects empty updates array (min 1)', () => {
    const result = tool.schema.safeParse({ updates: [] });
    expect(result.success).toBe(false);
  });

  it('accepts valid update with all fields', () => {
    const result = tool.schema.safeParse({
      updates: [{
        shapeId: 'shape:abc',
        newText: 'Updated',
        newColor: 'blue',
        resizeInstruction: 'double',
        moveInstruction: 'left',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('coerces empty string newText to undefined', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', newText: '' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates[0].newText).toBeUndefined();
    }
  });

  it('coerces empty string newColor to undefined', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', newColor: '' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates[0].newColor).toBeUndefined();
    }
  });

  it('coerces empty string resizeInstruction to undefined', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', resizeInstruction: '' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates[0].resizeInstruction).toBeUndefined();
    }
  });

  it('coerces empty string moveInstruction to undefined', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', moveInstruction: '' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updates[0].moveInstruction).toBeUndefined();
    }
  });

  it('rejects invalid resizeInstruction value', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', resizeInstruction: 'triple' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid moveInstruction value', () => {
    const result = tool.schema.safeParse({
      updates: [{ shapeId: 'shape:a', moveInstruction: 'diagonal' }],
    });
    expect(result.success).toBe(false);
  });
});

// ── layoutElements tool schema ──────────────────────────────────────────────

describe('layoutElements tool schema', () => {
  const tool = toolByName('layoutElements');

  it('rejects fewer than 2 shapeIds (min 2)', () => {
    const result = tool.schema.safeParse({
      shapeIds: ['shape:a'],
      layoutType: 'grid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 2 shapeIds', () => {
    const result = tool.schema.safeParse({
      shapeIds: ['shape:a', 'shape:b'],
      layoutType: 'grid',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all layout types', () => {
    for (const lt of ['grid', 'horizontal-row', 'vertical-column', 'even-spacing']) {
      const result = tool.schema.safeParse({
        shapeIds: ['shape:a', 'shape:b'],
        layoutType: lt,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ── createDiagram tool schema ──────────────────────────────────────────────

describe('createDiagram tool schema', () => {
  const tool = toolByName('createDiagram');

  it('rejects empty sections array (min 1)', () => {
    const result = tool.schema.safeParse({
      diagramType: 'swot',
      title: 'Test',
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 sections (max 10)', () => {
    const sections = Array.from({ length: 11 }, (_, i) => ({
      sectionTitle: `Section ${i}`,
      items: ['item'],
    }));
    const result = tool.schema.safeParse({
      diagramType: 'swot',
      title: 'Test',
      sections,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all diagram types', () => {
    for (const dt of ['swot', 'kanban', 'user_journey', 'retrospective', 'custom_frame']) {
      const result = tool.schema.safeParse({
        diagramType: dt,
        title: 'Test',
        sections: [{ sectionTitle: 'S', items: ['a'] }],
      });
      expect(result.success).toBe(true);
    }
  });
});

// ── Tool func() return format ──────────────────────────────────────────────

describe('Tool func() return values', () => {

  it('createElements func returns JSON with tool field and _observation', async () => {
    const tool = toolByName('createElements');
    const raw = await tool.invoke({ elements: [{ type: 'sticky', text: 'Hi' }] });
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe('createElements');
    expect(parsed._observation).toBeTruthy();
    expect(parsed.elements).toHaveLength(1);
  });

  it('updateElements func returns JSON with tool field and _observation', async () => {
    const tool = toolByName('updateElements');
    const raw = await tool.invoke({ updates: [{ shapeId: 'shape:a', newText: 'X' }] });
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe('updateElements');
    expect(parsed._observation).toBeTruthy();
    expect(parsed.updates).toHaveLength(1);
  });

  it('layoutElements func returns JSON with tool field and _observation', async () => {
    const tool = toolByName('layoutElements');
    const raw = await tool.invoke({ shapeIds: ['shape:a', 'shape:b'], layoutType: 'grid' });
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe('layoutElements');
    expect(parsed._observation).toBeTruthy();
    expect(parsed.layoutType).toBe('grid');
  });

  it('createDiagram func returns JSON with tool field and _observation', async () => {
    const tool = toolByName('createDiagram');
    const raw = await tool.invoke({
      diagramType: 'swot',
      title: 'Test',
      sections: [{ sectionTitle: 'S', items: ['a', 'b'] }],
    });
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe('createDiagram');
    expect(parsed._observation).toBeTruthy();
    expect(parsed.diagramType).toBe('swot');
  });
});
