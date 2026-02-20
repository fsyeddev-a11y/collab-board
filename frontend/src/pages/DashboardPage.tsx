import { useState, useEffect } from 'react';
import { useUser, useAuth, useOrganization, OrganizationSwitcher, UserButton } from '@clerk/clerk-react';
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
  const { user } = useUser();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const navigate = useNavigate();

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBoardName, setNewBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite-guest modal state
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviting, setInviting] = useState(false);

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
      setInviteTarget(null);
      setInviteeEmail('');
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setInviting(false);
    }
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
                    {/* Only org members can invite guests to their own boards */}
                    {board.org_id === organization?.id && (
                      <button
                        onClick={() => { setInviteTarget(board.id); setInviteeEmail(''); }}
                        style={{
                          padding: '8px 12px', background: 'white', color: '#374151',
                          border: '1px solid #d1d5db', borderRadius: '6px',
                          fontSize: '13px', cursor: 'pointer',
                        }}
                      >
                        Invite
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
                  onClick={() => { setInviteTarget(null); setInviteeEmail(''); }}
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
          </div>
        </div>
      )}
    </div>
  );
}
