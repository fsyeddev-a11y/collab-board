/**
 * CodePreviewPanel — floating draggable/resizable panel that shows
 * generated React+Tailwind code with a live preview iframe.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface CodePreviewPanelProps {
  code: string;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

const DEFAULT_W = 600;
const DEFAULT_H = 500;
const MIN_W = 400;
const MIN_H = 300;

/** Strip any remaining import/export statements for the iframe sandbox. */
function sanitizeForPreview(code: string): string {
  return code
    .replace(/^import\s+.*?[;\n]/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '')
    .trim();
}

/** Find the component function name from the code. */
function findComponentName(code: string): string {
  // Match: function Name(  or  const Name = (  or  const Name = () =>
  const fnMatch = code.match(/function\s+([A-Z]\w*)\s*\(/);
  if (fnMatch) return fnMatch[1];
  const constMatch = code.match(/(?:const|let|var)\s+([A-Z]\w*)\s*=/);
  if (constMatch) return constMatch[1];
  return 'App';
}

function buildSrcdoc(rawCode: string): string {
  const code = sanitizeForPreview(rawCode);
  const componentName = findComponentName(code);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { min-height: 100vh; }
    .error-msg { color: #ef4444; padding: 20px; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    try {
      ${code}

      const _Component = typeof ${componentName} !== 'undefined' ? ${componentName} : null;
      if (_Component) {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(_Component));
      } else {
        document.getElementById('root').innerHTML = '<div class="error-msg">No component found. Define a function named App or another PascalCase component.</div>';
      }
    } catch (err) {
      document.getElementById('root').innerHTML = '<div class="error-msg">Render error: ' + err.message + '</div>';
    }
  <\/script>
</body>
</html>`;
}

export function CodePreviewPanel({ code, isLoading, error, onClose }: CodePreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - DEFAULT_W - 20, y: 80 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.preventDefault();
  }, [position]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        setPosition({
          x: e.clientX - dragStart.current.x,
          y: e.clientY - dragStart.current.y,
        });
      }
      if (isResizing.current) {
        const newW = Math.max(MIN_W, resizeStart.current.w + (e.clientX - resizeStart.current.x));
        const newH = Math.max(MIN_H, resizeStart.current.h + (e.clientY - resizeStart.current.y));
        setSize({ w: newW, h: newH });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      isResizing.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: position.y,
        left: position.x,
        width: size.w,
        height: size.h,
        zIndex: 1001,
        background: 'white',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title bar — drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#f3f4f6',
          borderBottom: '1px solid #e5e7eb',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: '#1e1e1e' }}>
          Generated Code
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 18,
            cursor: 'pointer',
            color: '#888',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #e5e7eb',
        flexShrink: 0,
      }}>
        {(['preview', 'code'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#8b5cf6' : '#666',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #8b5cf6' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab === 'preview' ? 'Preview' : 'Code'}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{
              width: 32,
              height: 32,
              border: '3px solid #e5e7eb',
              borderTopColor: '#8b5cf6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#666', fontSize: 13 }}>Generating code...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && !isLoading && (
          <div style={{
            padding: 16,
            color: '#ef4444',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!isLoading && !error && activeTab === 'preview' && (
          <iframe
            sandbox="allow-scripts"
            srcDoc={buildSrcdoc(code)}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title="Code Preview"
          />
        )}

        {!isLoading && !error && activeTab === 'code' && (
          <div style={{ height: '100%', overflow: 'auto', position: 'relative' }}>
            <button
              onClick={handleCopy}
              style={{
                position: 'sticky',
                top: 8,
                float: 'right',
                margin: '8px 8px 0 0',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: copied ? '#10b981' : '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                zIndex: 1,
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <pre style={{
              margin: 0,
              padding: 16,
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#f8f9fa',
              minHeight: '100%',
            }}>
              <code>{code}</code>
            </pre>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'se-resize',
          background: 'linear-gradient(135deg, transparent 50%, #ccc 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />
    </div>
  );
}
