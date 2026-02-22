import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tldraw,
  InstancePresenceRecordType,
  DefaultContextMenu,
  DefaultContextMenuContent,
  DefaultToolbar,
  SelectToolbarItem,
  HandToolbarItem,
  DrawToolbarItem,
  EraserToolbarItem,
  ArrowToolbarItem,
  TextToolbarItem,
  FrameToolbarItem,
  NoteToolbarItem,
  RectangleToolbarItem,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  useEditor,
  useToasts,
} from 'tldraw';
import type { Editor, TLRecord, TLStoreEventInfo, TLShapeId } from '@tldraw/editor';
import { useUser, useAuth, UserButton } from '@clerk/clerk-react';
import { shouldSendCursor, CURSOR_THROTTLE_MS } from '../utils/cursorThrottle';
import { patchNoteCloneHandle } from '../utils/noteArrowOverride';
import { removeFrameKeepContents, deleteFrameWithContents } from '../utils/frameActions';
import { resolveToolCalls } from '../utils/aiResolver';
import 'tldraw/tldraw.css';

// ── Force minimap expanded by default ─────────────────────────────────────────
// tldraw's DefaultNavigationPanel uses useLocalStorageState('minimap', true)
// where true = collapsed. Pre-seed the key so first-time users see the minimap
// open. Runs once at module load, before any React render.
if (localStorage.getItem('minimap') === null) {
  localStorage.setItem('minimap', JSON.stringify(false));
}

// ── Custom context menu ───────────────────────────────────────────────────────
// Defined at module level (outside BoardPage) so tldraw never sees it as a
// new component type on re-render, which would cause a context menu remount.
function FrameContextMenu() {
  const editor = useEditor();
  const { addToast } = useToasts();

  const selectedShapes = editor.getSelectedShapes();
  const singleFrame =
    selectedShapes.length === 1 && selectedShapes[0].type === 'frame'
      ? selectedShapes[0]
      : null;

  return (
    <DefaultContextMenu>
      {singleFrame && (
        <TldrawUiMenuGroup id="frame-actions">
          <TldrawUiMenuItem
            id="delete-frame-with-contents"
            label="Delete Frame & Contents"
            onSelect={() => {
              deleteFrameWithContents(editor, singleFrame.id as TLShapeId);
              addToast({
                title: 'Frame deleted',
                description: 'The frame and all its contents were removed.',
                severity: 'success',
              });
            }}
          />
          <TldrawUiMenuItem
            id="remove-frame-keep-contents"
            label="Remove Frame (Keep Contents)"
            onSelect={() => {
              removeFrameKeepContents(editor, singleFrame.id as TLShapeId);
              addToast({
                title: 'Frame removed',
                description: 'Child shapes were moved back to the page.',
                severity: 'success',
              });
            }}
          />
        </TldrawUiMenuGroup>
      )}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  );
}

// ── Custom toolbar ────────────────────────────────────────────────────────────
// Defined at module level to prevent remounts on re-render.
// Order: Select → Hand → Draw → Eraser → Arrow → Text → Frame → Note → Rectangle
function CustomToolbar() {
  return (
    <DefaultToolbar>
      <SelectToolbarItem />
      <HandToolbarItem />
      <DrawToolbarItem />
      <EraserToolbarItem />
      <ArrowToolbarItem />
      <TextToolbarItem />
      <FrameToolbarItem />
      <NoteToolbarItem />
      <RectangleToolbarItem />
    </DefaultToolbar>
  );
}

const TLDRAW_COMPONENTS = {
  ContextMenu: FrameContextMenu,
  Toolbar: CustomToolbar,
} as const;

const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];

function getUserColor(userId: string): string {
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}

interface ConnectedUser {
  id: string;
  name: string;
  color: string;
}

