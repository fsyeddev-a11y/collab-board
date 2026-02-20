/**
 * Vitest setup file — runs before every test file in every environment.
 *
 * Guards are required because this file is shared across the node environment
 * (src/__tests__) and the happy-dom environment (src/tests).  APIs like
 * HTMLCanvasElement and ResizeObserver only exist in happy-dom.
 */

// Minimal canvas 2D context stub — tldraw calls measureText during init.
const canvasContextStub = {
  measureText: (_text: string) => ({ width: 0 }),
  fillText: () => {},
  clearRect: () => {},
  fillRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  save: () => {},
  restore: () => {},
  scale: () => {},
  translate: () => {},
  setTransform: () => {},
  font: '',
};

if (typeof HTMLCanvasElement !== 'undefined') {
  // @ts-expect-error — jsdom/happy-dom stub replacement
  HTMLCanvasElement.prototype.getContext = () => canvasContextStub;
}

// ResizeObserver is used by tldraw internally; happy-dom may not implement it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
