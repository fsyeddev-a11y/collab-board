import { useState, useEffect } from 'react';
import { useAuth, useOrganization, OrganizationSwitcher, UserButton } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

interface Board {
  id: string;
  name: string;
  org_id: string;
  created_by: string;
  created_at: number;
}

// Derives the HTTP API base URL from the single VITE_API_URL env var.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export function DashboardPage() {
  const { getToken } = useAuth();
  const { organization, membership } = useOrganization();
  const navigate = useNavigate();

  // True when the current user is an admin of the active org.
  const isOrgAdmin = membership?.role === 'org:admin';

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBoardName, setNewBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite-guest modal state
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Copy-link feedback: stores the boardId whose link was just copied
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);

  // Delete confirmation: stores the boardId awaiting confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Refetch whenever the active org changes
  useEffect(() => {
    fetchBoards();
  }, [organization?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBoards() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      const data = await res.json() as { boards: Board[] };
      setBoards(data.boards);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBoard(e: React.FormEvent) {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    setCreating(true);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/boards`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newBoardName.trim() }),
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      const board = await res.json() as Board;
      setNewBoardName('');
      navigate(`/board/${board.id}`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleInviteGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteTarget || !inviteeEmail.trim()) return;
    setInviting(true);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/boards/${inviteTarget}/invite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteeEmail.trim() }),
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      // Transition to the success/copy-link view instead of closing.
      setInviteSuccess(true);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setInviting(false);
    }
  }

  function closeInviteModal() {
    setInviteTarget(null);
    setInviteeEmail('');
    setInviteSuccess(false);
  }

  async function handleDeleteBoard(boardId: string) {
    setConfirmDeleteId(null);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/boards/${boardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json() as { error: string }).error);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (e) {
      setErrorMsg(String(e));
    }
  }

  function copyBoardLink(boardId: string) {
    const link = `${window.location.origin}/board/${boardId}`;
    navigator.clipboard.writeText(link);
    setCopiedBoardId(boardId);
    setTimeout(() => setCopiedBoardId(null), 2000);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '0 24px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#111' }}>
          CollabBoard
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
          <UserButton />
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 24px' }}>

        {/* No active org warning */}
        {!organization && (
          <div style={{
            background: '#fff7ed', border: '1px solid #fed7aa',
            borderRadius: '8px', padding: '16px', marginBottom: '24px', color: '#9a3412',
          }}>
            Select or create an organization above to create new boards.
            You can still open boards you have been invited to as a guest.
          </div>
        )}

        {/* ── Create board ────────────────────────────────────────────── */}
        {organization && (
          <section style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#374151' }}>
              New board in <em>{organization.name}</em>
            </h2>
            <form onSubmit={handleCreateBoard} style={{ display: 'flex', gap: '8px' }}>
              <input
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="Board name…"
                maxLength={100}
                style={{
                  flex: 1, padding: '10px 14px',
                  border: '1px solid #d1d5db', borderRadius: '6px',
                  fontSize: '14px', outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={creating || !newBoardName.trim()}
                style={{
                  padding: '10px 20px', background: '#6366f1', color: 'white',
                  border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600',
                  cursor: creating || !newBoardName.trim() ? 'not-allowed' : 'pointer',
                  opacity: creating || !newBoardName.trim() ? 0.6 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </form>
          </section>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '6px', padding: '12px 16px', marginBottom: '20px',
            color: '#991b1b', fontSize: '14px',
          }}>
            {errorMsg}
          </div>
        )}

        {/* ── Board list ──────────────────────────────────────────────── */}
        <section>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#374151' }}>
            Your boards
          </h2>

          {loading ? (
            <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading…</p>
          ) : boards.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              No boards yet.
              {organization ? ' Create one above.' : " You haven't been invited to any boards."}
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '16px',
            }}>
              {boards.map((board) => (
                <div
                  key={board.id}
                  style={{
                    background: 'white', border: '1px solid #e5e7eb',
                    borderRadius: '10px', padding: '20px',
                    display: 'flex', flexDirection: 'column', gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#111', marginBottom: '4px' }}>
                      {board.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {board.org_id === organization?.id ? 'Your organization' : 'Guest access'}
                    </div>
                  </div>

                  {/* ── Confirm-delete banner (shown inline on the card) ── */}
                  {confirmDeleteId === board.id && (
                    <div style={{
                      background: '#fef2f2', border: '1px solid #fecaca',
                      borderRadius: '6px', padding: '10px 12px',
                      fontSize: '13px', color: '#991b1b',
                    }}>
                      <div style={{ marginBottom: '8px', fontWeight: '600' }}>Delete this board?</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleDeleteBoard(board.id)}
                          style={{
                            flex: 1, padding: '6px', background: '#dc2626', color: 'white',
                            border: 'none', borderRadius: '5px', fontSize: '12px',
                            fontWeight: '600', cursor: 'pointer',
                          }}
                        >
                          Yes, delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{
                            flex: 1, padding: '6px', background: 'white', color: '#374151',
                            border: '1px solid #d1d5db', borderRadius: '5px',
                            fontSize: '12px', cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigate(`/board/${board.id}`)}
                      style={{
                        flex: 1, padding: '8px', background: '#6366f1', color: 'white',
                        border: 'none', borderRadius: '6px', fontSize: '13px',
                        fontWeight: '600', cursor: 'pointer',
                      }}
                    >
                      Open
                    </button>
                    {/* Invite + Delete: only for org admins on their own boards */}
                    {board.org_id === organization?.id && isOrgAdmin && (
                      <button
                        onClick={() => { setInviteTarget(board.id); setInviteeEmail(''); setInviteSuccess(false); }}
                        style={{
                          padding: '8px 12px', background: 'white', color: '#374151',
                          border: '1px solid #d1d5db', borderRadius: '6px',
                          fontSize: '13px', cursor: 'pointer',
                        }}
                      >
                        Invite
                      </button>
                    )}
                    <button
                      onClick={() => copyBoardLink(board.id)}
                      title="Copy board link"
                      style={{
                        padding: '8px 12px', background: copiedBoardId === board.id ? '#f0fdf4' : 'white',
                        color: copiedBoardId === board.id ? '#16a34a' : '#374151',
                        border: `1px solid ${copiedBoardId === board.id ? '#86efac' : '#d1d5db'}`,
                        borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {copiedBoardId === board.id ? 'Copied!' : '🔗'}
                    </button>
                    {board.org_id === organization?.id && isOrgAdmin && (
                      <button
                        onClick={() => setConfirmDeleteId(board.id)}
                        title="Delete board"
                        style={{
                          padding: '8px 10px', background: 'white', color: '#dc2626',
                          border: '1px solid #fecaca', borderRadius: '6px',
                          fontSize: '13px', cursor: 'pointer',
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Invite-guest modal ──────────────────────────────────────────────── */}
      {inviteTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'white', borderRadius: '12px', padding: '28px',
            width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>

            {inviteSuccess ? (
              /* ── Success view: show copyable board link ── */
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '700' }}>
                  Invite sent!
                </h3>
                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '14px' }}>
                  <strong>{inviteeEmail}</strong> can now access this board.
                  Share the link below so they can open it directly.
                </p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/board/${inviteTarget}`}
                    style={{
                      flex: 1, padding: '10px 14px', border: '1px solid #d1d5db',
                      borderRadius: '6px', fontSize: '13px', outline: 'none',
                      background: '#f9fafb', color: '#374151',
                    }}
                  />
                  <button
                    onClick={() => copyBoardLink(inviteTarget)}
                    style={{
                      padding: '10px 16px',
                      background: copiedBoardId === inviteTarget ? '#f0fdf4' : '#6366f1',
                      color: copiedBoardId === inviteTarget ? '#16a34a' : 'white',
                      border: copiedBoardId === inviteTarget ? '1px solid #86efac' : 'none',
                      borderRadius: '6px', fontSize: '14px', fontWeight: '600',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                      transition: 'all 0.15s',
                    }}
                  >
                    {copiedBoardId === inviteTarget ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={closeInviteModal}
                    style={{
                      padding: '8px 20px', background: '#6366f1', color: 'white',
                      border: 'none', borderRadius: '6px', fontSize: '14px',
                      fontWeight: '600', cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              /* ── Email form view ── */
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '700' }}>
                  Invite guest
                </h3>
                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '14px' }}>
                  Enter the email address of the person to invite. They will gain
                  access to this board without being added to your organization.
                </p>
                <form onSubmit={handleInviteGuest} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="email"
                    value={inviteeEmail}
                    onChange={(e) => setInviteeEmail(e.target.value)}
                    placeholder="guest@example.com"
                    style={{
                      padding: '10px 14px', border: '1px solid #d1d5db',
                      borderRadius: '6px', fontSize: '14px', outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={closeInviteModal}
                      style={{
                        padding: '8px 16px', background: 'white', color: '#374151',
                        border: '1px solid #d1d5db', borderRadius: '6px',
                        fontSize: '14px', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={inviting || !inviteeEmail.trim()}
                      style={{
                        padding: '8px 16px', background: '#6366f1', color: 'white',
                        border: 'none', borderRadius: '6px', fontSize: '14px',
                        fontWeight: '600',
                        cursor: inviting || !inviteeEmail.trim() ? 'not-allowed' : 'pointer',
                        opacity: inviting || !inviteeEmail.trim() ? 0.6 : 1,
                      }}
                    >
                      {inviting ? 'Inviting…' : 'Invite'}
                    </button>
                  </div>
                </form>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