// Single env var for the Worker base URL.
// HTTP:  VITE_API_URL (e.g. https://collabboard-backend.xxx.workers.dev)
// WS:    derived by swapping the protocol — no second env var needed.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';
const WS_BASE = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [isPresenceExpanded, setIsPresenceExpanded] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteChangeRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const connectRef = useRef<(() => Promise<void>) | null>(null);

  const MAX_VISIBLE_USERS = 5;
  const MAX_RECONNECT_DELAY = 5000;
  const MAX_RECONNECT_ATTEMPTS = 5;

  const USER_ID = isSignedIn && user ? user.id : '';
  const USER_NAME = isSignedIn && user
    ? (user.fullName || user.username || user.emailAddresses[0]?.emailAddress || 'Anonymous')
    : '';
  const USER_COLOR = USER_ID ? getUserColor(USER_ID) : '#666';

  // ── AI generation handler ──────────────────────────────────────────────────

  const handleAiGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiLoading || !editorRef.current) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const token = await getToken({ skipCache: true });
      if (!token) { setAiError('Not authenticated'); return; }

      // Gather current board shapes as context for the agent.
      const selectedIds = new Set(editorRef.current.getSelectedShapeIds());
      const shapes = editorRef.current.getCurrentPageShapes().map((s) => ({
        id: s.id,
        type: s.type,
        x: s.x,
        y: s.y,
        parentId: s.parentId,
        isSelected: selectedIds.has(s.id),
        props: (s as unknown as Record<string, unknown>).props,
      }));

      const res = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, boardId, boardState: shapes }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { toolCalls: unknown[] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveToolCalls(editorRef.current, data.toolCalls as any);
      setAiPrompt('');
      setAiPanelOpen(false);
    } catch (err) {
      console.error('[AI] Generation failed:', err);
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!isSignedIn || !USER_ID || !boardId) return;

    let destroyed = false;

    const connectWebSocket = async () => {
      if (destroyed) return;

      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) { /* ignore */ }
        wsRef.current = null;
      }

      let token: string | null = null;
      try {
        // skipCache ensures we don't send an expired token on reconnects
        token = await getToken({ skipCache: true });
        if (!token) { setConnectionStatus('disconnected'); return; }
      } catch (_) {
        setConnectionStatus('disconnected'); return;
      }

      if (destroyed) return;

      // The token serves two purposes:
      //   1. Query param (?token=) — Worker reads it BEFORE the WS upgrade to
      //      run the D1 access check (Gate 2). A 401 or 403 response here
      //      means the connection never reaches the Durable Object.
      //   2. `connect` message — DO re-verifies the same JWT for defense-in-depth.
      const wsUrl = `${WS_BASE}/board/${boardId}/ws?token=${encodeURIComponent(token)}`;
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;
      setConnectionStatus('connecting');

      websocket.onopen = () => {
        if (destroyed) { websocket.close(); return; }
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        websocket.send(JSON.stringify({
          type: 'connect',
          userId: USER_ID,
          userName: USER_NAME,
          userColor: USER_COLOR,
          token, // defense-in-depth: DO verifies this independently
        }));
      };

      websocket.onclose = () => {
        if (destroyed || wsRef.current !== websocket) return;

        setConnectionStatus('disconnected');
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        reconnectAttemptsRef.current += 1;
        if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
          console.warn(`[WS] Giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.`);
          setConnectionStatus('failed');
          return;
        }

        // Delays: 1s → 2s → 4s → 5s (cap) → 5s
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current - 1),
          MAX_RECONNECT_DELAY,
        );
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (!destroyed) connectWebSocket();
        }, delay);
      };

      websocket.onerror = () => {
        if (!destroyed) setConnectionStatus('disconnected');
      };

      websocket.onmessage = (event) => {
        if (destroyed) return;
        try {
          const message = JSON.parse(event.data);
          const editor = editorRef.current;
          if (!editor) return;

          // ── error ────────────────────────────────────────────────────────
          if (message.type === 'error') {
            console.error('[WS] Server error:', message.message, message.error);
            if (message.shouldRetry === false) {
              if (reconnectTimeoutRef.current !== null) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              setConnectionStatus('failed');
            }
            return;
          }

          // ── init ─────────────────────────────────────────────────────────
          if (message.type === 'init' && message.records) {
            console.log('[WS] Loading initial records:', message.records.length);
            if (message.records.length > 0) {
              isRemoteChangeRef.current = true;
              editor.store.mergeRemoteChanges(() => {
                try {
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];
                  message.records.forEach((record: TLRecord) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid initial record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });
                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                } catch (error) {
                  console.error('[WS] Error loading initial records:', error);
                } finally {
                  isRemoteChangeRef.current = false;
                }
              });
            }
            if (message.users) setConnectedUsers(message.users);

          // ── update ───────────────────────────────────────────────────────
          } else if (message.type === 'update' && message.changes) {
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try {
                if (message.changes.added) {
                  const shapes: TLRecord[] = [];
                  const bindings: TLRecord[] = [];
                  const others: TLRecord[] = [];
                  (Object.values(message.changes.added) as TLRecord[]).forEach((record) => {
                    if (!record || !record.id || !record.typeName) {
                      console.warn('[WS] Skipping invalid added record:', record);
                      return;
                    }
                    if (record.typeName === 'binding') bindings.push(record);
                    else if (record.typeName === 'shape') shapes.push(record);
                    else others.push(record);
                  });
                  others.forEach((r) => editor.store.put([r]));
                  shapes.forEach((r) => editor.store.put([r]));
                  bindings.forEach((r) => editor.store.put([r]));
                }
                if (message.changes.updated) {
                  (Object.values(message.changes.updated) as TLRecord[]).forEach((record) => {
                    if (record && record.id && record.typeName) editor.store.put([record]);
                    else console.warn('[WS] Skipping invalid updated record:', record);
                  });
                }
                if (message.changes.removed) {
                  Object.keys(message.changes.removed).forEach((id: string) => {
                    if (id) editor.store.remove([id as TLRecord['id']]);
                  });
                }
              } catch (error) {
                console.error('[WS] Error applying remote changes:', error);
              } finally {
                isRemoteChangeRef.current = false;
              }
            });

          // ── cursor ───────────────────────────────────────────────────────
          } else if (message.type === 'cursor') {
            const { userId, userName, userColor, x, y } = message;
            if (userId === USER_ID) return;
            const presenceId = InstancePresenceRecordType.createId(userId);
            const currentPageId = editor.getCurrentPageId();
            const presence = {
              id: presenceId,
              typeName: 'instance_presence' as const,
              userId, userName, currentPageId,
              cursor: { x, y, type: 'default' as const, rotation: 0 },
              color: userColor,
              camera: { x: 0, y: 0, z: 1 },
              selectedShapeIds: [],
              brush: null, scribbles: [],
              screenBounds: { x: 0, y: 0, w: 1920, h: 1080 },
              followingUserId: null, meta: {}, chatMessage: '',
              lastActivityTimestamp: Date.now(),
            };
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try { editor.store.put([presence]); }
              finally { isRemoteChangeRef.current = false; }
            });

          // ── user-joined ──────────────────────────────────────────────────
          } else if (message.type === 'user-joined') {
            setConnectedUsers(prev => [...prev, {
              id: message.userId, name: message.userName, color: message.userColor,
            }]);
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const pt = editor.inputs.currentPagePoint;
                ws.send(JSON.stringify({
                  type: 'cursor',
                  userId: USER_ID, userName: USER_NAME, userColor: USER_COLOR,
                  x: pt.x, y: pt.y,
                }));
              } catch (error) {
                console.error('[WS] Error sending cursor on user-joined:', error);
              }
            }

          // ── user-left ────────────────────────────────────────────────────
          } else if (message.type === 'user-left') {
            const presenceId = InstancePresenceRecordType.createId(message.userId);
            isRemoteChangeRef.current = true;
            editor.store.mergeRemoteChanges(() => {
              try { editor.store.remove([presenceId]); }
              finally { isRemoteChangeRef.current = false; }
            });
            setConnectedUsers(prev => prev.filter(u => u.id !== message.userId));
          }
        } catch (error) {
          console.error('[WS] Error parsing message:', error);
        }
      };
    };

    connectRef.current = connectWebSocket;
    connectWebSocket();

    return () => {
      destroyed = true;
      connectRef.current = null;
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect', userId: USER_ID }));
        }
        ws.close();
        wsRef.current = null;
      }
    };
  }, [isSignedIn, USER_ID, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditorMount = (editor: Editor) => {
    if (!isSignedIn || !USER_ID) return;
    editorRef.current = editor;
    patchNoteCloneHandle(editor);
    editor.user.updateUserPreferences({ id: USER_ID, name: USER_NAME, color: USER_COLOR });

    const handleChange = (event: TLStoreEventInfo) => {
      if (isRemoteChangeRef.current) return;
      const { changes, source } = event;
      if (source !== 'user') return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({
          type: 'update',
          userId: USER_ID,
          changes: {
            added: Object.fromEntries(Object.entries(changes.added).map(([id, r]) => [id, r])),
            updated: Object.fromEntries(Object.entries(changes.updated).map(([id, [, to]]) => [id, to])),
            removed: Object.fromEntries(Object.entries(changes.removed).map(([id, r]) => [id, r])),
          },
        }));
      } catch (error) {
        console.error('[WS] Error sending update:', error);
      }
    };

    const unsubscribe = editor.store.listen(handleChange, { source: 'user', scope: 'document' });

    let lastCursorUpdate = 0, lastCursorX = 0, lastCursorY = 0;
    const cursorInterval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        const { x, y } = editor.inputs.currentPagePoint;
        const now = Date.now();
        if (shouldSendCursor(x, y, lastCursorX, lastCursorY, lastCursorUpdate, now)) {
          ws.send(JSON.stringify({
            type: 'cursor', userId: USER_ID, userName: USER_NAME, userColor: USER_COLOR, x, y,
          }));
          lastCursorUpdate = now; lastCursorX = x; lastCursorY = y;
        }
      } catch (error) {
        console.error('[WS] Error sending cursor:', error);
      }
    }, CURSOR_THROTTLE_MS);

    return () => { unsubscribe(); clearInterval(cursorInterval); };
  };

  // boardId guard — should never be undefined given the route definition
  if (!boardId) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#ef4444' }}>Invalid board URL.</div>;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 16px',
        background: connectionStatus === 'connected' ? '#10b981'
          : connectionStatus === 'connecting' ? '#f59e0b' : '#ef4444',
        color: 'white', fontSize: '14px', fontWeight: '500',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Back to dashboard */}
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              padding: '4px 10px', background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.4)', borderRadius: '4px',
              color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            ← Dashboard
          </button>

          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', background: 'white',
            animation: connectionStatus === 'connecting' ? 'pulse 2s infinite' : 'none',
          }} />
          <span>
            {connectionStatus === 'connected' && `Connected as ${USER_NAME}`}
            {connectionStatus === 'connecting' && 'Connecting to board…'}
            {connectionStatus === 'disconnected' && 'Disconnected — reconnecting…'}
            {connectionStatus === 'failed' && 'Connection failed — click Reconnect to try again'}
          </span>

          {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
            <button
              onClick={() => {
                if (reconnectTimeoutRef.current !== null) {
                  clearTimeout(reconnectTimeoutRef.current);
                  reconnectTimeoutRef.current = null;
                }
                reconnectAttemptsRef.current = 0;
                connectRef.current?.();
              }}
              style={{
                padding: '4px 12px', background: 'rgba(255,255,255,0.2)',
                border: '1px solid white', borderRadius: '4px',
                color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
              }}
            >
              Reconnect Now
            </button>
          )}
        </div>

        {/* Presence avatars */}
        {connectionStatus === 'connected' && connectedUsers.length > 0 && (
          <div
            onMouseLeave={() => setIsPresenceExpanded(false)}
            style={{
              display: 'flex', gap: '8px', alignItems: 'center',
              padding: '6px 12px', background: 'rgba(255,255,255,0.2)',
              borderRadius: '20px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
              {connectedUsers.length} {connectedUsers.length === 1 ? 'user' : 'users'}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {(isPresenceExpanded
                ? connectedUsers
                : connectedUsers.slice(0, MAX_VISIBLE_USERS)
              ).map((u) => (
                <div
                  key={u.id}
                  title={u.name}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: u.color, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: 'white', fontSize: '11px',
                    fontWeight: '600', flexShrink: 0,
                    border: u.id === USER_ID ? '2px solid white' : '2px solid rgba(255,255,255,0.5)',
                  }}
                >
                  {u.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {!isPresenceExpanded && connectedUsers.length > MAX_VISIBLE_USERS && (
                <div
                  onMouseEnter={() => setIsPresenceExpanded(true)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: 'rgba(0,0,0,0.3)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: '10px', fontWeight: '600',
                    border: '2px solid rgba(255,255,255,0.5)', cursor: 'pointer',
                  }}
                >
                  +{connectedUsers.length - MAX_VISIBLE_USERS}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <UserButton />
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Tldraw components={TLDRAW_COMPONENTS} onMount={handleEditorMount} />

        {/* ── AI Prompt Panel ──────────────────────────────────────────────── */}
        {!aiPanelOpen && (
          <button
            onClick={() => setAiPanelOpen(true)}
            style={{
              position: 'absolute', bottom: 20, right: 20, zIndex: 1000,
              width: 48, height: 48, borderRadius: '50%',
              background: '#6366f1', color: 'white', border: 'none',
              fontSize: 20, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="AI Generate"
          >
            AI
          </button>
        )}

        {aiPanelOpen && (
          <div style={{
            position: 'absolute', bottom: 20, right: 20, zIndex: 1000,
            width: 380, background: 'white', borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#1e1e1e' }}>AI Assistant</span>
              <button
                onClick={() => { setAiPanelOpen(false); setAiError(null); }}
                style={{
                  background: 'none', border: 'none', fontSize: 18,
                  cursor: 'pointer', color: '#888', padding: '0 4px',
                }}
              >
                x
              </button>
            </div>

            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiGenerate(); }
              }}
              placeholder="e.g. Set up a retrospective board with What Went Well, What Didn't, and Action Items columns"
              rows={3}
              disabled={aiLoading}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit',
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />

            {aiError && (
              <div style={{ color: '#ef4444', fontSize: 12, padding: '4px 0' }}>
                {aiError}
              </div>
            )}

            <button
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{
                padding: '10px 16px', borderRadius: 8, border: 'none',
                background: aiLoading ? '#a5b4fc' : '#6366f1',
                color: 'white', fontWeight: 600, fontSize: 13,
                cursor: aiLoading ? 'wait' : 'pointer',
              }}
            >
              {aiLoading ? 'Generating...' : 'Generate'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        button[data-testid="tools.asset"],
        button[data-testid="tools.highlight"] { display: none !important; }
        .tl-frame-heading {
          left: 0 !important;
          right: 0 !important;
          width: fit-content !important;
          max-width: fit-content !important;
          margin: 0 auto !important;
        }
      `}</style>
    </div>
  );
}
